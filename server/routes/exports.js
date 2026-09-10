"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — CSV exports (Excel / Google Sheets / backup of a
   term's records)
   ----------------------------------------------------------------------------
   All exports are tenant-scoped exactly like the screens they come from: a
   madrasa admin gets their own rows, a teacher only rows of classes assigned
   to them, and a super admin must name the tenant with ?madrasaId=.

     GET /api/exports/students.csv?classId=&status=
     GET /api/exports/results.csv?classId=&termId=
     GET /api/exports/summary.csv?classId=&termId=
     GET /api/exports/attendance.csv?classId=&from=&to=
     GET /api/exports/fees.csv?termId=&classId=
     GET /api/exports/admissions.csv?status=            (admins only)
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, toNum, cleanStr } = require("../util");
const { requireAuth, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments } = require("../middleware/tenant");
const csv = require("../services/csv");

const router = express.Router();
router.use(requireAuth);

const STAFF = requireRole("madrasa_admin", "teacher", "super_admin");
const ADMINS = requireRole("madrasa_admin", "super_admin");

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required (super admin: ?madrasaId=N)." }); return null; }
  return tid;
}

/** For teachers: the class ids they may export, or null when unrestricted. */
async function teacherClassFilter(req, tid, requestedClassId) {
  if (req.user.role !== "teacher") return requestedClassId ? [requestedClassId] : null;
  const scope = await getTeacherAssignments(tid, req.user.id);
  if (scope.anyClassAnySubject) return requestedClassId ? [requestedClassId] : null;
  const assigned = [...scope.assignedClassIds];
  return requestedClassId ? assigned.filter((c) => c === requestedClassId) : assigned;
}

function inClause(ids) {
  return ids.map(() => "?").join(",");
}

function filename(req, kind) {
  const d = new Date().toISOString().slice(0, 10);
  return `${kind}-${d}.csv`;
}

/* ------------------------------ students -------------------------------- */

router.get("/students.csv", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classIds = await teacherClassFilter(req, tid, toNum(req.query.classId, 0) || null);
  if (classIds && !classIds.length) return csv.sendCsv(res, filename(req, "students"), csv.toCsv([], []));
  const where = ["s.madrasa_id = ?"];
  const params = [tid];
  if (classIds) { where.push(`s.class_id IN (${inClause(classIds)})`); params.push(...classIds); }
  if (req.query.status) { where.push("s.status = ?"); params.push(cleanStr(req.query.status, 20)); }

  const rows = await db.all(
    `SELECT s.*, c.name_en AS class_en, s2.label AS session_label,
            (SELECT SUM(p.amount_ngn) FROM fee_payments p WHERE p.student_id = s.id AND p.madrasa_id = s.madrasa_id) AS paid
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN academic_sessions s2 ON s2.id = s.session_id
     WHERE ${where.join(" AND ")} ORDER BY c.sort_order, s.admission_no`,
    params
  );
  const age = (dob) => {
    if (!dob) return "";
    const b = new Date(String(dob).slice(0, 10));
    if (Number.isNaN(b.getTime())) return "";
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
    return a;
  };
  csv.sendCsv(res, filename(req, "students"), csv.toCsv(rows, [
    { label: "Admission No", key: "admission_no" },
    { label: "First Name", key: "first_name" },
    { label: "Last Name", key: "last_name" },
    { label: "Arabic Name", key: "name_ar" },
    { label: "Gender", key: "gender" },
    { label: "Date of Birth", key: "date_of_birth" },
    { label: "Age", value: (r) => age(r.date_of_birth) },
    { label: "Class", key: "class_en" },
    { label: "Session", key: "session_label" },
    { label: "Status", key: "status" },
    { label: "Parent/Guardian", key: "parent_name" },
    { label: "Parent Phone", key: "parent_phone" },
    { label: "Fees Paid (₦)", value: (r) => csv.num(r.paid || 0, 0) },
    { label: "Address", key: "address" },
    { label: "Enrolled On", value: (r) => String(r.created_at || "").slice(0, 10) },
  ]));
}));

/* ------------------------------ results -------------------------------- */

router.get("/results.csv", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const termId = toNum(req.query.termId, 0);
  if (!termId) return err(res, 400, "termId is required.");
  const classIds = await teacherClassFilter(req, tid, classId || null);
  if (classIds && !classIds.length) return csv.sendCsv(res, filename(req, "results"), csv.toCsv([], []));
  const where = ["r.madrasa_id = ?", "r.term_id = ?"];
  const params = [tid, termId];
  if (classId) { where.push("r.class_id = ?"); params.push(classId); }
  else if (classIds) { where.push(`r.class_id IN (${inClause(classIds)})`); params.push(...classIds); }
  const rows = await db.all(
    `SELECT r.*, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en, su.name_en AS subject_en
     FROM results r
     JOIN students s ON s.id = r.student_id
     JOIN subjects su ON su.id = r.subject_id
     LEFT JOIN classes c ON c.id = r.class_id
     WHERE ${where.join(" AND ")} ORDER BY c.name_en, s.admission_no, su.name_en`,
    params
  );
  csv.sendCsv(res, filename(req, "results"), csv.toCsv(rows, [
    { label: "Class", key: "class_en" },
    { label: "Admission No", key: "admission_no" },
    { label: "Student", value: (r) => `${r.first_name} ${r.last_name}`.trim() },
    { label: "Subject", key: "subject_en" },
    { label: "CA", value: (r) => csv.num(r.ca) },
    { label: "Exam", value: (r) => csv.num(r.exam) },
    { label: "Total", value: (r) => csv.num(r.total) },
    { label: "Date Recorded", value: (r) => String(r.updated_at || r.created_at || "").slice(0, 10) },
  ]));
}));

/** One row per student per term: totals, average, position, promotion. */
router.get("/summary.csv", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const termId = toNum(req.query.termId, 0);
  if (!termId) return err(res, 400, "termId is required.");
  const where = ["ts.madrasa_id = ?", "ts.term_id = ?"];
  const params = [tid, termId];
  if (classId) { where.push("ts.class_id = ?"); params.push(classId); }
  const rows = await db.all(
    `SELECT ts.*, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en,
            t.name_en AS term_name, a.label AS session_label
     FROM term_summaries ts
     JOIN students s ON s.id = ts.student_id
     LEFT JOIN classes c ON c.id = ts.class_id
     LEFT JOIN terms t ON t.id = ts.term_id
     LEFT JOIN academic_sessions a ON a.id = ts.session_id
     WHERE ${where.join(" AND ")} ORDER BY ts.position IS NULL, ts.position, s.admission_no`,
     params
  );
  csv.sendCsv(res, filename(req, "term-summary"), csv.toCsv(rows, [
    { label: "Session", key: "session_label" },
    { label: "Term", key: "term_name" },
    { label: "Class", key: "class_en" },
    { label: "Admission No", key: "admission_no" },
    { label: "Student", value: (r) => `${r.first_name} ${r.last_name}`.trim() },
    { label: "Subjects", value: (r) => r.subject_count },
    { label: "Total", value: (r) => csv.num(r.total) },
    { label: "Average %", value: (r) => csv.num(r.average, 1) },
    { label: "Grade", key: "overall_grade" },
    { label: "Position", value: (r) => (r.position === null || r.position === undefined ? "" : r.position) },
    { label: "Attendance (days)", value: (r) => r.attendance_days },
    { label: "Promotion", key: "promotion_status" },
    { label: "Published", value: (r) => (r.published_at ? "yes" : "no") },
  ]));
}));

/* ------------------------------ attendance ------------------------------ */

router.get("/attendance.csv", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : "";
  const where = ["a.madrasa_id = ?"];
  const params = [tid];
  if (classId) { where.push("a.class_id = ?"); params.push(classId); }
  if (from) { where.push("a.day >= ?"); params.push(from); }
  if (to) { where.push("a.day <= ?"); params.push(to); }
  const rows = await db.all(
    `SELECT a.student_id, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en,
            SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
            COUNT(*) AS days
     FROM attendance a
     JOIN students s ON s.id = a.student_id
     LEFT JOIN classes c ON c.id = a.class_id
     WHERE ${where.join(" AND ")}
     GROUP BY a.student_id ORDER BY c.name_en, s.admission_no`,
    params
  );
  csv.sendCsv(res, filename(req, "attendance"), csv.toCsv(rows, [
    { label: "Class", key: "class_en" },
    { label: "Admission No", key: "admission_no" },
    { label: "Student", value: (r) => `${r.first_name} ${r.last_name}`.trim() },
    { label: "Days Present", value: (r) => Number(r.present) },
    { label: "Days Absent", value: (r) => Number(r.absent) },
    { label: "Excused", value: (r) => Number(r.excused) },
    { label: "Sessions Recorded", value: (r) => Number(r.days) },
    { label: "Attendance %", value: (r) => (Number(r.days) ? csv.num((Number(r.present) / Number(r.days)) * 100, 1) : "") },
  ]));
}));

/* ------------------------------ fees ----------------------------------- */

router.get("/fees.csv", ADMINS, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const termId = toNum(req.query.termId, 0) || null;
  const classId = toNum(req.query.classId, 0) || null;

  // Placeholder order must match the SQL text exactly: subqueries first, then
  // the outer WHERE clause.
  const params = [];
  const paidTerm = termId ? " AND p.fee_item_id IN (SELECT id FROM fee_items fi2 WHERE fi2.madrasa_id = s.madrasa_id AND fi2.term_id = ?)" : "";
  if (termId) params.push(termId);
  const dueTerm = termId ? " AND fi.term_id = ?" : "";
  if (termId) params.push(termId);

  const where = ["s.madrasa_id = ?", "s.status IN ('active','promoted','suspended')"];
  params.push(tid);
  if (classId) { where.push("s.class_id = ?"); params.push(classId); }

  const rows = await db.all(
    `SELECT s.id, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en, s.parent_name, s.parent_phone,
            (SELECT COALESCE(SUM(p.amount_ngn),0) FROM fee_payments p
              WHERE p.student_id = s.id AND p.madrasa_id = s.madrasa_id${paidTerm}) AS paid,
            (SELECT COALESCE(SUM(fi.amount_ngn),0) FROM fee_items fi
              WHERE fi.madrasa_id = s.madrasa_id${dueTerm}) AS due
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE ${where.join(" AND ")} ORDER BY c.name_en, s.admission_no`,
    params
  );
  csv.sendCsv(res, filename(req, "fees"), csv.toCsv(rows, [
    { label: "Class", key: "class_en" },
    { label: "Admission No", key: "admission_no" },
    { label: "Student", value: (r) => `${r.first_name} ${r.last_name}`.trim() },
    { label: "Parent", key: "parent_name" },
    { label: "Parent Phone", key: "parent_phone" },
    { label: "Billed (N)", value: (r) => csv.num(r.due || 0, 0) },
    { label: "Paid (N)", value: (r) => csv.num(r.paid || 0, 0) },
    { label: "Outstanding (N)", value: (r) => csv.num((Number(r.due) || 0) - (Number(r.paid) || 0), 0) },
  ]));
}));

/* ------------------------------ admission queue ----------------------- */

router.get("/admissions.csv", ADMINS, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const status = cleanStr(req.query.status, 20);
  const where = ["a.madrasa_id = ?"];
  const params = [tid];
  if (status) { where.push("a.status = ?"); params.push(status); }
  const rows = await db.all(
    `SELECT a.*, c.name_en AS class_name FROM admission_requests a
     LEFT JOIN classes c ON c.id = a.class_id
     WHERE ${where.join(" AND ")} ORDER BY a.id DESC`,
    params
  );
  csv.sendCsv(res, filename(req, "admissions"), csv.toCsv(rows, [
    { label: "Reference", key: "reference" },
    { label: "Status", key: "status" },
    { label: "Applicant", value: (r) => `${r.first_name} ${r.last_name}`.trim() },
    { label: "Arabic Name", key: "name_ar" },
    { label: "Gender", key: "gender" },
    { label: "Date of Birth", key: "date_of_birth" },
    { label: "Class Applied For", key: "class_name" },
    { label: "Previous School", key: "previous_school" },
    { label: "Quran Level", key: "quran_level" },
    { label: "Parent", key: "parent_name" },
    { label: "Phone", key: "parent_phone" },
    { label: "Email", key: "parent_email" },
    { label: "Address", key: "address" },
    { label: "Message", key: "message" },
    { label: "Admission No (if admitted)", key: "admission_no_assigned" },
    { label: "Reviewed At", key: "reviewed_at" },
    { label: "Review Note", key: "review_note" },
    { label: "Submitted", key: "created_at" },
  ]));
}));

module.exports = router;
