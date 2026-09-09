"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — seed
   ----------------------------------------------------------------------------
   1. Creates the default subscription plans (FREE / BASIC / PREMIUM) if absent.
   2. Creates the single platform SUPER ADMIN on a fresh database, using the
      SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD environment variables.
      (Nothing is created if a super admin already exists.)
   3. With the --demo flag, creates two fully-populated demo madaris so the
      platform (and tenant isolation) can be tried immediately.

   Usage:  npm run seed          (plans + super admin)
           npm run seed -- --demo (also demo data)
   ========================================================================== */
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");
const { migrate } = require("./migrate");

const DEFAULT_PLANS = [
  {
    code: "free", name: "Free", name_ar: "مجاني", price_ngn: 0,
    student_limit: 50, teacher_limit: 3,
    features: { report_cards: true, attendance: true, fees: false, announcements: true },
    sort_order: 1,
  },
  {
    code: "basic", name: "Basic", name_ar: "أساسي", price_ngn: 8000,
    student_limit: 300, teacher_limit: 15,
    features: { report_cards: true, attendance: true, fees: true, announcements: true },
    sort_order: 2,
  },
  {
    code: "premium", name: "Premium", name_ar: "مميز", price_ngn: 20000,
    student_limit: -1, teacher_limit: -1,
    features: { report_cards: true, attendance: true, fees: true, announcements: true, ai: true, exports: true },
    sort_order: 3,
  },
];

async function seedPlans() {
  const existing = await db.get("SELECT COUNT(*) AS n FROM plans");
  if (existing && Number(existing.n) > 0) return 0;
  let n = 0;
  for (const p of DEFAULT_PLANS) {
    await db.run(
      "INSERT INTO plans (code, name, name_ar, price_ngn, student_limit, teacher_limit, features, sort_order) VALUES (?,?,?,?,?,?,?,?)",
      [p.code, p.name, p.name_ar, p.price_ngn, p.student_limit, p.teacher_limit, JSON.stringify(p.features), p.sort_order]
    );
    n++;
  }
  return n;
}

async function seedSuperAdmin() {
  const existing = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'");
  if (existing && Number(existing.n) > 0) return false;
  if (!config.SUPER_ADMIN_PASSWORD) {
    console.warn("SUPER_ADMIN_PASSWORD not set — skipping super admin creation.");
    return false;
  }
  const hash = bcrypt.hashSync(config.SUPER_ADMIN_PASSWORD, 10);
  await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (NULL, ?, ?, 'super_admin', 'Platform Super Admin')",
    [config.SUPER_ADMIN_USERNAME, hash]
  );
  console.log(`Super admin created: ${config.SUPER_ADMIN_USERNAME} (change the password after first login).`);
  return true;
}

/* --------------------------- demo data ---------------------------------- */

const DEMO_SUBJECTS = [
  ["Qur'an (Tajwid)", "تجويد القرآن"],
  ["Hadith", "الحديث"],
  ["Fiqh", "الفقه"],
  ["Arabic Grammar (Nahw)", "النحو"],
  ["Arabic Morphology (Sarf)", "الصرف"],
  ["Sirah", "السيرة"],
  ["Tahdhib (Adab)", "التهذيب"],
  ["Arabic Language", "اللغة العربية"],
  ["English", "اللغة الإنجليزية"],
  ["Mathematics", "الرياضيات"],
];

function makeAdmissionNo(prefix, n) {
  return `${prefix}${String(n).padStart(4, "0")}`;
}

async function createDemoMadrasa(slug, names, city, planCode, prefix) {
  const plan = await db.get("SELECT * FROM plans WHERE code = ?", [planCode]);
  const r = await db.run(
    `INSERT INTO madaris (slug, name_en, name_ar, motto_en, motto_ar, address, city, state_name, phone, email, plan_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      slug, names.en, names.ar, "Knowledge, Faith, Character", "العلم والإيمان والأخلاق",
      `12 Market Road, ${city}`, city, "Ogun", "+234 803 000 0000", `info@${slug}.example`,
      plan ? plan.id : 1,
    ]
  );
  const mid = r.lastInsertRowid;

  // Users
  async function mkUser(username, role, fullName, arName = "") {
    const hash = bcrypt.hashSync("Demo1234!", 10);
    const res = await db.run(
      "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, full_name_ar, email, phone) VALUES (?,?,?,?,?,?,?,?)",
      [mid, username, hash, role, fullName, arName, `${username}@${slug}.example`, "+234 800 000 0000"]
    );
    return res.lastInsertRowid;
  }
  const adminId = await mkUser(`${slug}-admin`, "madrasa_admin", "Madrasa Administrator", "مدير المدرسة");

  // Sessions + terms
  const s = await db.run(
    "INSERT INTO academic_sessions (madrasa_id, label, start_date, end_date, is_current) VALUES (?,?, '2025-09-01', '2026-08-31', 1)",
    [mid, "2025/2026"]
  );
  const sessionId = s.lastInsertRowid;
  const termIds = {};
  for (const [pos, [en, ar]] of [[1, ["First Term", "الفترة الأولى"]], [2, ["Second Term", "الفترة الثانية"]], [3, ["Third Term", "الفترة الثالثة"]]]) {
    const t = await db.run(
      "INSERT INTO terms (madrasa_id, session_id, position, name_en, name_ar, start_date, end_date) VALUES (?,?,?,?,?,?,?)",
      [mid, sessionId, pos, en, ar, "2025-09-01", "2025-12-19"]
    );
    termIds[pos] = t.lastInsertRowid;
  }

  // Grading config: CA 40 / Exam 60, pass 50, classic bands
  await db.run(
    `INSERT INTO grading_config (madrasa_id, ca_max, exam_max, pass_mark, promotion_min_average, promotion_require_pass, grade_bands)
     VALUES (?, 40, 60, 50, 50, 1, ?)`,
    [mid, JSON.stringify([
      { min: 75, grade: "A", remark: "Excellent", remark_ar: "ممتاز" },
      { min: 65, grade: "B", remark: "Very Good", remark_ar: "جيد جداً" },
      { min: 55, grade: "C", remark: "Good", remark_ar: "جيد" },
      { min: 45, grade: "D", remark: "Fair", remark_ar: "مقبول" },
      { min: 40, grade: "E", remark: "Weak", remark_ar: "ضعيف" },
      { min: 0, grade: "F", remark: "Fail", remark_ar: "راسب" },
    ])]
  );

  // Classes
  const classes = [
    ["Al-Qur'an Class 1", "قسم القرآن الأول", "Beginner"],
    ["Al-Qur'an Class 2", "قسم القرآن الثاني", "Intermediate"],
    ["Arabic Studies 1", "قسم اللغة العربية الأول", "Advanced"],
    ["Arabic Studies 2", "قسم اللغة العربية الثاني", "Advanced"],
  ];
  const classIds = {};
  for (let i = 0; i < classes.length; i++) {
    const [en, ar, level] = classes[i];
    const c = await db.run(
      "INSERT INTO classes (madrasa_id, name_en, name_ar, sort_order) VALUES (?,?,?,?)",
      [mid, en, ar, i + 1]
    );
    classIds[level + i] = c.lastInsertRowid;
  }

  // Subjects (per madrasa, EN + AR)
  const subjectIds = {};
  for (const [en, ar] of DEMO_SUBJECTS) {
    const st = await db.run("INSERT INTO subjects (madrasa_id, name_en, name_ar) VALUES (?,?,?)", [mid, en, ar]);
    subjectIds[en] = st.lastInsertRowid;
  }
  // Every class gets Qur'an + Fiqh + Arabic Language + English + Maths
  const coreSubjects = ["Qur'an (Tajwid)", "Fiqh", "Arabic Language", "English", "Mathematics"];
  for (const cid of Object.values(classIds)) {
    for (const sname of coreSubjects) {
      await db.insertIgnore("class_subjects", "madrasa_id, class_id, subject_id", [mid, cid, subjectIds[sname]]);
    }
  }

  // Teachers + assignments
  const teacher1 = await mkUser(`${slug}-ust1`, "teacher", "Ustadh Ibrahim Oluwaseun", "الشيخ إبراهيم");
  await db.insertIgnore("teacher_assignments", "madrasa_id, user_id, class_id, subject_id", [mid, teacher1, classIds["Beginner0"], subjectIds["Qur'an (Tajwid)"]]);
  await db.insertIgnore("teacher_assignments", "madrasa_id, user_id, class_id, subject_id", [mid, teacher1, classIds["Intermediate1"], subjectIds["Fiqh"]]);

  // Students
  const demoStudents = [
    ["Adeyemi", "Kunle", "أديمي كوني", "M", "2012-04-11", 0, "Parent of Kunle", "Parent1234!"],
    ["Ogunlana", "Sola", "أوغونلانا سولا", "F", "2011-11-02", 0, "Parent of Sola", "Parent1234!"],
    ["Bello", "Ibrahim", "بيلو إبراهيم", "M", "2013-06-19", 2, "Parent of Ibrahim", "Parent1234!"],
    ["Olalekan", "Folake", "أولاليكان فوليك", "F", "2012-01-25", 3, "Parent of Folake", "Parent1234!"],
  ];
  const studentIds = [];
  for (let i = 0; i < demoStudents.length; i++) {
    const [first, last, ar, gender, dob, ci, pname] = demoStudents[i];
    const classId = Object.values(classIds)[ci];
    const st = await db.run(
       `INSERT INTO students (madrasa_id, admission_no, first_name, last_name, name_ar, gender, date_of_birth, class_id, session_id, parent_name, parent_phone, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mid, makeAdmissionNo(prefix, i + 1), first, last, ar, gender, dob, classId, sessionId, pname, "+234 801 111 2222", `${city}, Ogun State`]
    );
    studentIds.push(st.lastInsertRowid);
  }

  // Parent accounts linked to first two students
  for (let i = 0; i < 2; i++) {
    const puser = await db.run(
      "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
      [mid, `${slug}-parent${i + 1}`, bcrypt.hashSync("Parent1234!", 10), "parent", `Guardian of ${demoStudents[i].last_name}`]
    );
    await db.insertIgnore("parent_links", "madrasa_id, user_id, student_id", [mid, puser.lastInsertRowid, studentIds[i]]);
  }
  // Student portal accounts for the first two students (linked to their records)
  for (let i = 0; i < 2; i++) {
    const r = await db.run(
      "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, student_id) VALUES (?,?,?,?,?,?)",
      [mid, `${slug}-stu${i + 1}`, bcrypt.hashSync("Student1234!", 10), "student", `${demoStudents[i].first_name} ${demoStudents[i].last_name}`, studentIds[i]]
    );
  }

  // Results: 2 students, First Term, all 5 core subjects (deterministic scores)
  const termId = termIds[1];
  let score = 62;
  for (const sid of [studentIds[0], studentIds[1]]) {
    const stu = await db.get("SELECT class_id FROM students WHERE id = ?", [sid]);
    for (const sname of coreSubjects) {
      const ca = Math.min(40, score % 41);
      const exam = Math.min(60, (score * 7) % 61);
      await db.run(
        `INSERT INTO results (madrasa_id, student_id, class_id, session_id, term_id, subject_id, ca, exam, total)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [mid, sid, stu.class_id, sessionId, termId, subjectIds[sname], ca, exam, ca + exam]
      );
      score += 7;
    }
  }

  // Attendance for First Term (30 school days)
  for (const sid of studentIds) {
    const stu = await db.get("SELECT class_id FROM students WHERE id = ?", [sid]);
    for (let d = 8; d < 28; d++) {
      const absent = (sid + d) % 9 === 0;
      await db.insertIgnore("attendance", "madrasa_id, student_id, class_id, term_id, day, status, recorded_by",
        [mid, sid, stu.class_id, termId, `2025-09-${String(d).padStart(2, "0")}`, absent ? "absent" : "present", adminId]);
    }
  }

  // Fees
  const fee1 = await db.run(
    "INSERT INTO fee_items (madrasa_id, term_id, name_en, name_ar, amount_ngn) VALUES (?,?,?,?,?)",
    [mid, termId, "First Term Tuition", "رسوم الفصل الأول", 5000]
  );
  const fee2 = await db.run(
    "INSERT INTO fee_items (madrasa_id, term_id, name_en, name_ar, amount_ngn) VALUES (?,?,?,?,?)",
    [mid, termId, "Book Fee", "رسوم الكتب", 1500]
  );
  await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, reference, recorded_by) VALUES (?,?,?,?,?,?,?,?)",
    [mid, studentIds[0], fee1.lastInsertRowid, 5000, "2025-09-05", "cash", "RECP-0001", adminId]
  );
  await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, reference, recorded_by) VALUES (?,?,?,?,?,?,?,?)",
    [mid, studentIds[0], fee2.lastInsertRowid, 1500, "2025-09-05", "cash", "RECP-0002", adminId]
  );

  // Announcements
  await db.run(
    "INSERT INTO announcements (madrasa_id, title, body, audience, is_active, created_by) VALUES (?,?,?,?,1,?)",
    [mid, "Examination Commencement", "First term examinations will commence on the 15th of December. Students should arrive at 8:00 AM sharp. / تبدأ امتحانات الفصل الأول في 15 ديسمبر. على الطلاب الحضور في الساعة 8:00 صباحاً.", "all", adminId]
  );

  // Settings: admission prefix
  await db.insertIgnore("settings", "madrasa_id, key_name, value", [mid, "admission_prefix", prefix]);

  return { mid, adminId, teacher1, studentIds, planCode };
}

async function seedDemo() {
  const a = await createDemoMadrasa(
    "demo-quraniyya",
    { en: "Al-Quraniyya Model Madrasa", ar: "مدرسة القرونية النموذجية" },
    "Ijebu-Ode", "basic", "ALQ"
  );
  const b = await createDemoMadrasa(
    "demo-fatihah",
    { en: "Fatihah Islamic Studies College", ar: "كلية الفاتحة للدراسات الإسلامية" },
    "Ijebu-Ode", "free", "FAT"
  );
  console.log("Demo data created:");
  console.log(`  Madrasa A: ${a.mid} (plan: ${a.planCode})`);
  console.log(`  Madrasa B: ${b.mid} (plan: ${b.planCode})`);
  console.log("  Demo logins (password for all demo users is shown in docs/README demo section)");
}

(async () => {
  try {
    await migrate();
    const plans = await seedPlans();
    if (plans) console.log(`Seeded ${plans} subscription plan(s).`);
    await seedSuperAdmin();
    if (process.argv.includes("--demo")) {
      const existing = await db.get("SELECT COUNT(*) AS n FROM madaris");
      if (existing && Number(existing.n) > 0) {
        console.log("Demo madaris already exist — skipping demo data.");
      } else {
        await seedDemo();
      }
    }
    await db.close();
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
})();
