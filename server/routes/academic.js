"use strict";
/* Academic records that sit beside the shared subjects/results engine. */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);
const ADMIN = requireRole("madrasa_admin", "super_admin");
const STAFF = requireRole("madrasa_admin", "teacher", "super_admin");

async function tenantId(req, res) {
  const id = effectiveTenantId(req);
  if (!id) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return id;
}

async function validAcademicRefs(tid, classId, subjectId, sessionId, termId) {
  const [cls, subject] = await Promise.all([
    db.get("SELECT id, name_en FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]),
    db.get("SELECT id, name_en FROM subjects WHERE id = ? AND madrasa_id = ?", [subjectId, tid]),
  ]);
  if (!cls) return { error: "Class not found." };
  if (!subject) return { error: "Subject not found." };
  if (sessionId && !(await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid]))) return { error: "Academic session not found." };
  if (termId && !(await db.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]))) return { error: "Term not found." };
  return { cls, subject };
}

function normalizeStatus(value) {
  const v = cleanStr(value, 20).toLowerCase();
  return ["draft", "scheduled", "open", "closed", "archived"].includes(v) ? v : "draft";
}

async function listExams(req, res) {
  const tid = await tenantId(req, res); if (tid == null) return;
  const where = ["e.madrasa_id = ?"]; const params = [tid];
  for (const [query, column] of [["classId", "e.class_id"], ["subjectId", "e.subject_id"], ["sessionId", "e.session_id"], ["termId", "e.term_id"]]) {
    if (req.query[query]) { where.push(`${column} = ?`); params.push(toNum(req.query[query], 0)); }
  }
  if (req.query.status) { where.push("e.status = ?"); params.push(normalizeStatus(req.query.status)); }
  const rows = await db.all(`SELECT e.*, c.name_en AS class_name, s.name_en AS subject_name,
      a.label AS session_label, t.name_en AS term_name,
      u.full_name AS created_by_name,
      (SELECT COUNT(*) FROM results r WHERE r.madrasa_id = e.madrasa_id AND r.class_id = e.class_id AND r.subject_id = e.subject_id AND (e.term_id IS NULL OR r.term_id = e.term_id)) AS result_count
      FROM exams e LEFT JOIN classes c ON c.id = e.class_id AND c.madrasa_id = e.madrasa_id
      LEFT JOIN subjects s ON s.id = e.subject_id AND s.madrasa_id = e.madrasa_id
      LEFT JOIN academic_sessions a ON a.id = e.session_id AND a.madrasa_id = e.madrasa_id
      LEFT JOIN terms t ON t.id = e.term_id AND t.madrasa_id = e.madrasa_id
      LEFT JOIN users u ON u.id = e.created_by AND u.madrasa_id = e.madrasa_id
      WHERE ${where.join(" AND ")} ORDER BY e.exam_date DESC, e.id DESC`, params);
  ok(res, { exams: rows.map((row) => Object.assign(row, { result_count: Number(row.result_count || 0) })) });
}
router.get(["/exams", "/"], STAFF, asyncHandler(listExams));

router.post(["/exams", "/"], ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {};
  const title = cleanStr(b.title || b.name, 200);
  const classId = toNum(b.class_id || b.classId, 0);
  const subjectId = toNum(b.subject_id || b.subjectId, 0);
  if (!title || !classId || !subjectId) return err(res, 400, "Title, class and subject are required.");
  const sessionId = toNum(b.session_id || b.sessionId, 0) || null;
  const termId = toNum(b.term_id || b.termId, 0) || null;
  const refs = await validAcademicRefs(tid, classId, subjectId, sessionId, termId);
  if (refs.error) return err(res, 400, refs.error);
  const examDate = b.exam_date || b.examDate ? validDate(b.exam_date || b.examDate) : null;
  if ((b.exam_date || b.examDate) && !examDate) return err(res, 400, "Exam date must use YYYY-MM-DD.");
  const totalMarks = Math.max(1, Math.min(100000, toNum(b.total_marks || b.totalMarks, 100)));
  const r = await db.run(`INSERT INTO exams (madrasa_id, title, description, class_id, subject_id, session_id, term_id, exam_date, total_marks, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [tid, title, cleanStr(b.description, 5000), classId, subjectId, sessionId, termId, examDate, totalMarks, normalizeStatus(b.status), req.user.id]);
  // A subject used in an exam is also visible in the class subject catalogue.
  await db.insertIgnore("class_subjects", "madrasa_id, class_id, subject_id, session_id, term_id", [tid, classId, subjectId, sessionId, termId]);
  const exam = await db.get("SELECT * FROM exams WHERE id = ? AND madrasa_id = ?", [r.lastInsertRowid, tid]);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "exam.create", entity: "exam", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid, exam });
}));

router.get(["/exams/:id", "/:id"], STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const exam = await db.get(`SELECT e.*, c.name_en AS class_name, s.name_en AS subject_name, a.label AS session_label, t.name_en AS term_name
    FROM exams e LEFT JOIN classes c ON c.id = e.class_id AND c.madrasa_id = e.madrasa_id
    LEFT JOIN subjects s ON s.id = e.subject_id AND s.madrasa_id = e.madrasa_id
    LEFT JOIN academic_sessions a ON a.id = e.session_id AND a.madrasa_id = e.madrasa_id
    LEFT JOIN terms t ON t.id = e.term_id AND t.madrasa_id = e.madrasa_id
    WHERE e.id = ? AND e.madrasa_id = ?`, [toNum(req.params.id, 0), tid]);
  if (!exam) return err(res, 404, "Exam not found.");
  ok(res, { exam });
}));

router.patch(["/exams/:id", "/:id"], ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const current = await db.get("SELECT * FROM exams WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!current) return err(res, 404, "Exam not found.");
  const b = req.body || {}; const sets = []; const vals = [];
  if (b.title !== undefined) { const title = cleanStr(b.title, 200); if (!title) return err(res, 400, "Title is required."); sets.push("title = ?"); vals.push(title); }
  for (const [key, col, max] of [["description", "description", 5000], ["status", "status", 20]]) if (b[key] !== undefined) { sets.push(`${col} = ?`); vals.push(key === "status" ? normalizeStatus(b[key]) : cleanStr(b[key], max)); }
  if (b.exam_date !== undefined) { const date = b.exam_date ? validDate(b.exam_date) : null; if (b.exam_date && !date) return err(res, 400, "Exam date must use YYYY-MM-DD."); sets.push("exam_date = ?"); vals.push(date); }
  if (b.total_marks !== undefined) { sets.push("total_marks = ?"); vals.push(Math.max(1, Math.min(100000, toNum(b.total_marks, 100)))); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  sets.push("updated_at = CURRENT_TIMESTAMP"); vals.push(id, tid);
  await db.run(`UPDATE exams SET ${sets.join(", ")} WHERE id = ? AND madrasa_id = ?`, vals);
  ok(res, { ok: true, exam: await db.get("SELECT * FROM exams WHERE id = ? AND madrasa_id = ?", [id, tid]) });
}));

router.delete(["/exams/:id", "/:id"], ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const exam = await db.get("SELECT id FROM exams WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!exam) return err(res, 404, "Exam not found.");
  await db.run("DELETE FROM exams WHERE id = ? AND madrasa_id = ?", [id, tid]);
  ok(res, { ok: true });
}));

module.exports = router;
