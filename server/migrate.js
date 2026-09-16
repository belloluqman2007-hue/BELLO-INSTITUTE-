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
      // Subscription plans (platform-level).
      // NOTE: `features` deliberately has NO database-level default — MySQL
      // rejects DEFAULT on TEXT/BLOB/JSON columns (ER_BLOB_CANT_HAVE_DEFAULT).
      // The application always supplies '{}' when creating a plan
      // (server/routes/platform.js: JSON.stringify(b.features || {})).
      await api.run(`
        CREATE TABLE IF NOT EXISTS plans (
          id ${D.autoInc(dialect)},
          code VARCHAR(30) NOT NULL UNIQUE,
          name VARCHAR(80) NOT NULL,
          name_ar VARCHAR(80) NOT NULL DEFAULT '',
          price_ngn DECIMAL(10,2) NOT NULL DEFAULT 0,
          student_limit INT NOT NULL DEFAULT -1,
          teacher_limit INT NOT NULL DEFAULT -1,
          features TEXT NOT NULL,
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
      // Per-madrasa grading configuration (CA/exam weights, pass mark, bands).
      // `grade_bands` deliberately has NO database-level default — MySQL
      // rejects DEFAULT on TEXT columns (ER_BLOB_CANT_HAVE_DEFAULT). The
      // application supplies the default bands itself (server/services/grading.js:
      // JSON.stringify(DEFAULT_BANDS); reads fall back to DEFAULT_BANDS).
      await api.run(`
        CREATE TABLE IF NOT EXISTS grading_config (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL UNIQUE,
          ca_max DECIMAL(5,2) NOT NULL DEFAULT 40,
          exam_max DECIMAL(5,2) NOT NULL DEFAULT 60,
          pass_mark DECIMAL(5,2) NOT NULL DEFAULT 50,
          promotion_min_average DECIMAL(5,2),
          promotion_require_pass INT NOT NULL DEFAULT 1,
          grade_bands TEXT NOT NULL,
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

      // Database-backed session store (works for both drivers).
      // `expires` holds a JavaScript epoch in MILLISECONDS, which overflows
      // MySQL's 4-byte INT — it MUST be BIGINT there (see migration
      // 014_session_expiry_bigint). SQLite's INTEGER is already 8 bytes.
      await api.run(`
        CREATE TABLE IF NOT EXISTS app_sessions (
          sid VARCHAR(128) NOT NULL PRIMARY KEY,
          expires ${dialect === "mysql" ? "BIGINT" : "INTEGER"},
          data ${dialect === "mysql" ? "MEDIUMTEXT" : "TEXT"}
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

  /* ------------------------------------------------------------------ */
  {
    id: "011_school_extras",
    up: async (api, dialect) => {
      // School chat (general + staff-only scopes) and the homework board.
      // Both are tenant-owned (madrasa_id) like every other school table.
      await api.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          scope VARCHAR(20) NOT NULL DEFAULT 'general',
          user_id INT,
          author_name VARCHAR(160) NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_messages ON messages (madrasa_id, scope, id)`);

      await api.run(`
        CREATE TABLE IF NOT EXISTS homework (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          class_id INT,
          subject_id INT,
          title VARCHAR(200) NOT NULL,
          details TEXT,
          due_date DATE,
          created_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_homework ON homework (madrasa_id, class_id, id)`);
    },
  },
  /* ------------------------------------------------------------------ */
  {
    id: "012_madrasa_registrations",
    up: async (api, dialect) => {
      await api.run(`
        CREATE TABLE IF NOT EXISTS madrasa_registrations (
          id ${D.autoInc(dialect)},
          registration_id VARCHAR(60) NOT NULL UNIQUE,
          madrasa_id VARCHAR(60) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'Pending',
          name VARCHAR(160) NOT NULL,
          official_name VARCHAR(160) NOT NULL DEFAULT '',
          logo_data TEXT,
          description TEXT,
          year_established VARCHAR(10) NOT NULL DEFAULT '',
          institution_type VARCHAR(60) NOT NULL DEFAULT 'Madrasa',
          country VARCHAR(80) NOT NULL DEFAULT 'Nigeria',
          state_name VARCHAR(80) NOT NULL DEFAULT '',
          city VARCHAR(80) NOT NULL DEFAULT '',
          address VARCHAR(255) NOT NULL DEFAULT '',
          maps_link VARCHAR(255) NOT NULL DEFAULT '',
          phone VARCHAR(60) NOT NULL DEFAULT '',
          whatsapp VARCHAR(60) NOT NULL DEFAULT '',
          email VARCHAR(120) NOT NULL DEFAULT '',
          website VARCHAR(200) NOT NULL DEFAULT '',
          facebook VARCHAR(200) NOT NULL DEFAULT '',
          instagram VARCHAR(200) NOT NULL DEFAULT '',
          subjects_json TEXT,
          student_count VARCHAR(20) NOT NULL DEFAULT '',
          teacher_count VARCHAR(20) NOT NULL DEFAULT '',
          class_count VARCHAR(20) NOT NULL DEFAULT '',
          age_groups_json TEXT,
          admin_full_name VARCHAR(160) NOT NULL DEFAULT '',
          admin_position VARCHAR(80) NOT NULL DEFAULT '',
          admin_email VARCHAR(120) NOT NULL DEFAULT '',
          admin_phone VARCHAR(60) NOT NULL DEFAULT '',
          ip VARCHAR(64) NOT NULL DEFAULT '',
          submitted_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_madrasa_reg_id ON madrasa_registrations (registration_id)`);
      await api.run(`CREATE INDEX idx_madrasa_reg_status ON madrasa_registrations (status)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "013_institution_categories_and_sites",
    up: async (api, dialect) => {
      // Every tenant now carries WHICH kind of institution it is. `category`
      // is the coarse switch the whole admin experience branches on
      // ('islamic' | 'western'); `institution_type` is the specific label the
      // administrator chose at registration (e.g. "Qur'an School", "Nursery
      // & Primary School"). Existing rows default to the platform's original
      // audience (Islamic) so nothing already live changes behaviour.
      await api.run(`ALTER TABLE madaris ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'islamic'`);
      await api.run(`ALTER TABLE madaris ADD COLUMN institution_type VARCHAR(60) NOT NULL DEFAULT 'Madrasa'`);
      await api.run(`ALTER TABLE madaris ADD COLUMN verified INT NOT NULL DEFAULT 0`);

      // Website / brand customisation — constrained to a small set of fields
      // so every tenant site still fits the BELLO template.
      await api.run(`ALTER TABLE madaris ADD COLUMN tagline VARCHAR(200) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN hero_image_path VARCHAR(255) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN brand_color VARCHAR(20) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN whatsapp VARCHAR(60) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN facebook VARCHAR(200) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN instagram VARCHAR(200) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN maps_link VARCHAR(255) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN admin_full_name VARCHAR(160) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN admin_position VARCHAR(80) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madaris ADD COLUMN admission_info TEXT`);
      await api.run(`CREATE INDEX idx_madaris_category ON madaris (category, status, public_listing)`);

      // Registration approval trail: a registration is promoted into a real
      // madaris + madrasa_admin login by a super admin action, never
      // automatically. The link is kept both ways for audit.
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN reviewed_by INT`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN reviewed_at TIMESTAMP NULL`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN review_note TEXT`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN promoted_madrasa_id INT`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN admin_username VARCHAR(100) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'islamic'`);
      await api.run(`ALTER TABLE madrasa_registrations ADD COLUMN admin_password_hash VARCHAR(255) NOT NULL DEFAULT ''`);

      // Public-site photo gallery, one row per image.
      await api.run(`
        CREATE TABLE IF NOT EXISTS gallery_images (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          image_path VARCHAR(255) NOT NULL,
          caption VARCHAR(200) NOT NULL DEFAULT '',
          sort_order INT NOT NULL DEFAULT 0,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_gallery ON gallery_images (madrasa_id, sort_order, id)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "014_session_expiry_bigint",
    up: async (api, dialect) => {
      // "Session save error." on every sign-in, MySQL only.
      //
      // app_sessions.expires stores a JavaScript epoch value in MILLISECONDS
      // (Date.now() ≈ 1.79e12). It was declared INTEGER, which MySQL reads as
      // a 4-byte signed INT whose maximum is 2,147,483,647 — roughly 2.1e9.
      // Every INSERT therefore died with ER_WARN_DATA_OUT_OF_RANGE
      // ("Out of range value for column 'expires'"), express-session's
      // save() callback received the error, and POST /api/auth/login answered
      // 500 { error: "Session save error." } even though the username and
      // password were perfectly correct. SQLite never hit this because its
      // INTEGER is 8 bytes, which is why local development looked fine.
      //
      // BIGINT holds millisecond epochs until the year 292 million.
      if (dialect === "mysql") {
        await api.run(`ALTER TABLE app_sessions MODIFY COLUMN expires BIGINT NULL`);
        // Session payloads carry the CSRF token and flash state; TEXT (64 KB)
        // is enough today but MEDIUMTEXT removes the whole class of silent
        // truncation failures that also surface as "Session save error.".
        await api.run(`ALTER TABLE app_sessions MODIFY COLUMN data MEDIUMTEXT NULL`);
      }
      // Any row already written with a clamped/garbage expiry is unusable;
      // dropping them only forces a fresh sign-in.
      await api.run(`DELETE FROM app_sessions WHERE expires IS NULL OR expires <= 0`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "015_admin_workspace",
    up: async (api, dialect) => {
      // A distinct register for staff attendance. Student attendance already
      // has a student_id foreign key, so recording staff in it would either
      // corrupt reports or force fake student records. Keep the two ledgers
      // separate and tenant-owned.
      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_attendance (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          day DATE NOT NULL,
          status VARCHAR(10) NOT NULL DEFAULT 'present',
          recorded_by INT,
          created_at ${D.ts()},
          UNIQUE (madrasa_id, user_id, day)
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_attendance ON teacher_attendance (madrasa_id, day, user_id)`);

      // Recruitment applicants are intentionally separate from real teacher
      // accounts. A candidate cannot sign in or see tenant data until an
      // administrator explicitly approves the application and creates their
      // credentials.
      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_applications (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          full_name VARCHAR(160) NOT NULL,
          email VARCHAR(120) NOT NULL DEFAULT '',
          phone VARCHAR(60) NOT NULL DEFAULT '',
          message TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          review_note TEXT,
          reviewed_by INT,
          reviewed_at TIMESTAMP NULL,
          teacher_user_id INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_applications ON teacher_applications (madrasa_id, status, id)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "016_homework_kind",
    up: async (api) => {
      // Lessons and assignments share delivery, deadlines and visibility but
      // remain distinct in the administrator and family workspaces.
      await api.run(`ALTER TABLE homework ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'assignment'`);
      await api.run(`CREATE INDEX idx_homework_kind ON homework (madrasa_id, kind, id)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "017_quran_hifz_progress",
    up: async (api, dialect) => {
      // An optional, tenant-scoped Islamic academic register. The category
      // gate is enforced by routes/quran-progress.js; there is intentionally
      // no category column here, so this remains a single shared data model.
      await api.run(`
        CREATE TABLE IF NOT EXISTS quran_progress (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          student_id INT NOT NULL,
          surah VARCHAR(80) NOT NULL DEFAULT '',
          juz VARCHAR(20) NOT NULL DEFAULT '',
          ayah_from INT,
          ayah_to INT,
          memorization_progress INT NOT NULL DEFAULT 0,
          revision_progress INT NOT NULL DEFAULT 0,
          recitation_assessment INT,
          tajweed_assessment INT,
          teacher_comments TEXT,
          progress_date DATE NOT NULL,
          performance_status VARCHAR(30) NOT NULL DEFAULT 'developing',
          recorded_by INT,
          created_at ${D.ts()},
          updated_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_quran_progress_student ON quran_progress (madrasa_id, student_id, progress_date)`);
      await api.run(`CREATE INDEX idx_quran_progress_status ON quran_progress (madrasa_id, performance_status, progress_date)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "018_my_institution",
    up: async (api, dialect) => {
      // ---- ADMIN → MY INSTITUTION -------------------------------------
      // The institution identity an administrator maintains in
      // "Institution Profile" / "Institution Information". These are
      // narrative and factual fields that previously had nowhere to live,
      // so the public site had to guess them. Every column is nullable or
      // defaults to '' so EXISTING ROWS ARE UNCHANGED.
      for (const [col, type] of [
        // Profile — identity & narrative
        ["badge_path", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["short_description", "VARCHAR(400) NOT NULL DEFAULT ''"],
        ["history", "TEXT"],
        ["mission", "TEXT"],
        ["vision", "TEXT"],
        ["core_values", "TEXT"],
        ["philosophy", "TEXT"],
        ["ownership_type", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["head_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["head_title", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["registration_no", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["accreditation_body", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["accreditation_details", "TEXT"],
        // Information — operations
        ["country", "VARCHAR(80) NOT NULL DEFAULT 'Nigeria'"],
        ["alt_phone", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["admissions_email", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["emergency_contact", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["opening_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["closing_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["school_days", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["levels_offered", "VARCHAR(400) NOT NULL DEFAULT ''"],
        ["islamic_education_info", "TEXT"],
        ["western_education_info", "TEXT"],
        ["languages_of_instruction", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["student_capacity", "INT"],
        ["boarding_status", "VARCHAR(40) NOT NULL DEFAULT ''"],
        ["admission_status", "VARCHAR(20) NOT NULL DEFAULT 'open'"],
        // Appearance — website theming. Both education sections get their
        // own accent inside ONE shared institution identity, which is why
        // the base palette is stored once and only the accents diverge.
        ["secondary_color", "VARCHAR(20) NOT NULL DEFAULT ''"],
        ["background_color", "VARCHAR(20) NOT NULL DEFAULT ''"],
        ["text_color", "VARCHAR(20) NOT NULL DEFAULT ''"],
        ["islamic_color", "VARCHAR(20) NOT NULL DEFAULT ''"],
        ["western_color", "VARCHAR(20) NOT NULL DEFAULT ''"],
        ["font_family", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["header_style", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["footer_style", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["button_style", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["card_style", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["homepage_layout", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["website_theme", "VARCHAR(30) NOT NULL DEFAULT ''"],
        ["favicon_path", "VARCHAR(255) NOT NULL DEFAULT ''"],
        // Public website publication state. Existing tenants stay exactly
        // as visible as they are today (public_listing already decides the
        // directory); website_published starts at 1 so nothing goes dark.
        ["website_published", "INT NOT NULL DEFAULT 1"],
        ["seo_title", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["seo_description", "VARCHAR(320) NOT NULL DEFAULT ''"],
        ["seo_keywords", "VARCHAR(255) NOT NULL DEFAULT ''"],
        // Contact — extra channels and public/private visibility switches
        ["twitter", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["youtube", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["linkedin", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["tiktok", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["show_phone", "INT NOT NULL DEFAULT 1"],
        ["show_alt_phone", "INT NOT NULL DEFAULT 0"],
        ["show_email", "INT NOT NULL DEFAULT 1"],
        ["show_admissions_email", "INT NOT NULL DEFAULT 1"],
        ["show_whatsapp", "INT NOT NULL DEFAULT 1"],
        ["show_address", "INT NOT NULL DEFAULT 1"],
        ["show_map", "INT NOT NULL DEFAULT 1"],
        ["show_hours", "INT NOT NULL DEFAULT 1"],
        ["show_socials", "INT NOT NULL DEFAULT 1"],
        ["show_head", "INT NOT NULL DEFAULT 0"],
        ["show_emergency", "INT NOT NULL DEFAULT 0"],
        ["contact_form_enabled", "INT NOT NULL DEFAULT 1"],
        // Settings — localisation & institution identifiers
        ["school_code", "VARCHAR(40) NOT NULL DEFAULT ''"],
        ["timezone", "VARCHAR(60) NOT NULL DEFAULT 'Africa/Lagos'"],
        ["currency", "VARCHAR(10) NOT NULL DEFAULT 'NGN'"],
        ["default_language", "VARCHAR(10) NOT NULL DEFAULT 'en'"],
        ["date_format", "VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY'"],
      ]) {
        await api.run(`ALTER TABLE madaris ADD COLUMN ${col} ${type}`);
      }

      // Public website pages. A page is content the administrator writes and
      // explicitly publishes — nothing is forced live. `slug` is unique per
      // tenant so the public projection can address one page directly.
      await api.run(`
        CREATE TABLE IF NOT EXISTS website_pages (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          slug VARCHAR(80) NOT NULL,
          title VARCHAR(160) NOT NULL,
          summary VARCHAR(400) NOT NULL DEFAULT '',
          body ${dialect === "mysql" ? "MEDIUMTEXT" : "TEXT"},
          seo_title VARCHAR(160) NOT NULL DEFAULT '',
          seo_description VARCHAR(320) NOT NULL DEFAULT '',
          is_published INT NOT NULL DEFAULT 0,
          in_navigation INT NOT NULL DEFAULT 0,
          is_system INT NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          created_at ${D.ts()},
          updated_at ${D.ts()},
          UNIQUE (madrasa_id, slug)
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_website_pages ON website_pages (madrasa_id, sort_order, id)`);

      // Gallery albums group the existing gallery_images rows. The old table
      // is extended (never replaced) so every photo already uploaded stays
      // exactly where it is, simply un-albumed until an admin files it.
      await api.run(`
        CREATE TABLE IF NOT EXISTS gallery_albums (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          title VARCHAR(160) NOT NULL,
          description VARCHAR(600) NOT NULL DEFAULT '',
          category VARCHAR(60) NOT NULL DEFAULT 'School Activities',
          cover_image_id INT,
          is_published INT NOT NULL DEFAULT 1,
          is_featured INT NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_gallery_albums ON gallery_albums (madrasa_id, sort_order, id)`);

      await api.run(`ALTER TABLE gallery_images ADD COLUMN album_id INT`);
      await api.run(`ALTER TABLE gallery_images ADD COLUMN category VARCHAR(60) NOT NULL DEFAULT 'School Activities'`);
      await api.run(`ALTER TABLE gallery_images ADD COLUMN media_type VARCHAR(10) NOT NULL DEFAULT 'image'`);
      // Videos are referenced by URL rather than uploaded: the platform's
      // upload pipeline is image-only by design (middleware/upload.js), and
      // hosting video would change the storage contract in docs/PERSISTENCE.md.
      await api.run(`ALTER TABLE gallery_images ADD COLUMN video_url VARCHAR(500) NOT NULL DEFAULT ''`);
      await api.run(`ALTER TABLE gallery_images ADD COLUMN is_published INT NOT NULL DEFAULT 1`);
      await api.run(`ALTER TABLE gallery_images ADD COLUMN is_featured INT NOT NULL DEFAULT 0`);
      await api.run(`CREATE INDEX idx_gallery_album ON gallery_images (madrasa_id, album_id, sort_order)`);
    },
  },
  /* ------------------------------------------------------------------ */
  {
    id: "019_complete_student_management",
    up: async (api, dialect) => {
      // The original student table is retained as the source of truth. These
      // columns add the registration/profile detail needed by the admin
      // workspace without splitting Islamic and Western learners into two
      // databases.
      const studentColumns = [
        ["student_code", "VARCHAR(60)"],
        ["middle_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["preferred_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["nationality", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["state_of_origin", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["lga", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["religion", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["admission_date", "DATE"],
        ["section", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["islamic_class_id", "INT"],
        ["western_class_id", "INT"],
        ["islamic_program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["western_program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["student_type", "VARCHAR(20) NOT NULL DEFAULT 'new'"],
        ["previous_school", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["previous_class", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["father_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["mother_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["guardian_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["guardian_relationship", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["alternative_phone", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["parent_email", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["emergency_contact", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["emergency_info", "TEXT"],
        ["residential_address", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["archived_at", dialect === "mysql" ? "TIMESTAMP NULL" : "TEXT"],
      ];
      for (const [name, type] of studentColumns) await api.run(`ALTER TABLE students ADD COLUMN ${name} ${type}`);
      // Existing records receive a stable, human-readable ID. Admission
      // numbers are already unique within a madrasa and remain unchanged.
      await api.run("UPDATE students SET student_code = admission_no WHERE student_code = '' OR student_code IS NULL");
      await api.run("CREATE UNIQUE INDEX idx_students_code ON students (madrasa_id, student_code)");
      await api.run("CREATE INDEX idx_students_directory ON students (madrasa_id, status, class_id, session_id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_status_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT NOT NULL,
          from_status VARCHAR(20), to_status VARCHAR(20) NOT NULL, reason VARCHAR(500) NOT NULL DEFAULT '',
          changed_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_status_history ON student_status_history (madrasa_id, student_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_class_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT NOT NULL,
          from_class_id INT, to_class_id INT, from_session_id INT, to_session_id INT,
          action VARCHAR(30) NOT NULL DEFAULT 'placement', notes VARCHAR(500) NOT NULL DEFAULT '',
          changed_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_class_history ON student_class_history (madrasa_id, student_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_groups (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, name VARCHAR(160) NOT NULL,
          group_type VARCHAR(60) NOT NULL DEFAULT 'custom', description TEXT,
          leader_student_id INT, teacher_id INT, status VARCHAR(20) NOT NULL DEFAULT 'active',
          created_by INT, created_at ${D.ts()}, updated_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_groups ON student_groups (madrasa_id, status, group_type, id)");
      await api.run(`
        CREATE TABLE IF NOT EXISTS student_group_members (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, group_id INT NOT NULL,
          student_id INT NOT NULL, joined_at ${D.ts()},
          UNIQUE (madrasa_id, group_id, student_id)
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_group_members ON student_group_members (madrasa_id, student_id, group_id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_documents (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT NOT NULL,
          document_name VARCHAR(200) NOT NULL, storage_path VARCHAR(500) NOT NULL,
          original_name VARCHAR(255) NOT NULL DEFAULT '', mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0, uploaded_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_documents ON student_documents (madrasa_id, student_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_communications (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT NOT NULL,
          channel VARCHAR(30) NOT NULL DEFAULT 'note', subject VARCHAR(200) NOT NULL DEFAULT '',
          message TEXT NOT NULL, created_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_communications ON student_communications (madrasa_id, student_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS student_life_records (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT NOT NULL,
          category VARCHAR(30) NOT NULL DEFAULT 'activity', title VARCHAR(200) NOT NULL,
          details TEXT, record_date DATE, created_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_student_life_records ON student_life_records (madrasa_id, student_id, category, id)");

      const applicationColumns = [
        ["middle_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["father_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["mother_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["guardian_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["guardian_relationship", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["preferred_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["nationality", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["state_of_origin", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["lga", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["religion", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["section", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["islamic_class_id", "INT"],
        ["western_class_id", "INT"],
        ["islamic_program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["western_program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["student_type", "VARCHAR(20) NOT NULL DEFAULT 'new'"],
        ["alternative_phone", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["emergency_contact", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["additional_info", "TEXT"],
        ["desired_session_id", "INT"],
        ["fee_status", "VARCHAR(20) NOT NULL DEFAULT 'unpaid'"],
        ["fee_reference", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["interview_date", "DATE"],
        ["interview_notes", "TEXT"],
      ];
      for (const [name, type] of applicationColumns) await api.run(`ALTER TABLE admission_requests ADD COLUMN ${name} ${type}`);
      await api.run(`
        CREATE TABLE IF NOT EXISTS admission_application_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, application_id INT NOT NULL,
          from_status VARCHAR(30), to_status VARCHAR(30) NOT NULL, note TEXT,
          changed_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_admission_history ON admission_application_history (madrasa_id, application_id, id)");
      await api.run(`
        CREATE TABLE IF NOT EXISTS admission_documents (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, application_id INT NOT NULL,
          document_name VARCHAR(200) NOT NULL, storage_path VARCHAR(500) NOT NULL,
          original_name VARCHAR(255) NOT NULL DEFAULT '', mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0, uploaded_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_admission_documents ON admission_documents (madrasa_id, application_id, id)");
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "020_teacher_class_modules",
    up: async (api, dialect) => {
      // Teachers remain normal `users` with role='teacher' so authentication,
      // tenant isolation and teacher permissions continue to work. This
      // profile table adds the professional directory fields and is one-to-one
      // with users, not a separate teacher account system.
      const nullableTs = dialect === "mysql" ? "TIMESTAMP NULL" : "TEXT";
      const ident = (name) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error("Unsafe identifier in migration: " + name);
        return name;
      };
      async function columnExists(table, name) {
        if (dialect === "sqlite") {
          const rows = await api.all(`PRAGMA table_info(${ident(table)})`);
          return rows.some((r) => String(r.name).toLowerCase() === String(name).toLowerCase());
        }
        const rows = await api.all(`SHOW COLUMNS FROM ${ident(table)} LIKE ?`, [name]);
        return rows.length > 0;
      }
      async function addColumn(table, name, type) {
        if (!await columnExists(table, name)) await api.run(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(name)} ${type}`);
      }
      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_profiles (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          staff_id VARCHAR(60),
          first_name VARCHAR(100) NOT NULL DEFAULT '',
          middle_name VARCHAR(100) NOT NULL DEFAULT '',
          last_name VARCHAR(100) NOT NULL DEFAULT '',
          photo_path VARCHAR(500) NOT NULL DEFAULT '',
          gender VARCHAR(20) NOT NULL DEFAULT '',
          date_of_birth DATE,
          nationality VARCHAR(80) NOT NULL DEFAULT '',
          state_name VARCHAR(80) NOT NULL DEFAULT '',
          lga VARCHAR(80) NOT NULL DEFAULT '',
          residential_address VARCHAR(255) NOT NULL DEFAULT '',
          alternative_phone VARCHAR(60) NOT NULL DEFAULT '',
          emergency_contact VARCHAR(160) NOT NULL DEFAULT '',
          emergency_relationship VARCHAR(80) NOT NULL DEFAULT '',
          employment_date DATE,
          employment_type VARCHAR(60) NOT NULL DEFAULT '',
          position VARCHAR(120) NOT NULL DEFAULT '',
          department VARCHAR(120) NOT NULL DEFAULT '',
          education_track VARCHAR(20) NOT NULL DEFAULT 'both',
          qualifications TEXT,
          certifications TEXT,
          specialization VARCHAR(200) NOT NULL DEFAULT '',
          years_experience INT NOT NULL DEFAULT 0,
          academic_session_id INT,
          available_days TEXT,
          available_periods TEXT,
          employment_history TEXT,
          professional_development TEXT,
          awards TEXT,
          training TEXT,
          achievements TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          source_application_id INT,
          archived_at ${nullableTs},
          created_at ${D.ts()},
          updated_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE UNIQUE INDEX idx_teacher_profiles_user ON teacher_profiles (madrasa_id, user_id)`);
      await api.run(`CREATE UNIQUE INDEX idx_teacher_profiles_staff ON teacher_profiles (madrasa_id, staff_id)`);
      await api.run(`CREATE INDEX idx_teacher_profiles_directory ON teacher_profiles (madrasa_id, status, department, education_track)`);

      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_documents (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          document_type VARCHAR(60) NOT NULL DEFAULT 'other',
          document_name VARCHAR(200) NOT NULL,
          storage_path VARCHAR(500) NOT NULL,
          original_name VARCHAR(255) NOT NULL DEFAULT '',
          mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0,
          uploaded_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_documents ON teacher_documents (madrasa_id, user_id, id)`);

      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_status_history (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          user_id INT NOT NULL,
          from_status VARCHAR(20),
          to_status VARCHAR(20) NOT NULL,
          reason VARCHAR(500) NOT NULL DEFAULT '',
          changed_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_status_history ON teacher_status_history (madrasa_id, user_id, id)`);

      const applicationColumns = [
        ["application_id", "VARCHAR(60)"],
        ["first_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["middle_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["last_name", "VARCHAR(100) NOT NULL DEFAULT ''"],
        ["application_date", "DATE"],
        ["position_applied", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["subjects_specialization", "TEXT"],
        ["qualifications", "TEXT"],
        ["certifications", "TEXT"],
        ["specialization", "VARCHAR(200) NOT NULL DEFAULT ''"],
        ["experience_years", "INT NOT NULL DEFAULT 0"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["employment_type", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["contact_details", "TEXT"],
        ["documents_summary", "TEXT"],
        ["interview_date", "DATE"],
        ["interview_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["interview_location", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["interview_panel", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["interview_notes", "TEXT"],
        ["requested_information", "TEXT"],
        ["updated_at", nullableTs],
        ["archived_at", nullableTs],
      ];
      for (const [name, type] of applicationColumns) await addColumn("teacher_applications", name, type);
      await api.run(`CREATE UNIQUE INDEX idx_teacher_applications_ref ON teacher_applications (madrasa_id, application_id)`);

      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_application_history (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          application_id INT NOT NULL,
          from_status VARCHAR(30),
          to_status VARCHAR(30) NOT NULL,
          note TEXT,
          changed_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_application_history ON teacher_application_history (madrasa_id, application_id, id)`);

      await api.run(`
        CREATE TABLE IF NOT EXISTS teacher_application_documents (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          application_id INT NOT NULL,
          document_type VARCHAR(60) NOT NULL DEFAULT 'other',
          document_name VARCHAR(200) NOT NULL,
          storage_path VARCHAR(500) NOT NULL,
          original_name VARCHAR(255) NOT NULL DEFAULT '',
          mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0,
          uploaded_by INT,
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_teacher_application_documents ON teacher_application_documents (madrasa_id, application_id, id)`);

      // Extend existing teaching assignments instead of replacing them. The
      // original nullable class_id/subject_id contract remains the permission
      // source for attendance, results, lessons and timetable access.
      for (const [name, type] of [
        ["role", "VARCHAR(40) NOT NULL DEFAULT 'subject_teacher'"],
        ["academic_session_id", "INT"],
        ["assigned_periods", "TEXT"],
        ["notes", "VARCHAR(500) NOT NULL DEFAULT ''"],
        ["created_at", nullableTs],
      ]) await addColumn("teacher_assignments", name, type);
      await api.run(`CREATE INDEX idx_teacher_assignments_class ON teacher_assignments (madrasa_id, class_id, user_id)`);

      // Classes stay in the original `classes` table. These columns supply the
      // class-directory metadata for Islamic, Western and dual-track programmes.
      const classColumns = [
        ["class_code", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["level_name", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["section_arm", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["session_id", "INT"],
        ["term_id", "INT"],
        ["class_teacher_id", "INT"],
        ["assistant_teacher_id", "INT"],
        ["max_capacity", "INT"],
        ["description", "TEXT"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'active'"],
        ["archived_at", nullableTs],
        ["updated_at", nullableTs],
      ];
      for (const [name, type] of classColumns) await addColumn("classes", name, type);
      await api.run(`UPDATE classes SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END WHERE status = '' OR status IS NULL`);
      await api.run(`CREATE INDEX idx_classes_directory ON classes (madrasa_id, status, education_track, program, level_name)`);
      await api.run(`CREATE INDEX idx_classes_code ON classes (madrasa_id, class_code)`);

      await api.run(`CREATE INDEX idx_timetable_room ON timetable_slots (madrasa_id, room, day, period)`);
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "021_academic_programs_and_attendance_detail",
    up: async (api, dialect) => {
      // The original platform already had one shared subjects table. Extend
      // that table rather than introducing a second Islamic/Western catalogue.
      // This keeps class subjects, teacher assignments, results and report
      // cards on the same subject ids for dual-track institutions.
      const nullableTs = dialect === "mysql" ? "TIMESTAMP NULL" : "TEXT";
      const ident = (name) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error("Unsafe identifier in migration: " + name);
        return name;
      };
      async function columnExists(table, name) {
        if (dialect === "sqlite") {
          const rows = await api.all(`PRAGMA table_info(${ident(table)})`);
          return rows.some((r) => String(r.name).toLowerCase() === String(name).toLowerCase());
        }
        const rows = await api.all(`SHOW COLUMNS FROM ${ident(table)} LIKE ?`, [name]);
        return rows.length > 0;
      }
      async function addColumn(table, name, type) {
        if (!await columnExists(table, name)) await api.run(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(name)} ${type}`);
      }

      for (const [name, type] of [
        ["subject_code", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["category", "VARCHAR(80) NOT NULL DEFAULT 'Other Subjects'"],
        ["description", "TEXT"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["academic_level", "VARCHAR(80) NOT NULL DEFAULT ''"],
        ["session_id", "INT"],
        ["term_id", "INT"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'active'"],
        ["archived_at", nullableTs],
        ["created_at", nullableTs],
        ["updated_at", nullableTs],
      ]) await addColumn("subjects", name, type);
      await api.run("UPDATE subjects SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END WHERE status = '' OR status IS NULL");
      await api.run("UPDATE subjects SET category = 'Other Subjects' WHERE category = '' OR category IS NULL");
      // Backfill the catalogue rows seeded by older releases so the existing
      // sidebar categories become real filters without duplicating subjects.
      for (const [category, names] of Object.entries({
        Mathematics: ["Mathematics"], English: ["English"], Sciences: ["Sciences", "Science", "Biology", "Chemistry", "Physics"],
        "Computer Science": ["Computer Science"], Technology: ["Technology"], Business: ["Business"], Arts: ["Arts"],
        "Social Sciences": ["Social Sciences"], Languages: ["Languages", "Arabic", "Arabic Language"],
        "Other Subjects": ["Other Subjects", "Other"],
      })) {
        for (const name of names) await api.run("UPDATE subjects SET category = ? WHERE LOWER(name_en) = LOWER(?) AND category = 'Other Subjects'", [category, name]);
      }
      for (const name of ["Qur'an", "Qur'an Memorization", "Tajweed", "Hadith", "Fiqh", "Tawheed", "Aqeedah", "Seerah", "Nahw", "Sarf", "Islamic Studies", "Imla'", "Arabic Reading", "Arabic Expression"]) {
        await api.run("UPDATE subjects SET education_track = 'islamic' WHERE LOWER(name_en) = LOWER(?) AND education_track = 'both'", [name]);
      }
      await api.run("CREATE INDEX idx_subjects_directory ON subjects (madrasa_id, category, education_track, status)");
      await api.run("CREATE INDEX idx_subjects_code ON subjects (madrasa_id, subject_code)");

      for (const [name, type] of [
        ["session_id", "INT"], ["term_id", "INT"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'active'"], ["assigned_at", nullableTs],
      ]) await addColumn("class_subjects", name, type);
      await api.run("CREATE INDEX idx_class_subjects_term ON class_subjects (madrasa_id, class_id, session_id, term_id)");

      for (const [name, type] of [
        ["term_id", "INT"], ["status", "VARCHAR(20) NOT NULL DEFAULT 'active'"],
      ]) await addColumn("teacher_assignments", name, type);
      await api.run("CREATE INDEX idx_teacher_assignments_subject ON teacher_assignments (madrasa_id, subject_id, term_id)");

      // Attendance keeps the existing student ledger and dedicated staff
      // ledger. These fields make every record self-describing and editable.
      for (const [name, type] of [
        ["session_id", "INT"], ["attendance_note", "TEXT"], ["updated_at", nullableTs],
      ]) await addColumn("attendance", name, type);
      for (const [name, type] of [["attendance_total", "INT NOT NULL DEFAULT 0"], ["attendance_percentage", "DECIMAL(6,2) NOT NULL DEFAULT 0"]]) await addColumn("term_summaries", name, type);
      await api.run("CREATE INDEX idx_attendance_reporting ON attendance (madrasa_id, day, class_id, term_id, session_id, status)");

      for (const [name, type] of [
        ["session_id", "INT"], ["term_id", "INT"], ["check_in", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["check_out", "VARCHAR(5) NOT NULL DEFAULT ''"], ["notes", "TEXT"], ["updated_at", nullableTs],
      ]) await addColumn("teacher_attendance", name, type);
      await api.run("CREATE INDEX idx_teacher_attendance_reporting ON teacher_attendance (madrasa_id, day, term_id, session_id, status)");

      // Exams are a first-class academic record. Exam marks continue to live
      // in the shared results table so report cards do not need a duplicate
      // result architecture.
      await api.run(`
        CREATE TABLE IF NOT EXISTS exams (
          id ${D.autoInc(dialect)},
          madrasa_id INT NOT NULL,
          title VARCHAR(200) NOT NULL,
          description TEXT,
          class_id INT NOT NULL,
          subject_id INT NOT NULL,
          session_id INT,
          term_id INT,
          exam_date DATE,
          total_marks DECIMAL(7,2) NOT NULL DEFAULT 100,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          created_by INT,
          created_at ${D.ts()},
          updated_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_exams_directory ON exams (madrasa_id, class_id, subject_id, session_id, term_id, exam_date)");
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "022_complete_academic_admissions",
    up: async (api, dialect) => {
      // Complete the existing shared academic/admissions records in place.
      // No Islamic/Western duplicate tables are created: education_track is
      // carried by the same lessons, assignments, examinations and applicants.
      const nullableTs = dialect === "mysql" ? "TIMESTAMP NULL" : "TEXT";
      const ident = (name) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error("Unsafe identifier in migration: " + name);
        return name;
      };
      async function columnExists(table, name) {
        if (dialect === "sqlite") {
          const rows = await api.all(`PRAGMA table_info(${ident(table)})`);
          return rows.some((row) => String(row.name).toLowerCase() === String(name).toLowerCase());
        }
        return (await api.all(`SHOW COLUMNS FROM ${ident(table)} LIKE ?`, [name])).length > 0;
      }
      async function addColumn(table, name, type) {
        if (!await columnExists(table, name)) await api.run(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(name)} ${type}`);
      }

      // Sessions and terms remain the platform's original period records.
      for (const [name, type] of [
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'upcoming'"],
        ["archived_at", nullableTs], ["updated_at", nullableTs],
      ]) await addColumn("academic_sessions", name, type);
      await api.run("UPDATE academic_sessions SET status = CASE WHEN is_current = 1 THEN 'active' ELSE status END");
      await api.run("CREATE INDEX idx_academic_sessions_status ON academic_sessions (madrasa_id, status, is_current)");

      for (const [name, type] of [
        ["result_submission_deadline", "DATE"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'upcoming'"],
        ["is_current", "INT NOT NULL DEFAULT 0"],
        ["updated_at", nullableTs],
      ]) await addColumn("terms", name, type);
      await api.run("CREATE INDEX idx_terms_status ON terms (madrasa_id, session_id, status, is_current)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS academic_period_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          entity_type VARCHAR(20) NOT NULL, entity_id INT NOT NULL,
          action VARCHAR(40) NOT NULL, from_status VARCHAR(20), to_status VARCHAR(20),
          note TEXT, changed_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_academic_period_history ON academic_period_history (madrasa_id, entity_type, entity_id, id)");

      // The original homework table is the existing lesson/assignment source
      // of truth. It is expanded instead of being replaced.
      for (const [name, type] of [
        ["teacher_id", "INT"], ["topic", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["objectives", "TEXT"], ["content", "TEXT"], ["learning_materials", "TEXT"],
        ["lesson_date", "DATE"], ["period", "VARCHAR(40) NOT NULL DEFAULT ''"],
        ["homework_text", "TEXT"], ["assigned_date", "DATE"],
        ["maximum_score", "DECIMAL(7,2) NOT NULL DEFAULT 100"],
        ["session_id", "INT"], ["term_id", "INT"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'published'"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["archived_at", nullableTs], ["updated_at", nullableTs],
      ]) await addColumn("homework", name, type);
      await api.run("UPDATE homework SET teacher_id = created_by WHERE teacher_id IS NULL");
      await api.run("CREATE INDEX idx_homework_academic ON homework (madrasa_id, kind, status, session_id, term_id, class_id, subject_id)");
      await api.run("CREATE INDEX idx_homework_teacher ON homework (madrasa_id, teacher_id, kind, lesson_date)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS academic_attachments (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          entity_type VARCHAR(30) NOT NULL, entity_id INT NOT NULL,
          display_name VARCHAR(200) NOT NULL, storage_path VARCHAR(500) NOT NULL,
          original_name VARCHAR(255) NOT NULL DEFAULT '', mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0, uploaded_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_academic_attachments ON academic_attachments (madrasa_id, entity_type, entity_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS academic_item_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          entity_type VARCHAR(30) NOT NULL, entity_id INT NOT NULL,
          action VARCHAR(40) NOT NULL, from_status VARCHAR(20), to_status VARCHAR(20),
          summary TEXT, changed_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_academic_item_history ON academic_item_history (madrasa_id, entity_type, entity_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS assignment_submissions (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          assignment_id INT NOT NULL, student_id INT NOT NULL,
          submission_text TEXT, attachment_path VARCHAR(500) NOT NULL DEFAULT '',
          original_name VARCHAR(255) NOT NULL DEFAULT '', mime_type VARCHAR(120) NOT NULL DEFAULT '',
          file_size INT NOT NULL DEFAULT 0, submitted_at ${nullableTs},
          status VARCHAR(20) NOT NULL DEFAULT 'submitted', score DECIMAL(7,2),
          feedback TEXT, graded_by INT, graded_at ${nullableTs},
          updated_at ${nullableTs},
          UNIQUE (madrasa_id, assignment_id, student_id)
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_assignment_submissions ON assignment_submissions (madrasa_id, assignment_id, status, student_id)");

      // Extend the existing exam schedule. One row is one class/subject sitting;
      // a named examination can therefore span many schedule rows safely.
      for (const [name, type] of [
        ["start_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["end_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["duration_minutes", "INT NOT NULL DEFAULT 0"],
        ["invigilator_id", "INT"], ["classroom", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["instructions", "TEXT"], ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["published_at", nullableTs], ["cancelled_at", nullableTs],
      ]) await addColumn("exams", name, type);
      await api.run("CREATE INDEX idx_exam_conflicts ON exams (madrasa_id, exam_date, start_time, end_time, invigilator_id, class_id, classroom)");

      // Results retain the original CA/exam/total columns and gain an explicit
      // moderation workflow plus traceability. 'approved' is the default so
      // pre-existing integrations that insert rows directly keep working;
      // the HTTP gradebook explicitly writes new entries as draft/submitted.
      for (const [name, type] of [
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'approved'"],
        ["grade", "VARCHAR(10) NOT NULL DEFAULT ''"], ["grade_point", "DECIMAL(6,2) NOT NULL DEFAULT 0"],
        ["teacher_remark", "TEXT"], ["entered_by", "INT"], ["modified_by", "INT"],
        ["submitted_at", nullableTs], ["approved_by", "INT"], ["approved_at", nullableTs],
        ["published_at", nullableTs],
      ]) await addColumn("results", name, type);
      await api.run("CREATE INDEX idx_results_workflow ON results (madrasa_id, class_id, term_id, subject_id, status)");

      // Admission requirements are configurable and can be scoped without
      // splitting either education track into a separate admissions database.
      await api.run(`
        CREATE TABLE IF NOT EXISTS admission_requirements (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          name VARCHAR(200) NOT NULL, description TEXT,
          is_required INT NOT NULL DEFAULT 1, document_type VARCHAR(100) NOT NULL DEFAULT '',
          class_id INT, program VARCHAR(120) NOT NULL DEFAULT '',
          education_track VARCHAR(20) NOT NULL DEFAULT 'both', session_id INT,
          status VARCHAR(20) NOT NULL DEFAULT 'active', archived_at ${nullableTs},
          created_by INT, created_at ${D.ts()}, updated_at ${nullableTs}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_admission_requirements ON admission_requirements (madrasa_id, status, session_id, class_id, education_track)");

      for (const [name, type] of [
        ["photo_path", "VARCHAR(500) NOT NULL DEFAULT ''"],
        ["contact_phone", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["contact_email", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["previous_class", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["interview_time", "VARCHAR(5) NOT NULL DEFAULT ''"],
        ["interview_location", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["interview_status", "VARCHAR(20) NOT NULL DEFAULT 'not_scheduled'"],
        ["requested_information", "TEXT"],
      ]) await addColumn("admission_requests", name, type);
      await addColumn("admission_documents", "requirement_id", "INT");
      await addColumn("admission_documents", "verification_status", "VARCHAR(20) NOT NULL DEFAULT 'pending'");
      await api.run("CREATE INDEX idx_admission_pipeline ON admission_requests (madrasa_id, desired_session_id, education_track, class_id, status, created_at)");
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: "023_communication_and_finance",
    up: async (api, dialect) => {
      // Communication is one tenant-scoped system. The original announcements
      // and chat tables remain the source tables; these columns and the
      // conversation/recipient tables add the workflow without creating a
      // second website, parent account or student relationship.
      const nullableTs = dialect === "mysql" ? "TIMESTAMP NULL" : "TEXT";
      const add = async (table, column, type) => {
        // This migration is applied once per database. Keeping the DDL here
        // deliberately boring makes it safe for both SQLite and MySQL.
        await api.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      };

      for (const [name, type] of [
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'published'"],
        ["scheduled_at", nullableTs], ["published_at", nullableTs], ["archived_at", nullableTs],
        ["image_path", "VARCHAR(500) NOT NULL DEFAULT ''"],
        ["attachment_path", "VARCHAR(500) NOT NULL DEFAULT ''"],
        ["attachment_name", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["attachment_mime", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["target_type", "VARCHAR(40) NOT NULL DEFAULT 'all'"],
        ["target_ids", "TEXT"], ["updated_at", nullableTs],
      ]) await add("announcements", name, type);
      await api.run("CREATE INDEX idx_announcements_delivery ON announcements (madrasa_id, status, target_type, created_at)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS communication_conversations (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL,
          subject VARCHAR(200) NOT NULL DEFAULT '', kind VARCHAR(20) NOT NULL DEFAULT 'individual',
          created_by INT, status VARCHAR(20) NOT NULL DEFAULT 'active',
          archived_at ${nullableTs}, created_at ${D.ts()}, updated_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run(`CREATE INDEX idx_comm_conversations ON communication_conversations (madrasa_id, status, updated_at)`);
      await api.run(`
        CREATE TABLE IF NOT EXISTS communication_participants (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, conversation_id INT NOT NULL,
          user_id INT NOT NULL, participant_role VARCHAR(30) NOT NULL DEFAULT '',
          last_read_at ${nullableTs}, archived_at ${nullableTs},
          UNIQUE (madrasa_id, conversation_id, user_id)
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_comm_participants ON communication_participants (madrasa_id, user_id, conversation_id)");
      for (const [name, type] of [
        ["conversation_id", "INT"], ["recipient_user_id", "INT"],
        ["message_type", "VARCHAR(20) NOT NULL DEFAULT 'direct'"],
        ["read_at", nullableTs], ["archived_at", nullableTs],
        ["attachment_path", "VARCHAR(500) NOT NULL DEFAULT ''"],
        ["attachment_name", "VARCHAR(255) NOT NULL DEFAULT ''"],
        ["attachment_mime", "VARCHAR(120) NOT NULL DEFAULT ''"],
      ]) await add("messages", name, type);
      await api.run("CREATE INDEX idx_direct_messages ON messages (madrasa_id, conversation_id, recipient_user_id, id)");

      await api.run(`
        CREATE TABLE IF NOT EXISTS notifications (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, recipient_user_id INT NOT NULL,
          type VARCHAR(50) NOT NULL, title VARCHAR(200) NOT NULL, body TEXT NOT NULL,
          entity_type VARCHAR(50) NOT NULL DEFAULT '', entity_id INT,
          channel VARCHAR(20) NOT NULL DEFAULT 'in_app', read_at ${nullableTs},
          created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_notifications_recipient ON notifications (madrasa_id, recipient_user_id, read_at, id)");
      await api.run(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, user_id INT NOT NULL,
          notification_type VARCHAR(50) NOT NULL DEFAULT '*', in_app INT NOT NULL DEFAULT 1,
          email INT NOT NULL DEFAULT 0, sms INT NOT NULL DEFAULT 0, whatsapp INT NOT NULL DEFAULT 0,
          UNIQUE (madrasa_id, user_id, notification_type)
        )${D.engine(dialect)}
      `);
      await api.run(`
        CREATE TABLE IF NOT EXISTS communication_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, student_id INT,
          recipient_user_id INT, parent_user_id INT, channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
          message_type VARCHAR(50) NOT NULL, subject VARCHAR(200) NOT NULL DEFAULT '',
          message TEXT NOT NULL, delivery_status VARCHAR(20) NOT NULL DEFAULT 'recorded',
          sent_by INT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_communication_history ON communication_history (madrasa_id, student_id, recipient_user_id, id)");

      // Fee structures keep the existing fee_items table as the canonical fee
      // catalogue. Assignments are the per-student ledger; payments reference
      // assignments when one exists and still support legacy general payments.
      for (const [name, type] of [
        ["session_id", "INT"], ["class_id", "INT"], ["program", "VARCHAR(120) NOT NULL DEFAULT ''"],
        ["education_track", "VARCHAR(20) NOT NULL DEFAULT 'both'"],
        ["student_category", "VARCHAR(60) NOT NULL DEFAULT ''"],
        ["description", "TEXT"], ["due_date", "DATE"],
        ["is_required", "INT NOT NULL DEFAULT 1"], ["status", "VARCHAR(20) NOT NULL DEFAULT 'active'"],
        ["archived_at", nullableTs], ["created_by", "INT"], ["updated_at", nullableTs],
      ]) await add("fee_items", name, type);
      await api.run("CREATE INDEX idx_fee_structures ON fee_items (madrasa_id, session_id, term_id, class_id, status)");
      await api.run(`
        CREATE TABLE IF NOT EXISTS fee_assignments (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, fee_item_id INT NOT NULL,
          student_id INT NOT NULL, amount_due DECIMAL(12,2) NOT NULL DEFAULT 0,
          due_date DATE, status VARCHAR(20) NOT NULL DEFAULT 'due', assigned_by INT,
          created_at ${D.ts()}, updated_at ${D.ts()},
          UNIQUE (madrasa_id, fee_item_id, student_id)
        )${D.engine(dialect)}
      `);
      await api.run("CREATE INDEX idx_fee_assignments ON fee_assignments (madrasa_id, student_id, status, due_date)");
      for (const [name, type] of [
        ["parent_user_id", "INT"], ["session_id", "INT"], ["term_id", "INT"],
        ["transaction_number", "VARCHAR(160) NOT NULL DEFAULT ''"],
        ["status", "VARCHAR(20) NOT NULL DEFAULT 'successful'"],
        ["receipt_number", "VARCHAR(100) NOT NULL DEFAULT ''"], ["fee_assignment_id", "INT"],
        ["notes", "TEXT"], ["updated_at", nullableTs], ["refunded_at", nullableTs],
      ]) await add("fee_payments", name, type);
      await api.run("CREATE INDEX idx_fee_payments_reporting ON fee_payments (madrasa_id, payment_date, status, session_id, term_id, method)");
      await api.run(`
        CREATE TABLE IF NOT EXISTS fee_assignment_history (
          id ${D.autoInc(dialect)}, madrasa_id INT NOT NULL, fee_assignment_id INT NOT NULL,
          action VARCHAR(30) NOT NULL, amount DECIMAL(12,2), changed_by INT,
          details TEXT, created_at ${D.ts()}
        )${D.engine(dialect)}
      `);
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
  // Say which file this run touches: a migrate against the wrong SQLite file is
  // how a "new empty database" appears next to the real one.
  require("./db-target").announce({ allowCreate: true });
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { migrate, pendingMigrations, MIGRATIONS };
