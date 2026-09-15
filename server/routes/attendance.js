"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Attendance routes
   ----------------------------------------------------------------------------
   madrasa_admin: any class in the madrasa.
   teacher:       only assigned classes.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, toNum, cleanStr, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments, teacherCanMarkAttendance } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

async function checkClassAccess(req, res, tid, classId) {
  const cls = await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
  if (!cls) { res.status(404).json({ error: "Class not found." }); return null; }
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!teacherCanMarkAttendance(scope, classId)) { res.status(404).json({ error: "Not found." }); return null; }
  }
  return cls;
}

/** GET /api/attendance?classId=&date=YYYY-MM-DD */
router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const day = validDate(req.query.date);
  if (!classId || !day) return err(res, 400, "classId and date (YYYY-MM-DD) are required.");
  const cls = await checkClassAccess(req, res, tid, classId);
  if (!cls) return;

  const students = await db.all(
    "SELECT id, admission_no, first_name, last_name, name_ar FROM students WHERE madrasa_id = ? AND class_id = ? AND status IN ('active','promoted','suspended') ORDER BY admission_no",
    [tid, classId]
  );
  const term = await db.get(
    "SELECT id FROM terms WHERE madrasa_id = ? AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?) ORDER BY id DESC LIMIT 1",
    [tid, day, day]
  );
  const marks = await db.all(
    "SELECT student_id, status FROM attendance WHERE madrasa_id = ? AND class_id = ? AND day = ?",
    [tid, classId, day]
  );
  const markMap = new Map(marks.map((m) => [m.student_id, m.status]));
  ok(res, {
    date: day,
    termId: term ? term.id : null,
    students: students.map((s) => Object.assign({}, s, { status: markMap.get(s.id) || "" })),
  });
}));

/**
 * POST /api/attendance/mark
 * Body: { classId, date, termId?, statuses: { studentId: "present"|"absent"|"late"|"excused" } }
 */
router.post("/mark", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const classId = toNum(b.classId, 0);
  const day = validDate(b.date);
  if (!classId || !day) return err(res, 400, "classId and date are required.");
  const cls = await checkClassAccess(req, res, tid, classId);
  if (!cls) return;
  const termId = b.termId ? toNum(b.termId, 0) : null;
  const statuses = (b.statuses && typeof b.statuses === "object") ? b.statuses : {};

  const valid = new Set(["present", "absent", "late", "excused"]);
  let saved = 0;
  for (const [sid, status] of Object.entries(statuses)) {
    const studentId = toNum(sid, 0);
    if (!valid.has(status)) continue;
    const stu = await db.get("SELECT id FROM students WHERE id = ? AND madrasa_id = ? AND class_id = ?", [studentId, tid, classId]);
    if (!stu) continue;
    const existing = await db.get("SELECT id FROM attendance WHERE madrasa_id = ? AND student_id = ? AND day = ?", [tid, studentId, day]);
    if (existing) {
      await db.run("UPDATE attendance SET status = ?, class_id = ?, term_id = COALESCE(?, term_id), recorded_by = ? WHERE id = ?", [status, classId, termId, req.user.id, existing.id]);
    } else {
      await db.run(
        "INSERT INTO attendance (madrasa_id, student_id, class_id, term_id, day, status, recorded_by) VALUES (?,?,?,?,?,?,?)",
        [tid, studentId, classId, termId, day, status, req.user.id]
      );
    }
    saved++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "attendance.mark", entity: "class", entityId: String(classId), meta: { date: day, saved }, ip: req.ip });
  ok(res, { ok: true, saved });
}));

/** GET /api/attendance/student/:studentId?limit= */
/* ------------------------------ staff attendance ---------------------- */

/** GET /api/attendance/teachers?date=YYYY-MM-DD
 * A separate staff register — never piggybacked onto pupil attendance. */
router.get("/teachers", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const day = validDate(req.query.date);
  if (!day) return err(res, 400, "date (YYYY-MM-DD) is required.");
  const [teachers, marks] = await Promise.all([
    db.all("SELECT id, full_name, full_name_ar, email, phone, is_active FROM users WHERE madrasa_id = ? AND role = 'teacher' ORDER BY full_name", [tid]),
    db.all("SELECT user_id, status FROM teacher_attendance WHERE madrasa_id = ? AND day = ?", [tid, day]),
  ]);
  const markMap = new Map(marks.map((m) => [Number(m.user_id), m.status]));
  ok(res, { date: day, teachers: teachers.map((t) => Object.assign({}, t, { status: markMap.get(Number(t.id)) || "" })) });
}));

/** POST /api/attendance/teachers/mark
 * Body: { date, statuses: { userId: present|absent|late|excused } } */
router.post("/teachers/mark", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const day = validDate(b.date);
  if (!day) return err(res, 400, "date (YYYY-MM-DD) is required.");
  const statuses = b.statuses && typeof b.statuses === "object" ? b.statuses : {};
  const allowed = new Set(["present", "absent", "late", "excused"]);
  let saved = 0;
  for (const [rawId, status] of Object.entries(statuses)) {
    const userId = toNum(rawId, 0);
    if (!userId || !allowed.has(status)) continue;
    const teacher = await db.get("SELECT id FROM users WHERE id = ? AND madrasa_id = ? AND role = 'teacher'", [userId, tid]);
    if (!teacher) continue;
    const existing = await db.get("SELECT id FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ? AND day = ?", [tid, userId, day]);
    if (existing) {
      await db.run("UPDATE teacher_attendance SET status = ?, recorded_by = ? WHERE id = ?", [status, req.user.id, existing.id]);
    } else {
      await db.run("INSERT INTO teacher_attendance (madrasa_id, user_id, day, status, recorded_by) VALUES (?,?,?,?,?)", [tid, userId, day, status, req.user.id]);
    }
    saved++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "teacher_attendance.mark", entity: "teacher_attendance", meta: { date: day, saved }, ip: req.ip });
  ok(res, { ok: true, saved });
}));

/** A date-range summary for the attendance reports page. */
router.get("/report", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const from = validDate(req.query.from);
  const to = validDate(req.query.to);
  if (!from || !to || from > to) return err(res, 400, "A valid from and to date are required.");
  const classId = req.query.classId ? toNum(req.query.classId, 0) : null;
  if (classId) {
    const cls = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
    if (!cls) return err(res, 404, "Class not found.");
  }
  const where = ["a.madrasa_id = ?", "a.day >= ?", "a.day <= ?"];
  const params = [tid, from, to];
  if (classId) { where.push("a.class_id = ?"); params.push(classId); }
  const rows = await db.all(
    `SELECT s.id, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en,
            SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
            SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
            COUNT(a.id) AS marked
       FROM attendance a JOIN students s ON s.id = a.student_id
       LEFT JOIN classes c ON c.id = s.class_id
      WHERE ${where.join(" AND ")}
      GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name_en
      ORDER BY s.admission_no`, params
  );
  ok(res, { from, to, classId, students: rows.map((r) => Object.assign({}, r, {
    present: Number(r.present || 0), absent: Number(r.absent || 0), late: Number(r.late || 0), excused: Number(r.excused || 0), marked: Number(r.marked || 0),
  })) });
}));

router.get("/student/:studentId", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const studentId = toNum(req.params.studentId, 0);
  const limit = Math.min(365, toNum(req.query.limit, 60));
  const stu = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [studentId, tid]);
  if (!stu) return res.status(404).json({ error: "Student not found." });
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && (!stu.class_id || !scope.assignedClassIds.has(Number(stu.class_id)))) {
      return res.status(404).json({ error: "Not found." });
    }
  }
  const rows = await db.all(
    "SELECT day, status FROM attendance WHERE madrasa_id = ? AND student_id = ? ORDER BY day DESC LIMIT ?",
    [tid, studentId, limit]
  );
  ok(res, { attendance: rows });
}));

module.exports = router;
