"use strict";
/* Tenant-scoped student and teacher attendance registers and reports. */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, toNum, cleanStr, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments, teacherCanMarkAttendance } = require("../middleware/tenant");
const communication = require("../services/communication");

const router = express.Router();
router.use(requireAuth, requireTenant);
const ADMIN = requireRole("madrasa_admin", "super_admin");

const STUDENT_STATUSES = new Set(["present", "absent", "late", "excused"]);
const TEACHER_STATUSES = new Set(["present", "absent", "late", "on_leave", "excused"]);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}
function timeOrBlank(value) {
  const s = cleanStr(value, 5);
  return s === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}
function attendanceValue(value, allowed, fallbackNotes = "") {
  if (typeof value === "object" && value !== null) return { status: cleanStr(value.status, 20).toLowerCase(), note: cleanStr(value.note || value.notes, 2000) };
  return { status: cleanStr(value, 20).toLowerCase(), note: fallbackNotes };
}

async function termContext(tid, day, requestedTerm, requestedSession) {
  let termId = requestedTerm ? toNum(requestedTerm, 0) : 0;
  let sessionId = requestedSession ? toNum(requestedSession, 0) : 0;
  if (termId) {
    const term = await db.get("SELECT id, session_id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]);
    if (!term) return { error: "Term not found." };
    if (sessionId && Number(term.session_id) !== sessionId) return { error: "Term does not belong to the selected session." };
    sessionId = Number(term.session_id);
  } else {
    const term = await db.get(
      `SELECT t.id, t.session_id FROM terms t JOIN academic_sessions s ON s.id = t.session_id
       WHERE t.madrasa_id = ? AND (t.start_date IS NULL OR t.start_date <= ?) AND (t.end_date IS NULL OR t.end_date >= ?)
       ${sessionId ? "AND t.session_id = ?" : ""} ORDER BY s.is_current DESC, s.id DESC, t.position LIMIT 1`,
      sessionId ? [tid, day, day, sessionId] : [tid, day, day]
    );
    if (term) { termId = Number(term.id); sessionId = Number(term.session_id); }
  }
  if (sessionId && !(await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid]))) return { error: "Academic session not found." };
  return { termId: termId || null, sessionId: sessionId || null };
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

/** Daily student register. */
router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const classId = toNum(req.query.classId, 0); const day = validDate(req.query.date);
  if (!classId || !day) return err(res, 400, "classId and date (YYYY-MM-DD) are required.");
  const cls = await checkClassAccess(req, res, tid, classId); if (!cls) return;
  const context = await termContext(tid, day, req.query.termId, req.query.sessionId);
  if (context.error) return err(res, 400, context.error);
  const [students, marks] = await Promise.all([
    db.all("SELECT id, admission_no, first_name, last_name, name_ar FROM students WHERE madrasa_id = ? AND class_id = ? AND status IN ('active','promoted','suspended') ORDER BY admission_no", [tid, classId]),
    db.all("SELECT student_id, status, attendance_note, recorded_by, updated_at FROM attendance WHERE madrasa_id = ? AND class_id = ? AND day = ?", [tid, classId, day]),
  ]);
  const markMap = new Map(marks.map((m) => [Number(m.student_id), m]));
  ok(res, { date: day, class: cls, termId: context.termId, sessionId: context.sessionId,
    students: students.map((student) => Object.assign({}, student, markMap.has(Number(student.id)) ? markMap.get(Number(student.id)) : { status: "", attendance_note: "" })) });
}));

/** Save or edit a complete daily class register. */
router.post("/mark", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; const classId = toNum(b.classId || b.class_id, 0); const day = validDate(b.date);
  if (!classId || !day) return err(res, 400, "classId and date are required.");
  const cls = await checkClassAccess(req, res, tid, classId); if (!cls) return;
  const context = await termContext(tid, day, b.termId || b.term_id, b.sessionId || b.session_id);
  if (context.error) return err(res, 400, context.error);
  const statuses = b.statuses && typeof b.statuses === "object" ? b.statuses : {};
  const notes = b.notes && typeof b.notes === "object" ? b.notes : {};
  let saved = 0;
  for (const [sid, raw] of Object.entries(statuses)) {
    const studentId = toNum(sid, 0); const value = attendanceValue(raw, STUDENT_STATUSES, cleanStr(notes[sid], 2000));
    if (!STUDENT_STATUSES.has(value.status)) continue;
    const student = await db.get("SELECT id FROM students WHERE id = ? AND madrasa_id = ? AND class_id = ?", [studentId, tid, classId]);
    if (!student) continue;
    const existing = await db.get("SELECT id FROM attendance WHERE madrasa_id = ? AND student_id = ? AND day = ?", [tid, studentId, day]);
    if (existing) {
      await db.run("UPDATE attendance SET status = ?, class_id = ?, term_id = ?, session_id = ?, attendance_note = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [value.status, classId, context.termId, context.sessionId, value.note, req.user.id, existing.id, tid]);
    } else {
      await db.run("INSERT INTO attendance (madrasa_id, student_id, class_id, term_id, session_id, day, status, attendance_note, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)", [tid, studentId, classId, context.termId, context.sessionId, day, value.status, value.note, req.user.id]);
    }
    if (value.status === "absent" || value.status === "late") {
      const recipients = await db.all("SELECT user_id FROM parent_links WHERE madrasa_id = ? AND student_id = ?", [tid, studentId]);
      const studentUser = await db.get("SELECT id FROM users WHERE madrasa_id = ? AND student_id = ? AND is_active = 1", [tid, studentId]);
      const recipientIds = recipients.map((r) => r.user_id).concat(studentUser ? [studentUser.id] : []);
      await communication.createNotifications(tid, recipientIds, { type: value.status === "absent" ? "student_absent" : "student_late", title: value.status === "absent" ? "Student absent" : "Student late", body: `Attendance recorded as ${value.status} for ${day}.`, entity_type: "attendance", entity_id: studentId });
      for (const recipientId of [...new Set(recipientIds)]) await communication.recordCommunication(tid, { student_id: studentId, recipient_user_id: recipientId, parent_user_id: recipientId, channel: "in_app", message_type: value.status === "absent" ? "attendance_alert" : "attendance_alert", subject: "Attendance alert", message: `Attendance recorded as ${value.status} for ${day}.`, sent_by: req.user.id });
    }
    saved++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "attendance.mark", entity: "class", entityId: String(classId), meta: { date: day, saved }, ip: req.ip });
  ok(res, { ok: true, saved, date: day, termId: context.termId, sessionId: context.sessionId });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const row = await db.get("SELECT * FROM attendance WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!row) return err(res, 404, "Attendance record not found.");
  const cls = await checkClassAccess(req, res, tid, Number(row.class_id)); if (!cls) return;
  const value = attendanceValue(req.body && (req.body.status || req.body), STUDENT_STATUSES, cleanStr(req.body && (req.body.attendance_note || req.body.note), 2000));
  if (!STUDENT_STATUSES.has(value.status)) return err(res, 400, "Attendance status is invalid.");
  await db.run("UPDATE attendance SET status = ?, attendance_note = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [value.status, value.note, req.user.id, row.id, tid]);
  ok(res, { ok: true, record: await db.get("SELECT * FROM attendance WHERE id = ? AND madrasa_id = ?", [row.id, tid]) });
}));

/** Attendance history for a class or individual learner. */
router.get("/history", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const classId = toNum(req.query.classId, 0); const studentId = toNum(req.query.studentId, 0);
  const from = validDate(req.query.from) || "0000-01-01"; const to = validDate(req.query.to) || "9999-12-31";
  const where = ["a.madrasa_id = ?", "a.day >= ?", "a.day <= ?"]; const params = [tid, from, to];
  if (classId) { where.push("a.class_id = ?"); params.push(classId); }
  if (studentId) { where.push("a.student_id = ?"); params.push(studentId); }
  const rows = await db.all(`SELECT a.*, s.admission_no, s.first_name, s.last_name, c.name_en AS class_name, t.name_en AS term_name, ses.label AS session_label, u.full_name AS recorded_by_name
    FROM attendance a JOIN students s ON s.id = a.student_id AND s.madrasa_id = a.madrasa_id
    LEFT JOIN classes c ON c.id = a.class_id AND c.madrasa_id = a.madrasa_id
    LEFT JOIN terms t ON t.id = a.term_id AND t.madrasa_id = a.madrasa_id
    LEFT JOIN academic_sessions ses ON ses.id = a.session_id AND ses.madrasa_id = a.madrasa_id
    LEFT JOIN users u ON u.id = a.recorded_by AND u.madrasa_id = a.madrasa_id
    WHERE ${where.join(" AND ")} ORDER BY a.day DESC, s.admission_no`, params);
  ok(res, { from, to, records: rows });
}));

router.get("/student/:studentId", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const studentId = toNum(req.params.studentId, 0); const limit = Math.min(1000, Math.max(1, toNum(req.query.limit, 60)));
  const student = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [studentId, tid]);
  if (!student) return err(res, 404, "Student not found.");
  if (req.user.role === "teacher") { const scope = await getTeacherAssignments(tid, req.user.id); if (!scope.anyClassAnySubject && (!student.class_id || !scope.assignedClassIds.has(Number(student.class_id)))) return err(res, 404, "Not found."); }
  const rows = await db.all("SELECT day, status, attendance_note, term_id, session_id, recorded_by, updated_at FROM attendance WHERE madrasa_id = ? AND student_id = ? ORDER BY day DESC LIMIT ?", [tid, studentId, limit]);
  ok(res, { student, attendance: rows });
}));

async function studentReport(req, res) {
  const tid = await tenantId(req, res); if (tid == null) return;
  const studentId = toNum(req.params.studentId || req.query.studentId, 0);
  if (!studentId) return err(res, 400, "studentId is required.");
  const from = validDate(req.query.from) || "0000-01-01"; const to = validDate(req.query.to) || "9999-12-31";
  const student = await db.get("SELECT s.*, c.name_en AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = s.madrasa_id WHERE s.id = ? AND s.madrasa_id = ?", [studentId, tid]);
  if (!student) return err(res, 404, "Student not found.");
  const rows = await db.all(`SELECT status, COUNT(*) AS n FROM attendance WHERE madrasa_id = ? AND student_id = ? AND day >= ? AND day <= ? GROUP BY status`, [tid, studentId, from, to]);
  const totals = { totalSchoolDays: 0, totalRecordedDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, excusedDays: 0 };
  rows.forEach((row) => { const n = Number(row.n); totals.totalRecordedDays += n; if (row.status === "present") totals.presentDays += n; if (row.status === "absent") totals.absentDays += n; if (row.status === "late") totals.lateDays += n; if (row.status === "excused") totals.excusedDays += n; });
  const schoolDays = await db.get("SELECT COUNT(DISTINCT day) AS n FROM attendance WHERE madrasa_id = ? AND class_id = ? AND day >= ? AND day <= ?", [tid, student.class_id, from, to]);
  totals.totalSchoolDays = Number(schoolDays && schoolDays.n || totals.totalRecordedDays);
  const percentage = totals.totalRecordedDays ? Math.round((totals.presentDays / totals.totalRecordedDays) * 1000) / 10 : 0;
  const attendedPercentage = totals.totalRecordedDays ? Math.round(((totals.presentDays + totals.lateDays) / totals.totalRecordedDays) * 1000) / 10 : 0;
  ok(res, { from, to, student, ...totals, attendancePercentage: percentage, attendance_percentage: percentage, attendedPercentage, records: await db.all("SELECT day, status, attendance_note, term_id, session_id FROM attendance WHERE madrasa_id = ? AND student_id = ? AND day >= ? AND day <= ? ORDER BY day DESC", [tid, studentId, from, to]) });
}
router.get("/student/:studentId/report", ADMIN, asyncHandler(studentReport));

/* ------------------------------ teacher register ----------------------- */
router.get("/teachers", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const day = validDate(req.query.date);
  if (!day) return err(res, 400, "date (YYYY-MM-DD) is required.");
  const [teachers, marks] = await Promise.all([
    db.all("SELECT u.id, u.full_name, u.full_name_ar, u.email, u.phone, u.is_active, tp.department FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id AND tp.madrasa_id = u.madrasa_id WHERE u.madrasa_id = ? AND u.role = 'teacher' ORDER BY u.full_name", [tid]),
    db.all("SELECT user_id, status, term_id, session_id, check_in, check_out, notes, recorded_by FROM teacher_attendance WHERE madrasa_id = ? AND day = ?", [tid, day]),
  ]);
  const markMap = new Map(marks.map((mark) => [Number(mark.user_id), mark]));
  ok(res, { date: day, teachers: teachers.map((teacher) => Object.assign({}, teacher, markMap.get(Number(teacher.id)) || { status: "", check_in: "", check_out: "", notes: "" })) });
}));

router.post("/teachers/mark", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; const day = validDate(b.date);
  if (!day) return err(res, 400, "date (YYYY-MM-DD) is required.");
  const context = await termContext(tid, day, b.termId || b.term_id, b.sessionId || b.session_id);
  if (context.error) return err(res, 400, context.error);
  const statuses = b.statuses && typeof b.statuses === "object" ? b.statuses : {}; const details = b.details && typeof b.details === "object" ? b.details : {};
  let saved = 0;
  for (const [rawId, raw] of Object.entries(statuses)) {
    const userId = toNum(rawId, 0); const detail = typeof raw === "object" && raw !== null ? raw : (details[rawId] || {});
    const value = attendanceValue(raw, TEACHER_STATUSES, cleanStr(detail.notes || detail.note, 2000));
    if (!userId || !TEACHER_STATUSES.has(value.status)) continue;
    const teacher = await db.get("SELECT id FROM users WHERE id = ? AND madrasa_id = ? AND role = 'teacher'", [userId, tid]);
    if (!teacher) continue;
    const checkIn = timeOrBlank(detail.check_in || detail.checkIn || b.check_in); const checkOut = timeOrBlank(detail.check_out || detail.checkOut || b.check_out);
    if (checkIn === null || checkOut === null) return err(res, 400, "Check-in and check-out times must use HH:MM.");
    const existing = await db.get("SELECT id FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ? AND day = ?", [tid, userId, day]);
    if (existing) await db.run("UPDATE teacher_attendance SET status = ?, term_id = ?, session_id = ?, check_in = ?, check_out = ?, notes = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [value.status, context.termId, context.sessionId, checkIn, checkOut, value.note, req.user.id, existing.id, tid]);
    else await db.run("INSERT INTO teacher_attendance (madrasa_id, user_id, day, term_id, session_id, status, check_in, check_out, notes, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [tid, userId, day, context.termId, context.sessionId, value.status, checkIn, checkOut, value.note, req.user.id]);
    saved++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "teacher_attendance.mark", entity: "teacher_attendance", meta: { date: day, saved }, ip: req.ip });
  ok(res, { ok: true, saved, date: day, termId: context.termId, sessionId: context.sessionId });
}));

router.patch("/teachers/:id", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const row = await db.get("SELECT * FROM teacher_attendance WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!row) return err(res, 404, "Teacher attendance record not found.");
  const b = req.body || {}; const status = cleanStr(b.status, 20).toLowerCase();
  if (!TEACHER_STATUSES.has(status)) return err(res, 400, "Teacher attendance status is invalid.");
  const checkIn = timeOrBlank(b.check_in ?? b.checkIn ?? row.check_in); const checkOut = timeOrBlank(b.check_out ?? b.checkOut ?? row.check_out);
  if (checkIn === null || checkOut === null) return err(res, 400, "Check-in and check-out times must use HH:MM.");
  await db.run("UPDATE teacher_attendance SET status = ?, check_in = ?, check_out = ?, notes = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [status, checkIn, checkOut, cleanStr(b.notes || b.note, 2000), req.user.id, row.id, tid]);
  ok(res, { ok: true, record: await db.get("SELECT * FROM teacher_attendance WHERE id = ? AND madrasa_id = ?", [row.id, tid]) });
}));

async function teacherReport(req, res) {
  const tid = await tenantId(req, res); if (tid == null) return;
  const from = validDate(req.query.from) || "0000-01-01"; const to = validDate(req.query.to) || "9999-12-31";
  const teacherId = toNum(req.params.teacherId || req.query.teacherId, 0); const department = cleanStr(req.query.department, 120);
  const where = ["ta.madrasa_id = ?", "ta.day >= ?", "ta.day <= ?"]; const params = [tid, from, to];
  if (teacherId) { where.push("ta.user_id = ?"); params.push(teacherId); }
  if (department) { where.push("tp.department = ?"); params.push(department); }
  const rows = await db.all(`SELECT ta.user_id AS teacher_id, u.full_name, tp.department,
      SUM(CASE WHEN ta.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN ta.status = 'absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN ta.status = 'late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN ta.status = 'on_leave' THEN 1 ELSE 0 END) AS on_leave,
      SUM(CASE WHEN ta.status = 'excused' THEN 1 ELSE 0 END) AS excused,
      COUNT(ta.id) AS marked
    FROM teacher_attendance ta JOIN users u ON u.id = ta.user_id AND u.madrasa_id = ta.madrasa_id
    LEFT JOIN teacher_profiles tp ON tp.user_id = ta.user_id AND tp.madrasa_id = ta.madrasa_id
    WHERE ${where.join(" AND ")} GROUP BY ta.user_id, u.full_name, tp.department ORDER BY u.full_name`, params);
  const records = await db.all(`SELECT ta.*, u.full_name, tp.department, ses.label AS session_label, t.name_en AS term_name, r.full_name AS recorded_by_name
    FROM teacher_attendance ta JOIN users u ON u.id = ta.user_id AND u.madrasa_id = ta.madrasa_id
    LEFT JOIN teacher_profiles tp ON tp.user_id = ta.user_id AND tp.madrasa_id = ta.madrasa_id
    LEFT JOIN academic_sessions ses ON ses.id = ta.session_id AND ses.madrasa_id = ta.madrasa_id
    LEFT JOIN terms t ON t.id = ta.term_id AND t.madrasa_id = ta.madrasa_id
    LEFT JOIN users r ON r.id = ta.recorded_by AND r.madrasa_id = ta.madrasa_id
    WHERE ${where.join(" AND ")} ORDER BY ta.day DESC, u.full_name`, params);
  const stats = rows.reduce((out, row) => { for (const key of ["present", "absent", "late", "on_leave", "excused", "marked"]) out[key] = (out[key] || 0) + Number(row[key] || 0); return out; }, {});
  stats.attendancePercentage = stats.marked ? Math.round((stats.present / stats.marked) * 1000) / 10 : 0;
  stats.attendedPercentage = stats.marked ? Math.round(((stats.present + stats.late) / stats.marked) * 1000) / 10 : 0;
  ok(res, { from, to, teacherId: teacherId || null, department: department || null, teachers: rows.map((row) => Object.assign({}, row, { present: Number(row.present || 0), absent: Number(row.absent || 0), late: Number(row.late || 0), on_leave: Number(row.on_leave || 0), excused: Number(row.excused || 0), marked: Number(row.marked || 0), attendancePercentage: Number(row.marked) ? Math.round((Number(row.present) / Number(row.marked)) * 1000) / 10 : 0, attendedPercentage: Number(row.marked) ? Math.round(((Number(row.present) + Number(row.late)) / Number(row.marked)) * 1000) / 10 : 0 })), records, stats });
}
router.get("/teacher/:teacherId/report", ADMIN, asyncHandler(teacherReport));

/** Central reporting endpoint: use type=student|teacher and the same filters in exports. */
router.get(["/report", "/reports"], ADMIN, asyncHandler(async (req, res) => {
  if (String(req.query.type || "student").toLowerCase() === "teacher") return teacherReport(req, res);
  const tid = await tenantId(req, res); if (tid == null) return;
  const from = validDate(req.query.from); const to = validDate(req.query.to);
  if (!from || !to || from > to) return err(res, 400, "A valid from and to date are required.");
  const classId = toNum(req.query.classId, 0); const studentId = toNum(req.query.studentId, 0);
  const where = ["a.madrasa_id = ?", "a.day >= ?", "a.day <= ?"]; const params = [tid, from, to];
  if (classId) { if (!(await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]))) return err(res, 404, "Class not found."); where.push("a.class_id = ?"); params.push(classId); }
  if (studentId) { if (!(await db.get("SELECT id FROM students WHERE id = ? AND madrasa_id = ?", [studentId, tid]))) return err(res, 404, "Student not found."); where.push("a.student_id = ?"); params.push(studentId); }
  if (req.query.sessionId) { where.push("a.session_id = ?"); params.push(toNum(req.query.sessionId, 0)); }
  if (req.query.termId) { where.push("a.term_id = ?"); params.push(toNum(req.query.termId, 0)); }
  if (req.query.educationTrack) { where.push("c.education_track = ?"); params.push(cleanStr(req.query.educationTrack, 20).toLowerCase()); }
  if (req.query.program) { where.push("(c.program LIKE ? OR EXISTS (SELECT 1 FROM class_subjects csx JOIN subjects sx ON sx.id = csx.subject_id WHERE csx.class_id = c.id AND sx.category LIKE ?))"); const q = `%${cleanStr(req.query.program, 80)}%`; params.push(q, q); }
  const rows = await db.all(`SELECT s.id, s.admission_no, s.first_name, s.last_name, c.name_en AS class_en,
    SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
    SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
    SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused, COUNT(a.id) AS marked
    FROM attendance a JOIN students s ON s.id = a.student_id AND s.madrasa_id = a.madrasa_id LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = s.madrasa_id
    WHERE ${where.join(" AND ")} GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name_en ORDER BY c.name_en, s.admission_no`, params);
  const students = rows.map((row) => { const marked = Number(row.marked || 0); const present = Number(row.present || 0); const late = Number(row.late || 0); return Object.assign({}, row, { present, absent: Number(row.absent || 0), late, excused: Number(row.excused || 0), marked, total_recorded_days: marked, attendance_percentage: marked ? Math.round((present / marked) * 1000) / 10 : 0, attended_percentage: marked ? Math.round(((present + late) / marked) * 1000) / 10 : 0 }); });
  const totals = students.reduce((out, row) => { for (const key of ["present", "absent", "late", "excused", "marked"]) out[key] = (out[key] || 0) + Number(row[key] || 0); return out; }, { present: 0, absent: 0, late: 0, excused: 0, marked: 0 });
  totals.attendancePercentage = totals.marked ? Math.round((totals.present / totals.marked) * 1000) / 10 : 0; totals.attendedPercentage = totals.marked ? Math.round(((totals.present + totals.late) / totals.marked) * 1000) / 10 : 0;
  ok(res, { from, to, classId: classId || null, studentId: studentId || null, students, totals, statistics: { totalPresent: totals.present, totalAbsent: totals.absent, totalLate: totals.late, totalExcused: totals.excused, attendancePercentage: totals.attendancePercentage } });
}));

module.exports = router;
// Additive export (the router itself is unchanged): the staff-leave module
// resolves the same term/session context when it writes 'on_leave' rows into
// this register, instead of duplicating the resolution rules.
module.exports.termContext = termContext;
module.exports.TEACHER_STATUSES = TEACHER_STATUSES;
