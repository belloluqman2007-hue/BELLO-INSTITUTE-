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
const { requireAuth, requireTenant } = require("../middleware/auth");
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
 * Body: { classId, date, termId?, statuses: { studentId: "present"|"absent"|"excused" } }
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

  const valid = new Set(["present", "absent", "excused"]);
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
