"use strict";
/* ============================================================================
   BELLO-INSTITUTE LOAD TEST — realistic multi-tenant dataset seeder
   ----------------------------------------------------------------------------
   Builds a DEDICATED test database (never the dev/production one):

     DATABASE_FILE=data/loadtest.sqlite npm run loadtest:seed

   Dataset shape (multi-tenant, not one giant madrasa):
     • 55 institutions (islamic / western / both) across 3 size tiers
     • ~12,000 students, ~600 teachers, ~500+ classes, per-tenant sessions,
       terms, subjects, class_subjects, teacher_assignments
     • attendance for the last 12 school days (~150k rows)
     • results for 4 subjects in the current term (~50k rows)
     • fee items / assignments / payments (mixed paid, partial, overdue)
     • announcements, notifications, audit/activity log rows
     • library books + loans (including active/overdue)
     • pending admission requests
     • published public websites (pages + gallery) for public traffic

   All test accounts share ONE dedicated test password (no real credentials).
   The bcrypt hash is computed once and reused — inserts stay fast while
   login still pays the full, real bcrypt.compare cost.
   ========================================================================== */
const path = require("path");
const fs = require("fs");

// The test database is selected BEFORE the app modules load (config reads env
// at require time). Refuse to touch anything that is not the load-test file.
const DB_FILE = String(process.env.DATABASE_FILE || "");
if (!/loadtest\.sqlite$/.test(DB_FILE)) {
  console.error("FATAL: set DATABASE_FILE=.../loadtest.sqlite so the seeder can never touch a real database.");
  console.error("       (got: \"" + DB_FILE + "\")");
  process.exit(1);
}
process.env.DATABASE_DRIVER = process.env.DATABASE_DRIVER || "sqlite";
process.env.NODE_ENV = process.env.NODE_ENV || "development";

const bcrypt = require("bcryptjs");
const { migrate } = require("../server/migrate");
const db = require("../server/db");

const TEST_PASSWORD = "LoadTest#2026!x";
const RNG_SEED = 20260921;
// Deterministic PRNG so the dataset is reproducible run to run.
let rngState = RNG_SEED;
function rnd() { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; }
function ri(min, max) { return min + Math.floor(rnd() * (max - min + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const FIRST = ["Muhammad", "Aisha", "Ibrahim", "Fatima", "Yusuf", "Zainab", "Musa", "Khadijah", "Isa", "Maryam", "Sulaiman", "Hafsat", "Abdullah", "Amina", "Bilal", "Sumayyah", "Umar", "Ruqayyah", "Ali", "Safiyyah", "David", "Grace", "Samuel", "Blessing", "Daniel", "Esther", "Joseph", "Deborah", "Emmanuel", "Rebecca", "Michael", "Hannah", "Peter", "Sarah", "Paul", "Ruth"];
const LAST = ["Bello", "Ogunleye", "Adewumi", "Sulaimon", "Oyelaran", "Adebayo", "Okesola", "Animashaun", "Bakare", "Odukoya", "Salami", "Onasanya", "Abdulsalam", "Eleshinmeta", "Kukoyi", "Osisami", "Odeyemi", "Obadina", "Olatunji", "Ogunbanwo", "Oke", "Oyebode"];
const CITIES = [["Ijebu-Ode", "Ogun"], ["Ijebu-Igbo", "Ogun"], ["Odogbolu", "Ogun"], ["Sagamu", "Ogun"], ["Abeokuta", "Ogun"], ["Lagos", "Lagos"], ["Ibadan", "Oyo"]];

function isoDay(offsetDays) { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); }
function ts(offsetDays) { return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 19).replace("T", " "); }

/** NOT NULL column metadata per table (defaults substituted for nulls). */
const tableMeta = {};
async function notNullDefaults(table) {
  if (!tableMeta[table]) {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    const map = {};
    for (const c of rows || []) {
      if (!c.notnull) continue;
      let dflt = c.dflt_value;
      if (dflt === null || dflt === undefined || dflt === "NULL") dflt = "";
      else if (/^'.*'$/.test(String(dflt))) dflt = String(dflt).slice(1, -1);
      else if (/^-?\d+(\.\d+)?$/.test(String(dflt))) dflt = Number(dflt);
      map[c.name] = dflt;
    }
    tableMeta[table] = map;
  }
  return tableMeta[table];
}

/** Multi-row INSERT helper, chunked + wrapped by the caller's transaction.
 *  An explicit NULL against a NOT NULL column (even one with a default) is
 *  replaced by the column's declared default, so row builders can stay terse. */
async function bulkInsert(table, cols, rows, chunk = 400) {
  if (!rows.length) return 0;
  const nn = await notNullDefaults(table);
  const ph = "(" + cols.map(() => "?").join(",") + ")";
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = part.map(() => ph).join(",");
    const params = [];
    for (const r of part) {
      r.forEach((v, j) => { params.push(v === null && nn[cols[j]] !== undefined ? nn[cols[j]] : v); });
    }
    await db.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`, params);
  }
  return rows.length;
}

async function main() {
  console.log("Seeding load-test dataset into " + DB_FILE);
  await migrate();

  // A marker row in platform_settings makes the dataset self-identifying.
  const existing = await db.get("SELECT COUNT(*) AS n FROM madaris WHERE slug LIKE 'lt-%'");
  if (Number(existing.n) > 0 && !process.argv.includes("--force")) {
    console.error("Load-test data already present (" + existing.n + " lt-* madaris). Re-run with --force after deleting the file, or use a fresh DATABASE_FILE.");
    process.exit(1);
  }

  const counts = {};
  const accounts = []; // -> loadtest/accounts.json
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10); // ONE hash, reused

  // ---- plans -----------------------------------------------------------
  await db.run("INSERT OR IGNORE INTO plans (code,name,name_ar,price_ngn,student_limit,teacher_limit,features,is_active,sort_order) VALUES (?,?,?,?,?,?,?,?,?)",
    ["trial", "Trial", "تجربة", 0, 50, 10, "{}", 1, 0]);
  await db.run("INSERT OR IGNORE INTO plans (code,name,name_ar,price_ngn,student_limit,teacher_limit,features,is_active,sort_order) VALUES (?,?,?,?,?,?,?,?,?)",
    ["growth", "Growth", "نمو", 25000, 500, 50, "{}", 1, 1]);

  const tiers = [
    { n: 25, classes: 6, students: 120, teachers: 6 },   // small madrasa
    { n: 20, classes: 10, students: 220, teachers: 10 },  // medium
    { n: 10, classes: 14, students: 350, teachers: 16 },  // large school
  ];
  const totalMadaris = tiers.reduce((a, t) => a + t.n, 0); // 55

  let madrasaIdx = 0;
  for (const tier of tiers) {
    for (let k = 0; k < tier.n; k++, madrasaIdx++) {
      const [city, state] = pick(CITIES);
      const category = madrasaIdx % 5 === 4 ? "western" : (madrasaIdx % 5 === 3 ? "both" : "islamic");
      const slug = "lt-" + ["noor", "iman", "hikmah", "fao", "ridwan", "abc", "goodhope", "crescent", "peace", "dawn"][madrasaIdx % 10] + "-" + (madrasaIdx + 1);
      await db.transaction(async (tx) => {
        const m = await tx.run(
          `INSERT INTO madaris (slug,name_en,name_ar,motto_en,city,state_name,phone,email,plan_id,status,public_listing,public_results,public_admissions,category,website_published,description_en,verified,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [slug, (category === "western" ? "Academy" : "Madrasa") + " " + (madrasaIdx + 1) + " " + pick(LAST), "مدرسة " + (madrasaIdx + 1),
            "Knowledge and character", city, state, "+23480" + ri(10000000, 99999999), "info@" + slug + ".example",
            2, "active", 1, 1, 1, category, 1, "A " + category + " institution in " + city + ".", 1, ts(-300), ts(-1)]);
        const mid = Number(m.lastInsertRowid);
        counts.madaris = (counts.madaris || 0) + 1;

        // Academic calendar: one current session, three terms (2nd current).
        const sess = await tx.run("INSERT INTO academic_sessions (madrasa_id,label,start_date,end_date,is_current,status) VALUES (?,?,?,?,?,?)", [mid, "2025/2026", "2025-09-15", "2026-07-31", 1, "active"]);
        const sessionId = Number(sess.lastInsertRowid);
        const termIds = [];
        for (let t = 0; t < 3; t++) {
          const tr = await tx.run("INSERT INTO terms (madrasa_id,session_id,position,name_en,start_date,end_date,status,is_current) VALUES (?,?,?,?,?,?,?,?)",
            [mid, sessionId, t + 1, "Term " + (t + 1), ["2025-09-15", "2026-01-12", "2026-05-04"][t], ["2025-12-12", "2026-04-03", "2026-07-31"][t], "active", t === 1 ? 1 : 0]);
          termIds.push(Number(tr.lastInsertRowid));
        }
        const currentTermId = termIds[1];

        // Subjects per category.
        const islamicSubjects = [["Qur'an", "core"], ["Tajwid", "core"], ["Fiqh", "core"], ["Arabic", "core"], ["Sirah", "elective"], ["Hadith", "elective"]];
        const westernSubjects = [["English", "core"], ["Mathematics", "core"], ["Basic Science", "core"], ["Social Studies", "core"], ["Civic Education", "elective"], ["Computer Studies", "elective"]];
        const subjectSet = category === "western" ? westernSubjects : category === "both" ? islamicSubjects.concat(westernSubjects) : islamicSubjects;
        const subjectIds = [];
        for (const [name, cat] of subjectSet) {
          const s = await tx.run("INSERT INTO subjects (madrasa_id,name_en,is_active,category,education_track,status) VALUES (?,?,1,?,?,?)",
            [mid, name, cat, category === "western" ? "western" : "islamic", "active"]);
          subjectIds.push(Number(s.lastInsertRowid));
        }

        // Staff: one admin, a finance officer on half the tenants, teachers.
        const adminUser = await tx.run("INSERT INTO users (madrasa_id,username,password_hash,role,full_name,email,phone,is_active) VALUES (?,?,?,?,?,?,?,1)",
          [mid, "lt-a" + mid, passwordHash, "madrasa_admin", "Admin " + pick(LAST), "admin@" + slug + ".example", "+23480" + ri(10000000, 99999999)]);
        const adminId = Number(adminUser.lastInsertRowid);
        accounts.push({ username: "lt-a" + mid, role: "madrasa_admin", madrasaId: mid, slug });
        if (mid % 2 === 0) {
          await tx.run("INSERT INTO users (madrasa_id,username,password_hash,role,full_name,is_active) VALUES (?,?,?,?,?,1)", [mid, "lt-f" + mid, passwordHash, "madrasa_admin", "Bursar " + pick(LAST)]);
          accounts.push({ username: "lt-f" + mid, role: "finance", madrasaId: mid, slug });
        }

        const teacherIds = [];
        for (let t = 0; t < tier.teachers; t++) {
          const fn = pick(FIRST), ln = pick(LAST);
          const u = await tx.run("INSERT INTO users (madrasa_id,username,password_hash,role,full_name,email,is_active) VALUES (?,?,?,?,?,?,1)",
            [mid, "lt-t" + mid + "-" + t, passwordHash, "teacher", fn + " " + ln, "t" + t + "@" + slug + ".example"]);
          const uid = Number(u.lastInsertRowid);
          teacherIds.push(uid);
          await tx.run("INSERT INTO teacher_profiles (madrasa_id,user_id,staff_id,first_name,last_name,position,department,status,public_display) VALUES (?,?,?,?,?,?,?,?,1)",
            [mid, uid, "STF-" + mid + "-" + String(t + 1).padStart(3, "0"), fn, ln, "Teacher", pick(["Qur'an", "Arabic", "Sciences", "Humanities"]), "active"]);
          if (t < 12) accounts.push({ username: "lt-t" + mid + "-" + t, role: "teacher", madrasaId: mid, slug });
        }
        const teacherClassIds = {}; // teacher user id -> assigned class ids

        // Classes + class_subjects + teacher assignments.
        const classIds = [];
        for (let c = 0; c < tier.classes; c++) {
          const level = ["KG 1", "KG 2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3", "Hifz 1"][c % 14];
          const cr = await tx.run(
            "INSERT INTO classes (madrasa_id,name_en,sort_order,is_active,class_code,education_track,level_name,session_id,status,class_teacher_id) VALUES (?,?,?,1,?,?,?,?,?,?)",
            [mid, level + " " + ["A", "B", "C"][c % 3], c, mid + "-C" + (c + 1), category === "western" ? "western" : "islamic", level, sessionId, "active", teacherIds[c % teacherIds.length]]);
          const cid = Number(cr.lastInsertRowid);
          classIds.push(cid);
          for (const sid of subjectIds.slice(0, 5 + (c % 3))) {
            await tx.run("INSERT INTO class_subjects (madrasa_id,class_id,subject_id,session_id,term_id,status) VALUES (?,?,?,?,?,'active')", [mid, cid, sid, sessionId, currentTermId]);
          }
          for (let a = 0; a < 3; a++) {
            const tId = teacherIds[(c * 3 + a) % teacherIds.length];
            await tx.run("INSERT INTO teacher_assignments (madrasa_id,user_id,class_id,subject_id,academic_session_id) VALUES (?,?,?,?,?)",
              [mid, tId, cid, subjectIds[a % subjectIds.length], sessionId]);
            (teacherClassIds[tId] = teacherClassIds[tId] || []).push(cid);
          }
        }
        // Students + parents + parent_links + portal student users.
        const parentRows = [];
        const parentLinkRows = [];
        const studentRows = [];
        const studentPortalRows = [];
        let parentN = 0;
        for (let s = 0; s < tier.students; s++) {
          const fn = pick(FIRST), ln = pick(LAST);
          const classId = classIds[s % classIds.length];
          studentRows.push([mid, "LT" + mid + "-" + String(s + 1).padStart(4, "0"), fn, ln, "", pick(["male", "female"]), isoDay(-(2900 + (s % 1500))), classId, sessionId,
            s % 17 === 0 ? "promoted" : (s % 61 === 0 ? "suspended" : "active"), ln + " " + pick(FIRST), "+23480" + ri(10000000, 99999999), pick(CITIES)[0], ts(-200 + (s % 120)), ts(-2),
            "LT" + mid + "-S" + String(s + 1).padStart(4, "0"), null, null, category === "western" ? "western" : "islamic"]);
        }
        await bulkInsert("students", ["madrasa_id", "admission_no", "first_name", "last_name", "name_ar", "gender", "date_of_birth", "class_id", "session_id", "status", "parent_name", "parent_phone", "address", "created_at", "updated_at", "student_code", "middle_name", "preferred_name", "education_track"], studentRows);
        counts.students = (counts.students || 0) + studentRows.length;

        const allStudents = await tx.all("SELECT id, class_id FROM students WHERE madrasa_id = ?", [mid]);
        for (let i = 0; i < allStudents.length; i += 2) {
          const s1 = allStudents[i];
          parentN++;
          const pu = await tx.run("INSERT INTO users (madrasa_id,username,password_hash,role,full_name,phone,is_active) VALUES (?,?,?,?,?,1)".replace(",1)", ",?,1)"),
            [mid, "lt-p" + mid + "-" + parentN, passwordHash, "parent", "Parent of " + s1.id, "+23480" + ri(10000000, 99999999)]);
          const puid = Number(pu.lastInsertRowid);
          parentLinkRows.push([mid, puid, s1.id]);
          if (allStudents[i + 1]) parentLinkRows.push([mid, puid, allStudents[i + 1].id]);
          if (parentN <= 25) accounts.push({ username: "lt-p" + mid + "-" + parentN, role: "parent", madrasaId: mid, slug });
        }
        await bulkInsert("parent_links", ["madrasa_id", "user_id", "student_id"], parentLinkRows);
        for (let i = 0; i < Math.min(6, allStudents.length); i++) {
          await tx.run("INSERT INTO users (madrasa_id,username,password_hash,role,full_name,is_active,student_id) VALUES (?,?,?,?,?,1,?)",
            [mid, "lt-s" + mid + "-" + i, passwordHash, "student", "Student " + allStudents[i].id, allStudents[i].id]);
        }

        // Attendance for the last 12 school days (skip Sundays).
        const attendanceRows = [];
        let dayOffset = 0;
        const days = [];
        while (days.length < 12) {
          const d = new Date(); d.setUTCDate(d.getUTCDate() - dayOffset);
          if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10));
          dayOffset++;
        }
        for (const day of days) {
          for (let ci = 0; ci < classIds.length; ci++) {
            if (ci % 5 === 4 && day === days[days.length - 1]) continue; // some classes unmarked today
            for (const s of allStudents) {
              if (s.class_id !== classIds[ci]) continue;
              const r = rnd();
              attendanceRows.push([mid, s.id, classIds[ci], currentTermId, day, r < 0.86 ? "present" : r < 0.93 ? "late" : "absent", adminId, sessionId]);
            }
          }
        }
        await bulkInsert("attendance", ["madrasa_id", "student_id", "class_id", "term_id", "day", "status", "recorded_by", "session_id"], attendanceRows, 300);
        counts.attendance = (counts.attendance || 0) + attendanceRows.length;

        // Results: 4 subjects per student in the current term.
        const resultRows = [];
        const statuses = ["draft", "submitted", "approved", "published", "published", "published"];
        for (const s of allStudents) {
          for (const subId of subjectIds.slice(0, 4)) {
            const ca = ri(12, 30), exam = ri(28, 68);
            const total = ca + exam;
            resultRows.push([mid, s.id, s.class_id, sessionId, currentTermId, subId, ca, exam, total, ts(-30), ts(-5), pick(statuses),
              total >= 70 ? "A" : total >= 60 ? "B" : total >= 50 ? "C" : total >= 45 ? "D" : "F",
              total >= 70 ? 4 : total >= 60 ? 3 : total >= 50 ? 2 : total >= 45 ? 1 : 0, teacherIds[s.id % teacherIds.length]]);
          }
        }
        await bulkInsert("results", ["madrasa_id", "student_id", "class_id", "session_id", "term_id", "subject_id", "ca", "exam", "total", "created_at", "updated_at", "status", "grade", "grade_point", "entered_by"], resultRows, 300);
        counts.results = (counts.results || 0) + resultRows.length;

        // Fees: 2 items, assignments for all, payments for ~60%.
        const fee1 = await tx.run("INSERT INTO fee_items (madrasa_id,term_id,name_en,amount_ngn,session_id,due_date,is_required,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
          [mid, currentTermId, "Tuition — Term 2", 25000, sessionId, isoDay(-20), 1, "active", adminId]);
        const fee2 = await tx.run("INSERT INTO fee_items (madrasa_id,term_id,name_en,amount_ngn,session_id,due_date,is_required,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
          [mid, currentTermId, "Registration", 5000, sessionId, isoDay(-60), 0, "active", adminId]);
        const feeIds = [Number(fee1.lastInsertRowid), Number(fee2.lastInsertRowid)];
        const assignmentRows = allStudents.map((s, i) => [mid, feeIds[0], s.id, 25000, isoDay(-20), "due", adminId]);
        await bulkInsert("fee_assignments", ["madrasa_id", "fee_item_id", "student_id", "amount_due", "due_date", "status", "assigned_by"], assignmentRows, 300);
        counts.fee_assignments = (counts.fee_assignments || 0) + assignmentRows.length;
        const paymentRows = [];
        for (const s of allStudents) {
          if (rnd() < 0.6) {
            const full = rnd() < 0.7;
            paymentRows.push([mid, s.id, feeIds[0], full ? 25000 : ri(5000, 20000), isoDay(-ri(1, 50)), pick(["cash", "transfer", "pos"]), "REF" + mid + "-" + s.id, adminId, sessionId, currentTermId, "successful", "REC-" + mid + "-" + s.id, feeIds[0], "verified"]);
          }
          if (rnd() < 0.1) paymentRows.push([mid, s.id, feeIds[1], 5000, isoDay(-ri(1, 50)), "transfer", "REG" + mid + "-" + s.id, adminId, sessionId, currentTermId, "failed", null, feeIds[1], "unverified"]);
        }
        await bulkInsert("fee_payments", ["madrasa_id", "student_id", "fee_item_id", "amount_ngn", "payment_date", "method", "reference", "recorded_by", "session_id", "term_id", "status", "receipt_number", "fee_assignment_id", "verification_status"], paymentRows, 300);
        counts.fee_payments = (counts.fee_payments || 0) + paymentRows.length;

        // Announcements, notifications, audit log.
        const annRows = [];
        for (let a = 0; a < 8; a++) {
          annRows.push([mid, "Notice " + (a + 1) + ": " + pick(["Resumption", "PTA meeting", "Examination timetable", "Fee deadline", "Excursion", "Graduation"]),
            "Details of the notice follow in this body text.", "all", 1, adminId, ts(-a * 3), 0, null, a % 3 === 0 ? "scheduled" : "published", "school_notice", null, null]);
        }
        await bulkInsert("announcements", ["madrasa_id", "title", "body", "audience", "is_active", "created_by", "created_at", "publish_public", "publish_until", "status", "category", "event_date", "event_location"], annRows);
        counts.announcements = (counts.announcements || 0) + annRows.length;

        const notifRows = [];
        for (let n = 0; n < 30; n++) {
          const target = parentLinkRows.length ? parentLinkRows[n % parentLinkRows.length][1] : adminId;
          notifRows.push([mid, target, pick(["school_notice", "fee_reminder", "student_absent", "payment_received"]), "Load test notice", "A notification body.", "notice", null, "in_app", null, ts(-n)]);
        }
        await bulkInsert("notifications", ["madrasa_id", "recipient_user_id", "type", "title", "body", "entity_type", "entity_id", "channel", "read_at", "created_at"], notifRows);
        counts.notifications = (counts.notifications || 0) + notifRows.length;

        const logRows = [];
        const actions = [["student.create", "students", "student"], ["attendance.mark", "attendance", "class"], ["fee_payment.record", "fees", "fee_payment"], ["announcement.create", "announcements", "announcement"], ["result.update", "results", "result"]];
        for (let a = 0; a < 80; a++) {
          const [action, module, entity] = actions[a % actions.length];
          logRows.push([mid, adminId, "madrasa_admin", action, module, entity, String(ri(1, 5000)), null, null, JSON.stringify({ note: "load test" }), "127.0.0.1", ts(-a)]);
        }
        await bulkInsert("activity_log", ["madrasa_id", "user_id", "user_role", "action", "module", "entity", "entity_id", "before_value", "after_value", "meta", "ip", "created_at"], logRows, 200);
        counts.activity_log = (counts.activity_log || 0) + logRows.length;

        // Library.
        const bookRows = [];
        for (let b = 0; b < 40; b++) {
          bookRows.push([mid, "Book " + pick(FIRST) + " of " + pick(LAST), pick(LAST) + " " + pick(FIRST), null, "Publisher " + b, 2010 + (b % 15), subjectIds[b % subjectIds.length], pick(["Islamic", "General", "Science"]), "Arabic/English", ri(3, 20), ri(0, 15), 0, ts(-100)]);
        }
        await bulkInsert("library_books", ["madrasa_id", "title", "author", "isbn", "publisher", "year", "subject_id", "category", "language", "total_copies", "available_copies", "is_archived", "created_at"], bookRows);
        counts.library_books = (counts.library_books || 0) + bookRows.length;
        const books = await tx.all("SELECT id FROM library_books WHERE madrasa_id = ?", [mid]);
        const loanRows = [];
        for (let l = 0; l < 25; l++) {
          const overdue = l % 7 === 0;
          loanRows.push([mid, books[l % books.length].id, teacherIds[l % teacherIds.length], "staff", adminId, isoDay(-ri(5, 30)), overdue ? isoDay(-ri(2, 8)) : isoDay(ri(1, 10)), null, overdue ? "active" : (l % 3 === 0 ? "returned" : "active"), null, null, ts(-30)]);
        }
        await bulkInsert("library_loans", ["madrasa_id", "book_id", "borrower_user_id", "borrower_type", "issued_by", "issue_date", "due_date", "return_date", "status", "fine_ngn", "notes", "created_at"], loanRows);
        counts.library_loans = (counts.library_loans || 0) + loanRows.length;

        // Pending admissions.
        const admRows = [];
        for (let a = 0; a < 15; a++) {
          admRows.push([mid, "LTR" + mid + String(a).padStart(3, "0"), a % 3 === 0 ? "under_review" : "pending", pick(FIRST), pick(LAST), null, pick(["male", "female"]), isoDay(-(2900 + a)), classIds[a % classIds.length], null, null, pick(LAST) + " " + pick(FIRST), "+23480" + ri(10000000, 99999999), null, pick(CITIES)[0], sessionId]);
        }
        await bulkInsert("admission_requests", ["madrasa_id", "reference", "status", "first_name", "last_name", "name_ar", "gender", "date_of_birth", "class_id", "previous_school", "quran_level", "parent_name", "parent_phone", "parent_email", "address", "desired_session_id"], admRows);
        counts.admission_requests = (counts.admission_requests || 0) + admRows.length;

        // Public website pages + gallery.
        const pageRows = [["about", "About us", "Our history and mission."], ["academics", "Academics", "Programmes we run."], ["admissions", "Admissions", "How to apply."], ["contact", "Contact", "Reach us."]]
          .map(([s2, t, sum], i) => [mid, s2, t, sum, "Page body for " + t + ".", 1, 1, 0, i, ts(-40), ts(-5)]);
        await bulkInsert("website_pages", ["madrasa_id", "slug", "title", "summary", "body", "is_published", "in_navigation", "is_system", "sort_order", "created_at", "updated_at"], pageRows);
        const alb = await tx.run("INSERT INTO gallery_albums (madrasa_id,title,description,is_published,sort_order) VALUES (?,?,?,?,?)", [mid, "School life", "Photos around the school", 1, 0]);
        const imgRows = [];
        for (let g = 0; g < 6; g++) imgRows.push([mid, "/uploads/lt/placeholder-" + g + ".jpg", "Gallery photo " + g, g, Number(alb.lastInsertRowid), "school_life", "image", null, 1, g === 0 ? 1 : 0, ts(-30)]);
        await bulkInsert("gallery_images", ["madrasa_id", "image_path", "caption", "sort_order", "album_id", "category", "media_type", "video_url", "is_published", "is_featured", "created_at"], imgRows);
      });
      process.stdout.write("\r  madrasa " + (madrasaIdx + 1) + "/" + totalMadaris + " seeded");
    }
  }
  console.log("");

  // ---- accounts index ----------------------------------------------------
  // Attach per-tenant references the scenario driver needs (sampled + bounded).
  const byRole = {};
  for (const acc of accounts) (byRole[acc.role] = byRole[acc.role] || []).push(acc);
  for (const acc of accounts) {
    if (acc.role === "teacher") {
      const rows = await db.all("SELECT ta.class_id FROM teacher_assignments ta JOIN users u ON u.id = ta.user_id WHERE u.username = ? LIMIT 8", [acc.username]);
      acc.classIds = rows.map((r) => Number(r.class_id));
    }
    if (acc.role === "parent") {
      const rows = await db.all("SELECT pl.student_id FROM parent_links pl JOIN users u ON u.id = pl.user_id WHERE u.username = ? LIMIT 5", [acc.username]);
      acc.studentIds = rows.map((r) => Number(r.student_id));
    }
    if (acc.role === "teacher" || acc.role === "madrasa_admin" || acc.role === "finance") {
      const subs = await db.all("SELECT id FROM subjects WHERE madrasa_id = ? ORDER BY id LIMIT 4", [acc.madrasaId]);
      acc.subjectIds = subs.map((x) => Number(x.id));
      const term = await db.get("SELECT id FROM terms WHERE madrasa_id = ? AND is_current = 1", [acc.madrasaId]);
      acc.termId = term ? Number(term.id) : null;
    }
  }
  // Sampled student ids per class (for attendance-mark write scenarios).
  const classStudentSamples = {};
  for (const row of await db.all("SELECT class_id, id AS student_id FROM students WHERE status = 'active' ORDER BY id LIMIT 8000")) {
    (classStudentSamples[row.class_id] = classStudentSamples[row.class_id] || []).push(Number(row.student_id));
  }
  const attachStudents = (acc) => {
    if (!acc.classIds || !acc.classIds.length) return;
    acc.classStudents = {};
    for (const cid of acc.classIds.slice(0, 4)) {
      const ss = classStudentSamples[cid];
      if (ss && ss.length) acc.classStudents[cid] = ss.slice(0, 12);
    }
  };
  const adminSample = byRole["madrasa_admin"].filter((a) => !a.username.startsWith("lt-f")).slice(0, 60);
  for (const acc of adminSample) {
    const cls = await db.all("SELECT id FROM classes WHERE madrasa_id = ? LIMIT 8", [acc.madrasaId]);
    acc.classIds = cls.map((c) => Number(c.id));
    attachStudents(acc);
  }
  const financeSample = byRole["finance"].slice(0, 30);
  for (const acc of byRole["teacher"].slice(0, 200)) attachStudents(acc);
  const slugs = (await db.all("SELECT slug FROM madaris WHERE slug LIKE 'lt-%' AND public_listing = 1 ORDER BY id LIMIT 60")).map((r) => r.slug);
  const out = {
    generatedAt: new Date().toISOString(),
    testPassword: TEST_PASSWORD,
    superAdmin: { username: process.env.SUPER_ADMIN_USERNAME || "admin", password: process.env.SUPER_ADMIN_PASSWORD || "" },
    slugs,
    users: adminSample.concat(financeSample, byRole["teacher"].slice(0, 200), byRole["parent"].slice(0, 400)),
  };
  fs.mkdirSync(path.join(__dirname), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "accounts.json"), JSON.stringify(out, null, 1));
  console.log("Wrote loadtest/accounts.json (" + out.users.length + " user accounts, " + slugs.length + " public slugs)");
  console.log("Dataset:", JSON.stringify(counts));
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
