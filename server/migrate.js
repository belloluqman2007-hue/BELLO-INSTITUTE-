"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — database migrations
   ----------------------------------------------------------------------------
   Brand-new schema for the new platform. Every tenant-owned table carries
   madrasa_id and a foreign key to madaris. The schema is written dialect-
   aware so the same migrations build either the dev SQLite database or the
   NEW production MySQL database.

   Usage:  npm run migrate        (applies pending migrations)
   ========================================================================== */
const db = require("./db");

/** Migration ids not yet recorded in schema_migrations. */
async function pendingMigrations() {
  let applied = [];
  try {
    applied = await db.all("SELECT id FROM schema_migrations");
  } catch (e) {
    return MIGRATIONS.slice(); // no table yet: everything is pending
  }
  const appliedIds = new Set(applied.map((r) => r.id));
  return MIGRATIONS.filter((m) => !appliedIds.has(m.id));
}

/* Dialect helpers */
const D = {
  autoInc: (d) => (d === "sqlite" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "INT NOT NULL AUTO_INCREMENT PRIMARY KEY"),
  fk: (d) => (d === "sqlite" ? "" : "FOREIGN KEY "),
  fkClause: (d, col, ref) => (d === "sqlite" ? "" : `FOREIGN KEY (${col}) REFERENCES ${ref}(id), `),
  engine: (d) => (d === "mysql" ? " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci" : ""),
  ts: () => "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
};

const MIGRATIONS = [
  /* ------------------------------------------------------------------ */
  {
    id: "001_platform_core",
    up: async (api, dialect) => {
      // Subscription plans (platform-level)
      await api.run(`
        CREATE TABLE IF NOT EXISTS plans (
          id ${D.autoInc(dialect)},
          code VARCHAR(30) NOT NULL UNIQUE,
          name VARCHAR(80) NOT NULL,
          name_ar VARCHAR(80) NOT NULL DEFAULT '',
          price_ngn DECIMAL(10,2) NOT NULL DEFAULT 0,
          student_limit INT NOT NULL DEFAULT -1,
          teacher_limit INT NOT NULL DEFAULT -1,
          features TEXT NOT NULL DEFAULT '{}',
          is_active INT NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);

      // Madaris (tenants)
      await api.run(`
        CREATE TABLE IF NOT EXISTS madaris (
          id ${D.autoInc(dialect)},
          slug VARCHAR(80) NOT NULL UNIQUE,
          name_en VARCHAR(160) NOT NULL,
          name_ar VARCHAR(160) NOT NULL DEFAULT '',
          logo_path VARCHAR(255) NOT NULL DEFAULT '',
          motto_en VARCHAR(160) NOT NULL DEFAULT '',
          motto_ar VARCHAR(160) NOT NULL DEFAULT '',
          address VARCHAR(255) NOT NULL DEFAULT '',
          city VARCHAR(80) NOT NULL DEFAULT '',
          state_name VARCHAR(80) NOT NULL DEFAULT '',
          phone VARCHAR(60) NOT NULL DEFAULT '',
          email VARCHAR(120) NOT NULL DEFAULT '',
          plan_id INT NOT NULL DEFAULT 1,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at ${D.ts()},
          updated_at ${D.ts()},
          UNIQUE (id)
        )${D.engine(dialect)}
      `);

      // Users: platform-level (madrasa_id NULL = super admin) and tenant users
      await api.run(`
        CREATE TABLE IF NOT EXISTS users (
          id ${D.autoInc(dialect)},
          madrasa_id INT,
          username VARCHAR(100) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL,
          full_name VARCHAR(160) NOT NULL DEFAULT '',
          full_name_ar VARCHAR(160) NOT NULL DEFAULT '',
          email VARCHAR(120) NOT NULL DEFAULT '',
          phone VARCHAR(60) NOT NULL DEFAULT '',
          is_active INT NOT NULL DEFAULT 1,
          created_at ${D.ts()}${dialect === "mysql" ? ",\n          FOREIGN KEY (madrasa_id) REFERENCES madaris(id)" : ""}
        )${D.engine(dialect)}
      `);

      // Activity / audit log
      await api.run(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id ${D.autoInc(dialect)},
          madrasa_id INT,
          user_id INT,
          action VARCHAR(100) NOT NULL,
          entity VARCHAR(60) NOT NULL DEFAULT '',
          entity_id VARCHAR(80) NOT NULL DEFAULT '',
          meta TEXT,
          ip VARCHAR(64) NOT NULL DEFAULT '',
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "002_academic_structures",
    up: async (api, dialect) => {
      await api.run(`
        CREATE TABLE IF NOT EXISTS academic_sessions (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          label VARCHAR(40) NOT NULL,
          start_date DATE,
          end_date DATE,
          is_current INT NOT NULL DEFAULT 0,
          created_at ${D.ts()},
          UNIQUE (madrasa_id, label)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS terms (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          session_id INT NOT NULL,
          position INT NOT NULL,
          name_en VARCHAR(60) NOT NULL,
          name_ar VARCHAR(60) NOT NULL DEFAULT '',
          start_date DATE,
          end_date DATE,
          UNIQUE (madrasa_id, session_id, position)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS classes (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          name_en VARCHAR(120) NOT NULL,
          name_ar VARCHAR(120) NOT NULL DEFAULT '',
          sort_order INT NOT NULL DEFAULT 0,
          is_active INT NOT NULL DEFAULT 1,
          UNIQUE (madrasa_id, name_en)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS subjects (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          name_en VARCHAR(120) NOT NULL,
          name_ar VARCHAR(120) NOT NULL DEFAULT '',
          is_active INT NOT NULL DEFAULT 1,
          UNIQUE (madrasa_id, name_en)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS class_subjects (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          class_id INT NOT NULL,
          subject_id INT NOT NULL,
          UNIQUE (madrasa_id, class_id, subject_id)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_assignments (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          class_id INT,
          subject_id INT,
          UNIQUE (madrasa_id, user_id, class_id, subject_id)
        )${D.engine(dialect)}
      `);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "003_students_and_fees",
    up: async (api, dialect) => {
      await api.run(`
        CREATE TABLE IF NOT EXISTS students (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          admission_no VARCHAR(60) NOT NULL,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL DEFAULT '',
          name_ar VARCHAR(160) NOT NULL DEFAULT '',
          gender VARCHAR(10) NOT NULL DEFAULT '',
          date_of_birth DATE,
          class_id INT,
          session_id INT,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          parent_name VARCHAR(160) NOT NULL DEFAULT '',
          parent_phone VARCHAR(60) NOT NULL DEFAULT '',
          address VARCHAR(255) NOT NULL DEFAULT '',
          photo_path VARCHAR(255) NOT NULL DEFAULT '',
          notes TEXT,
          created_at ${D.ts()},
          updated_at ${D.ts()},
          UNIQUE (madrasa_id, admission_no)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS parent_links (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          student_id INT NOT NULL,
          UNIQUE (madrasa_id, user_id, student_id)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS fee_items (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          term_id INT,
          name_en VARCHAR(120) NOT NULL,
          name_ar VARCHAR(120) NOT NULL DEFAULT '',
          amount_ngn DECIMAL(10,2) NOT NULL DEFAULT 0
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS fee_payments (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          student_id INT NOT NULL,
          fee_item_id INT,
          amount_ngn DECIMAL(10,2) NOT NULL,
          payment_date DATE NOT NULL,
          method VARCHAR(40) NOT NULL DEFAULT 'cash',
          reference VARCHAR(120) NOT NULL DEFAULT '',
          recorded_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "004_results_attendance_announcements",
    up: async (api, dialect) => {
      // Per-madrasa grading configuration (CA/exam weights, pass mark, bands)
      await api.run(`
        CREATE TABLE IF NOT EXISTS grading_config (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL UNIQUE,
          ca_max DECIMAL(5,2) NOT NULL DEFAULT 40,
          exam_max DECIMAL(5,2) NOT NULL DEFAULT 60,
          pass_mark DECIMAL(5,2) NOT NULL DEFAULT 50,
          promotion_min_average DECIMAL(5,2),
          promotion_require_pass INT NOT NULL DEFAULT 1,
          grade_bands TEXT NOT NULL DEFAULT '[]',
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS results (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          student_id INT NOT NULL,
          class_id INT NOT NULL,
          session_id INT NOT NULL,
          term_id INT NOT NULL,
          subject_id INT NOT NULL,
          ca DECIMAL(5,2) NOT NULL DEFAULT 0,
          exam DECIMAL(5,2) NOT NULL DEFAULT 0,
          total DECIMAL(5,2) NOT NULL DEFAULT 0,
          created_at ${D.ts()},
          updated_at ${D.ts()},
          UNIQUE (madrasa_id, student_id, term_id, subject_id)
        )${D.engine(dialect)}
      `);

      // One row per student per term: totals, position, comments, promotion
      await api.run(`
        CREATE TABLE IF NOT EXISTS term_summaries (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          student_id INT NOT NULL,
          class_id INT NOT NULL,
          session_id INT NOT NULL,
          term_id INT NOT NULL,
          subject_count INT NOT NULL DEFAULT 0,
          total DECIMAL(8,2) NOT NULL DEFAULT 0,
          average DECIMAL(5,2) NOT NULL DEFAULT 0,
          overall_grade VARCHAR(10) NOT NULL DEFAULT '',
          position INT,
          attendance_days INT NOT NULL DEFAULT 0,
          attendance_required INT NOT NULL DEFAULT 0,
          teacher_comment TEXT,
          head_comment TEXT,
          promotion_status VARCHAR(20) NOT NULL DEFAULT 'pending',
          published_at TEXT,
          UNIQUE (madrasa_id, student_id, term_id)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS attendance (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          student_id INT NOT NULL,
          class_id INT NOT NULL,
          term_id INT,
          day DATE NOT NULL,
          status VARCHAR(10) NOT NULL DEFAULT 'present',
          recorded_by INT,
          UNIQUE (madrasa_id, student_id, day)
        )${D.engine(dialect)}
      `);

      await api.run(`
        CREATE TABLE IF NOT EXISTS announcements (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          title VARCHAR(200) NOT NULL,
          body TEXT NOT NULL,
          audience VARCHAR(20) NOT NULL DEFAULT 'all',
          is_active INT NOT NULL DEFAULT 1,
          created_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);

      // Per-madrasa key/value settings (admission prefix, language defaults…)
      await api.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          key_name VARCHAR(80) NOT NULL,
          value TEXT,
          UNIQUE (madrasa_id, key_name)
        )${D.engine(dialect)}
      `);

      // MySQL-backed session store (works for both drivers)
      await api.run(`
        CREATE TABLE IF NOT EXISTS app_sessions (
          sid VARCHAR(128) NOT NULL PRIMARY KEY,
          expires INTEGER,
          data TEXT
        )${D.engine(dialect)}
      `);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "005_platform_settings",
    up: async (api, dialect) => {
      await api.run(`
        CREATE TABLE IF NOT EXISTS platform_settings (
          id ${D.autoInc(dialect)},
          key_name VARCHAR(80) NOT NULL UNIQUE,
          value TEXT
        )${D.engine(dialect)}
      `);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "006_student_portal_links",
    up: async (api, dialect) => {
      // Student portal accounts are linked to their student record.
      await api.run(`ALTER TABLE users ADD COLUMN student_id INT`);
    },
  },
  /* ------------------------------------------------------------------ */
  {
    id: "007_public_portal",
    up: async (api, dialect) => {
      // Public (logged-out) site: each madrasa decides what the directory,
      // its profile page, result checking and online admission may show.
      await api.run(`ALTER TABLE madaris ADD COLUMN public_listing INT NOT NULL DEFAULT 1`);
      await api.run(`ALTER TABLE madaris ADD COLUMN public_results INT NOT NULL DEFAULT 0`);
      await api.run(`ALTER TABLE madaris ADD COLUMN public_admissions INT NOT NULL DEFAULT 0`);
      await api.run(`ALTER TABLE madaris ADD COLUMN description_en TEXT`);
      await api.run(`ALTER TABLE madaris ADD COLUMN description_ar TEXT`);
      await api.run(`ALTER TABLE madaris ADD COLUMN founded_year VARCHAR(8) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN website VARCHAR(160) NOT NULL DEFAULT ''`);
      // Listings are filtered by status + visibility on every request.
      await api.run(`CREATE INDEX idx_madaris_public ON madaris (status, public_listing)`);

      // Online admission applications submitted from the public site.
      await api.run(`
        CREATE TABLE IF NOT EXISTS admission_requests (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          reference VARCHAR(30) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL DEFAULT '',
          name_ar VARCHAR(160) NOT NULL DEFAULT '',
          gender VARCHAR(10) NOT NULL DEFAULT '',
          date_of_birth DATE,
          class_id INT,
          previous_school VARCHAR(200) NOT NULL DEFAULT '',
          quran_level VARCHAR(80) NOT NULL DEFAULT '',
          parent_name VARCHAR(160) NOT NULL DEFAULT '',
          parent_phone VARCHAR(60) NOT NULL DEFAULT '',
          parent_email VARCHAR(120) NOT NULL DEFAULT '',
          address VARCHAR(255) NOT NULL DEFAULT '',
          message TEXT,
          student_id INT,
          reviewed_by INT,
          reviewed_at ${D.ts()},
          review_note TEXT,
          ip VARCHAR(64) NOT NULL DEFAULT '',
          created_at ${D.ts()},
          UNIQUE (madrasa_id, reference)
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_admission_req ON admission_requests (madrasa_id, status, id)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "008_timetable",
    up: async (api, dialect) => {
      // Weekly class timetable. Slots are per class; a term id lets a madrasa
      // keep one timetable per term. Times are stored as 'HH:MM' strings so
      // both drivers behave identically.
      await api.run(`
        CREATE TABLE IF NOT EXISTS timetable_slots (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          class_id INT NOT NULL,
          term_id INT,
          day VARCHAR(10) NOT NULL,
          period INT NOT NULL,
          start_time VARCHAR(5) NOT NULL DEFAULT '',
          end_time VARCHAR(5) NOT NULL DEFAULT '',
          subject_id INT,
          teacher_id INT,
          room VARCHAR(60) NOT NULL DEFAULT '',
          notes VARCHAR(255) NOT NULL DEFAULT '',
          UNIQUE (madrasa_id, class_id, day, period)
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_timetable_teacher ON timetable_slots (madrasa_id, teacher_id, day, period)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "009_announcements_public",
    up: async (api, dialect) => {
      // Announcements can now also be published to the public site.
      await api.run(`ALTER TABLE announcements ADD COLUMN publish_public INT NOT NULL DEFAULT 0`);
      await api.run(`ALTER TABLE announcements ADD COLUMN publish_until DATE`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "010_admission_traceability",
    up: async (api) => {
      // Which online application produced this student (nullable: walk-in
      // admissions have no application). Keeps the audit trail in both
      // directions without a join table.
      await api.run(`ALTER TABLE students ADD COLUMN source_request_id INT`);
      await api.run(`ALTER TABLE admission_requests ADD COLUMN admission_no_assigned VARCHAR(60) NOT NULL DEFAULT ''`);
    },
  },
];

async function migrate(options = {}) {
  const dialect = await db.dialect();
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(80) NOT NULL PRIMARY KEY,
      applied_at ${D.ts()}
    )${D.engine(dialect)}`);
  // Snapshot only when there is actually something to change.
  const pending = await pendingMigrations();
  if (pending.length && options.snapshot !== false) {
    try {
      const backup = require("./services/backup");
      const info = await backup.snapshotBefore(db, "pre-migration");
      if (info) console.log("Pre-migration snapshot: " + info.name);
    } catch (e) {
      console.error("Pre-migration snapshot skipped:", e.message);
    }
  }

  let count = 0;
  for (const m of pending) {
    console.log(`Applying migration ${m.id} [${dialect}]...`);
    await m.up(db, dialect);
    await db.run("INSERT INTO schema_migrations (id) VALUES (?)", [m.id]);
    count++;
  }

  if (count === 0) console.log("Database is up to date — no pending migrations.");
  else console.log(`Done. Applied ${count} migration(s).`);
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { migrate, pendingMigrations, MIGRATIONS };
