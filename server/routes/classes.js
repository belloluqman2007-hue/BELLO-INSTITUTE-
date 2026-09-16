"use strict";
/* ============================================================================
   Complete class management routes
   ----------------------------------------------------------------------------
   The original `classes` table remains the single class database for Islamic,
   Western and dual-track programmes. These routes extend it with directory,
   roster, teacher-assignment and timetable integration workflows.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);

const ADMIN = requireRole("madrasa_admin", "super_admin");
const STAFF = requireRole("madrasa_admin", "teacher", "super_admin");
const TRACKS = new Set(["islamic", "western", "both"]);
const CLASS_STATUSES = new Set(["active", "inactive", "archived"]);
const TEACHER_ROLES = new Set(["class_teacher", "assistant_class_teacher", "subject_teacher", "substitute_teacher"]);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}
function normalizeTrack(v) {
  const s = cleanStr(v, 20).toLowerCase();
  return TRACKS.has(s) ? s : "both";
}
function normalizeStatus(v, fallback = "active") {
  const s = cleanStr(v, 20).toLowerCase().replace(/[\s-]+/g, "_");
  return CLASS_STATUSES.has(s) ? s : fallback;
}
function normalizeRole(v) {
  const s = cleanStr(v, 40).toLowerCase().replace(/[\s-]+/g, "_");
  return TEACHER_ROLES.has(s) ? s : "subject_teacher";
}
function makeCode(name) {
  return cleanStr(name, 60).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "CLASS";
}
function arr(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === "") return [];
  return [v];
}
async function insertIgnoreRow(api, table, columns, values) {
  if (typeof api.insertIgnore === "function") return api.insertIgnore(table, columns, values);
  const dialect = typeof api.dialect === "string" ? api.dialect : await db.dialect();
  const verb = dialect === "sqlite" ? "INSERT OR IGNORE" : "INSERT IGNORE";
  return api.run(`${verb} INTO ${table} (${columns}) VALUES (${values.map(() => "?").join(",")})`, values);
}
async function teacherExists(tid, id, api = db) {
  if (!id) return null;
  return api.get("SELECT id FROM users WHERE id = ? AND madrasa_id = ? AND role = 'teacher'", [id, tid]);
}
async function subjectExists(tid, id, api = db) {
  if (!id) return null;
  return api.get("SELECT id FROM subjects WHERE id = ? AND madrasa_id = ?", [id, tid]);
}
async function sessionExists(tid, id, api = db) {
  if (!id) return null;
  return api.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [id, tid]);
}
async function termExists(tid, id, api = db) {
  if (!id) return null;
  return api.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [id, tid]);
}

async function classRow(req, res, id) {
  const tid = await tenantId(req, res); if (tid == null) return null;
  const row = await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [toNum(id, 0), tid]);
  if (!row) { err(res, 404, "Class not found."); return null; }
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && !scope.assignedClassIds.has(Number(row.id))) { err(res, 404, "Class not found."); return null; }
  }
  return row;
}

async function assignmentExists(api, tid, userId, classId, subjectId) {
  const subjectSql = subjectId ? "subject_id = ?" : "subject_id IS NULL";
  const params = [tid, userId, classId];
  if (subjectId) params.push(subjectId);
  return api.get(`SELECT id FROM teacher_assignments WHERE madrasa_id = ? AND user_id = ? AND class_id = ? AND ${subjectSql}`, params);
}

async function addTeacherAssignment(api, tid, classId, userId, role, subjectId, assignedPeriods, notes, sessionId) {
  if (subjectId) await insertIgnoreRow(api, "class_subjects", "madrasa_id, class_id, subject_id", [tid, classId, subjectId]);
  const existing = await assignmentExists(api, tid, userId, classId, subjectId || null);
  const periods = Array.isArray(assignedPeriods) ? JSON.stringify(assignedPeriods) : cleanStr(assignedPeriods, 500);
  if (existing) {
    await api.run("UPDATE teacher_assignments SET role = ?, assigned_periods = ?, notes = ?, academic_session_id = ? WHERE id = ? AND madrasa_id = ?", [role, periods, notes, sessionId || null, existing.id, tid]);
    return existing.id;
  }
  const r = await api.run(
    `INSERT INTO teacher_assignments (madrasa_id, user_id, class_id, subject_id, role, academic_session_id, assigned_periods, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [tid, userId, classId, subjectId || null, role, sessionId || null, periods, notes]
  );
  return r.lastInsertRowid;
}

async function setClassSubjects(api, tid, classId, subjectIds) {
  if (!Array.isArray(subjectIds)) return;
  await api.run("DELETE FROM class_subjects WHERE madrasa_id = ? AND class_id = ?", [tid, classId]);
  for (const sid of subjectIds.map((x) => toNum(x, 0)).filter(Boolean)) {
    if (await subjectExists(tid, sid, api)) await insertIgnoreRow(api, "class_subjects", "madrasa_id, class_id, subject_id", [tid, classId, sid]);
  }
}

async function classSubjects(tid, ids) {
  if (!ids.length) return new Map();
  const rows = await db.all(
    `SELECT cs.class_id, s.id, s.name_en, s.name_ar
       FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id AND s.madrasa_id = cs.madrasa_id
      WHERE cs.madrasa_id = ? AND cs.class_id IN (${ids.map(() => "?").join(",")})
      ORDER BY s.name_en`,
    [tid].concat(ids)
  );
  const map = new Map(ids.map((id) => [Number(id), []]));
  for (const r of rows) map.get(Number(r.class_id))?.push({ id: Number(r.id), name_en: r.name_en, name_ar: r.name_ar });
  return map;
}

function classDto(row, subjects = []) {
  const status = normalizeStatus(row.status || (row.is_active ? "active" : "inactive"));
  return Object.assign({}, row, {
    id: Number(row.id),
    class_code: row.class_code || "",
    education_track: normalizeTrack(row.education_track),
    level: row.level_name || "",
    level_name: row.level_name || "",
    section: row.section_arm || "",
    section_arm: row.section_arm || "",
    status,
    is_active: Number(row.is_active) === 1,
    student_count: Number(row.student_count || 0),
    subject_count: Number(row.subject_count || subjects.length || 0),
    subjects,
  });
}

/* ------------------------------ list ----------------------------------- */

router.get("/", asyncHandler(async (req, res, next) => {
  // Keep historical behaviour: authenticated tenant users may read the active
  // class catalogue, while detailed rosters/assignments remain staff-gated.
  const tid = await tenantId(req, res); if (tid == null) return;
  let allowedClassIds = null;
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject) allowedClassIds = [...scope.assignedClassIds];
  }
  const where = ["c.madrasa_id = ?"];
  const params = [tid];
  if (allowedClassIds) {
    if (!allowedClassIds.length) return ok(res, { classes: [], total: 0, page: 1, perPage: 50, totalPages: 1, stats: { total: 0, active: 0, islamic: 0, western: 0, archived: 0 } });
    where.push(`c.id IN (${allowedClassIds.map(() => "?").join(",")})`); params.push(...allowedClassIds);
  }
  const status = cleanStr(req.query.status, 20).toLowerCase();
  if (status) { where.push("COALESCE(c.status, CASE WHEN c.is_active = 1 THEN 'active' ELSE 'inactive' END) = ?"); params.push(normalizeStatus(status, status)); }
  else { where.push("COALESCE(c.status, '') <> 'archived'"); }
  if (req.query.education_track) { where.push("c.education_track = ?"); params.push(normalizeTrack(req.query.education_track)); }
  for (const [q, col, max] of [["program", "c.program", 120], ["level", "c.level_name", 80], ["sessionId", "c.session_id", 0], ["termId", "c.term_id", 0]]) {
    if (req.query[q]) { where.push(`${col} = ?`); params.push(max ? cleanStr(req.query[q], max) : toNum(req.query[q], 0)); }
  }
  const search = cleanStr(req.query.search || req.query.q, 100).toLowerCase();
  if (search) {
    where.push("(LOWER(c.name_en) LIKE ? OR LOWER(c.name_ar) LIKE ? OR LOWER(c.class_code) LIKE ? OR LOWER(c.program) LIKE ? OR LOWER(c.level_name) LIKE ? OR LOWER(c.section_arm) LIKE ?)");
    const like = `%${search}%`; params.push(like, like, like, like, like, like);
  }
  const page = Math.max(1, toNum(req.query.page, 1));
  const perPage = Math.min(200, Math.max(1, toNum(req.query.perPage, 50)));
  const offset = (page - 1) * perPage;
  const sortMap = { name: "c.name_en", code: "c.class_code", program: "c.program", level: "c.level_name", students: "student_count", status: "c.status", newest: "c.id" };
  const sort = sortMap[cleanStr(req.query.sort, 30)] || "c.sort_order";
  const direction = cleanStr(req.query.direction, 4).toLowerCase() === "desc" ? "DESC" : "ASC";
  const total = await db.get(`SELECT COUNT(*) AS n FROM classes c WHERE ${where.join(" AND ")}`, params);
  const rows = await db.all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM class_subjects cs WHERE cs.madrasa_id = c.madrasa_id AND cs.class_id = c.id) AS subject_count,
            (SELECT COUNT(*) FROM students s WHERE s.madrasa_id = c.madrasa_id AND s.class_id = c.id AND s.status IN ('active','promoted','suspended')) AS student_count,
            ct.full_name AS class_teacher_name, at.full_name AS assistant_teacher_name,
            sess.label AS session_label, term.name_en AS term_name
       FROM classes c
       LEFT JOIN users ct ON ct.id = c.class_teacher_id AND ct.madrasa_id = c.madrasa_id
       LEFT JOIN users at ON at.id = c.assistant_teacher_id AND at.madrasa_id = c.madrasa_id
       LEFT JOIN academic_sessions sess ON sess.id = c.session_id
       LEFT JOIN terms term ON term.id = c.term_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${sort} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
    params.concat([perPage, offset])
  );
  const subjectMap = await classSubjects(tid, rows.map((r) => Number(r.id)));
  const stats = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(status, CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END) = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN COALESCE(education_track,'both') IN ('islamic','both') THEN 1 ELSE 0 END) AS islamic,
            SUM(CASE WHEN COALESCE(education_track,'both') IN ('western','both') THEN 1 ELSE 0 END) AS western,
            SUM(CASE WHEN COALESCE(status,'') = 'archived' THEN 1 ELSE 0 END) AS archived
       FROM classes WHERE madrasa_id = ?`, [tid]
  );
  ok(res, {
    classes: rows.map((r) => classDto(r, subjectMap.get(Number(r.id)) || [])),
    total: Number(total.n || 0), page, perPage, totalPages: Math.max(1, Math.ceil(Number(total.n || 0) / perPage)),
    stats: { total: Number(stats.total || 0), active: Number(stats.active || 0), islamic: Number(stats.islamic || 0), western: Number(stats.western || 0), archived: Number(stats.archived || 0) },
  });
}));

router.post("/", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {};
  const nameEn = cleanStr(b.name_en || b.class_name, 120);
  if (!nameEn) return err(res, 400, "Class name is required.");
  const dup = await db.get("SELECT id FROM classes WHERE madrasa_id = ? AND name_en = ?", [tid, nameEn]);
  if (dup) return err(res, 400, "A class with this name already exists.");
  const classCode = cleanStr(b.class_code || makeCode(nameEn), 60).toUpperCase();
  if (classCode && await db.get("SELECT id FROM classes WHERE madrasa_id = ? AND class_code = ? AND class_code <> ''", [tid, classCode])) return err(res, 400, "A class with this code already exists.");
  const sessionId = b.session_id || b.academic_session_id ? toNum(b.session_id || b.academic_session_id, 0) : null;
  if (sessionId && !await sessionExists(tid, sessionId)) return err(res, 400, "Unknown academic session.");
  const termId = b.term_id || b.term_semester_id ? toNum(b.term_id || b.term_semester_id, 0) : null;
  if (termId && !await termExists(tid, termId)) return err(res, 400, "Unknown term/semester.");
  const classTeacherId = b.class_teacher_id ? toNum(b.class_teacher_id, 0) : null;
  const assistantTeacherId = b.assistant_teacher_id ? toNum(b.assistant_teacher_id, 0) : null;
  if (classTeacherId && !await teacherExists(tid, classTeacherId)) return err(res, 400, "Unknown class teacher.");
  if (assistantTeacherId && !await teacherExists(tid, assistantTeacherId)) return err(res, 400, "Unknown assistant teacher.");
  const status = normalizeStatus(b.status, "active");
  let classId = 0;
  await db.transaction(async (tx) => {
    const r = await tx.run(
      `INSERT INTO classes (madrasa_id, name_en, name_ar, sort_order, is_active, class_code, education_track, program, level_name,
        section_arm, session_id, term_id, class_teacher_id, assistant_teacher_id, max_capacity, description, status, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [tid, nameEn, cleanStr(b.name_ar, 120), toNum(b.sort_order, 0), status === "active" ? 1 : 0, classCode, normalizeTrack(b.education_track), cleanStr(b.program, 120), cleanStr(b.level || b.level_name, 80),
        cleanStr(b.section_arm || b.section, 80), sessionId, termId, classTeacherId, assistantTeacherId, b.max_capacity ? toNum(b.max_capacity, 0) : null, cleanStr(b.description, 5000), status]
    );
    classId = r.lastInsertRowid;
    await setClassSubjects(tx, tid, classId, arr(b.subject_ids));
    if (classTeacherId) await addTeacherAssignment(tx, tid, classId, classTeacherId, "class_teacher", null, "", "", sessionId);
    if (assistantTeacherId) await addTeacherAssignment(tx, tid, classId, assistantTeacherId, "assistant_class_teacher", null, "", "", sessionId);
  });
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "class.create", entity: "class", entityId: String(classId), ip: req.ip });
  ok(res, { ok: true, id: classId, classCode });
}));

/* ------------------------------ class details --------------------------- */

router.get("/:id/students", STAFF, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const tid = c.madrasa_id;
  const rows = await db.all(
    `SELECT s.*, 
            (SELECT a.status FROM attendance a WHERE a.madrasa_id = s.madrasa_id AND a.student_id = s.id ORDER BY a.day DESC LIMIT 1) AS attendance_status,
            (SELECT ts.average FROM term_summaries ts WHERE ts.madrasa_id = s.madrasa_id AND ts.student_id = s.id ORDER BY ts.id DESC LIMIT 1) AS academic_performance,
            (SELECT COALESCE(SUM(fp.amount_ngn),0) FROM fee_payments fp WHERE fp.madrasa_id = s.madrasa_id AND fp.student_id = s.id) AS fees_paid,
            (SELECT COALESCE(SUM(fi.amount_ngn),0) FROM fee_items fi WHERE fi.madrasa_id = s.madrasa_id) AS fees_due
       FROM students s WHERE s.madrasa_id = ? AND s.class_id = ?
      ORDER BY s.last_name, s.first_name, s.admission_no`,
    [tid, c.id]
  );
  const stats = {
    total: rows.length,
    male: rows.filter((s) => String(s.gender).toUpperCase() === "M").length,
    female: rows.filter((s) => String(s.gender).toUpperCase() === "F").length,
    active: rows.filter((s) => ["active", "promoted"].includes(String(s.status))).length,
    inactive: rows.filter((s) => !["active", "promoted"].includes(String(s.status))).length,
  };
  ok(res, { class: classDto(c), students: rows.map((s) => Object.assign({}, s, { fee_status: Number(s.fees_paid || 0) >= Number(s.fees_due || 0) && Number(s.fees_due || 0) > 0 ? "paid" : "outstanding" })), stats });
}));

router.post("/:id/students", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const ids = arr(req.body && (req.body.student_ids || req.body.student_id)).map((x) => toNum(x, 0)).filter(Boolean);
  if (!ids.length) return err(res, 400, "Select at least one student.");
  let moved = 0;
  await db.transaction(async (tx) => {
    for (const sid of ids) {
      const s = await tx.get("SELECT id, class_id, session_id FROM students WHERE id = ? AND madrasa_id = ?", [sid, c.madrasa_id]);
      if (!s) continue;
      const sets = ["class_id = ?", "updated_at = CURRENT_TIMESTAMP"];
      const vals = [c.id];
      if (c.session_id) { sets.push("session_id = ?"); vals.push(c.session_id); }
      if (c.education_track === "islamic" || c.education_track === "both") { sets.push("islamic_class_id = ?"); vals.push(c.id); }
      if (c.education_track === "western" || c.education_track === "both") { sets.push("western_class_id = ?"); vals.push(c.id); }
      await tx.run(`UPDATE students SET ${sets.join(", ")} WHERE id = ? AND madrasa_id = ?`, vals.concat([sid, c.madrasa_id]));
      await tx.run("INSERT INTO student_class_history (madrasa_id, student_id, from_class_id, to_class_id, from_session_id, to_session_id, action, notes, changed_by) VALUES (?,?,?,?,?,?,?,?,?)", [c.madrasa_id, sid, s.class_id || null, c.id, s.session_id || null, c.session_id || s.session_id || null, "placement", cleanStr(req.body && req.body.notes, 500), req.user.id]);
      moved++;
    }
  });
  ok(res, { ok: true, moved });
}));

router.post("/:id/students/transfer", ADMIN, asyncHandler(async (req, res) => {
  const from = await classRow(req, res, req.params.id); if (!from) return;
  const toId = toNum(req.body && (req.body.to_class_id || req.body.class_id), 0);
  const to = await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [toId, from.madrasa_id]);
  if (!to) return err(res, 400, "Unknown target class.");
  const ids = arr(req.body && req.body.student_ids).map((x) => toNum(x, 0)).filter(Boolean);
  if (!ids.length) return err(res, 400, "Select at least one student.");
  req.params.id = String(to.id);
  req.body = Object.assign({}, req.body, { student_ids: ids, notes: cleanStr(req.body && req.body.notes, 500) || `Transferred from ${from.name_en}` });
  // Reuse the placement logic by performing the same update here explicitly.
  let moved = 0;
  await db.transaction(async (tx) => {
    for (const sid of ids) {
      const s = await tx.get("SELECT id, class_id, session_id FROM students WHERE id = ? AND madrasa_id = ? AND class_id = ?", [sid, from.madrasa_id, from.id]);
      if (!s) continue;
      await tx.run("UPDATE students SET class_id = ?, session_id = COALESCE(?, session_id), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [to.id, to.session_id || null, sid, from.madrasa_id]);
      await tx.run("INSERT INTO student_class_history (madrasa_id, student_id, from_class_id, to_class_id, from_session_id, to_session_id, action, notes, changed_by) VALUES (?,?,?,?,?,?,?,?,?)", [from.madrasa_id, sid, from.id, to.id, s.session_id || null, to.session_id || s.session_id || null, "transfer", cleanStr(req.body.notes, 500), req.user.id]);
      moved++;
    }
  });
  ok(res, { ok: true, moved });
}));

router.delete("/:id/students/:studentId", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const s = await db.get("SELECT id, class_id, session_id FROM students WHERE id = ? AND madrasa_id = ? AND class_id = ?", [toNum(req.params.studentId, 0), c.madrasa_id, c.id]);
  if (!s) return err(res, 404, "Student is not in this class.");
  await db.transaction(async (tx) => {
    await tx.run("UPDATE students SET class_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [s.id, c.madrasa_id]);
    await tx.run("INSERT INTO student_class_history (madrasa_id, student_id, from_class_id, to_class_id, from_session_id, to_session_id, action, notes, changed_by) VALUES (?,?,?,?,?,?,?,?,?)", [c.madrasa_id, s.id, c.id, null, s.session_id || null, s.session_id || null, "remove", "Removed from class", req.user.id]);
  });
  ok(res, { ok: true });
}));

router.get("/:id/teachers", STAFF, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const rows = await db.all(
    `SELECT ta.id AS assignment_id, ta.role, ta.subject_id, ta.assigned_periods, ta.notes,
            u.id, u.full_name, u.email, u.phone, u.is_active, p.staff_id, p.photo_path, p.status,
            s.name_en AS subject_name, s.name_ar AS subject_name_ar
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.user_id AND u.madrasa_id = ta.madrasa_id
       LEFT JOIN teacher_profiles p ON p.user_id = u.id AND p.madrasa_id = u.madrasa_id
       LEFT JOIN subjects s ON s.id = ta.subject_id AND s.madrasa_id = ta.madrasa_id
      WHERE ta.madrasa_id = ? AND ta.class_id = ?
      ORDER BY CASE ta.role WHEN 'class_teacher' THEN 1 WHEN 'assistant_class_teacher' THEN 2 WHEN 'subject_teacher' THEN 3 ELSE 4 END, u.full_name`,
    [c.madrasa_id, c.id]
  );
  const normalized = rows.map((r) => Object.assign({}, r, {
    id: Number(r.id), assignment_id: Number(r.assignment_id), subject: r.subject_id ? { id: Number(r.subject_id), name_en: r.subject_name || "", name_ar: r.subject_name_ar || "" } : null,
    status: r.status || (r.is_active ? "active" : "inactive"),
  }));
  ok(res, { class: classDto(c), teachers: normalized });
}));

router.post("/:id/teachers", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const userId = toNum(req.body && (req.body.user_id || req.body.teacher_id), 0);
  if (!userId || !await teacherExists(c.madrasa_id, userId)) return err(res, 400, "Unknown teacher.");
  const subjectId = req.body && (req.body.subject_id || req.body.subjectId) ? toNum(req.body.subject_id || req.body.subjectId, 0) : null;
  if (subjectId && !await subjectExists(c.madrasa_id, subjectId)) return err(res, 400, "Unknown subject.");
  const role = normalizeRole(req.body && req.body.role);
  let assignmentId = 0;
  await db.transaction(async (tx) => {
    assignmentId = await addTeacherAssignment(tx, c.madrasa_id, c.id, userId, role, subjectId, req.body && req.body.assigned_periods, cleanStr(req.body && req.body.notes, 500), c.session_id || null);
    if (role === "class_teacher") await tx.run("UPDATE classes SET class_teacher_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [userId, c.id, c.madrasa_id]);
    if (role === "assistant_class_teacher") await tx.run("UPDATE classes SET assistant_teacher_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [userId, c.id, c.madrasa_id]);
  });
  logActivity(db, { madrasaId: c.madrasa_id, userId: req.user.id, action: "class.teacher.assign", entity: "class", entityId: String(c.id), meta: { teacherId: userId, role, subjectId }, ip: req.ip });
  ok(res, { ok: true, assignmentId });
}));

router.patch("/:id/teachers/:assignmentId", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const assignment = await db.get("SELECT * FROM teacher_assignments WHERE id = ? AND madrasa_id = ? AND class_id = ?", [toNum(req.params.assignmentId, 0), c.madrasa_id, c.id]);
  if (!assignment) return err(res, 404, "Assignment not found.");
  const subjectId = req.body && req.body.subject_id !== undefined ? (req.body.subject_id ? toNum(req.body.subject_id, 0) : null) : assignment.subject_id;
  if (subjectId && !await subjectExists(c.madrasa_id, subjectId)) return err(res, 400, "Unknown subject.");
  const role = req.body && req.body.role !== undefined ? normalizeRole(req.body.role) : assignment.role;
  await db.run("UPDATE teacher_assignments SET subject_id = ?, role = ?, assigned_periods = ?, notes = ? WHERE id = ? AND madrasa_id = ?", [subjectId, role, cleanStr(req.body && req.body.assigned_periods, 500), cleanStr(req.body && req.body.notes, 500), assignment.id, c.madrasa_id]);
  if (subjectId) await db.insertIgnore("class_subjects", "madrasa_id, class_id, subject_id", [c.madrasa_id, c.id, subjectId]);
  ok(res, { ok: true });
}));

router.delete("/:id/teachers/:assignmentId", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const assignment = await db.get("SELECT * FROM teacher_assignments WHERE id = ? AND madrasa_id = ? AND class_id = ?", [toNum(req.params.assignmentId, 0), c.madrasa_id, c.id]);
  if (!assignment) return err(res, 404, "Assignment not found.");
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM teacher_assignments WHERE id = ? AND madrasa_id = ?", [assignment.id, c.madrasa_id]);
    if (assignment.role === "class_teacher" && Number(c.class_teacher_id) === Number(assignment.user_id)) await tx.run("UPDATE classes SET class_teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [c.id, c.madrasa_id]);
    if (assignment.role === "assistant_class_teacher" && Number(c.assistant_teacher_id) === Number(assignment.user_id)) await tx.run("UPDATE classes SET assistant_teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [c.id, c.madrasa_id]);
  });
  ok(res, { ok: true });
}));

router.put("/:id/subjects", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const subjectIds = arr(req.body && req.body.subject_ids).map((x) => toNum(x, 0)).filter(Boolean);
  await setClassSubjects(db, c.madrasa_id, c.id, subjectIds);
  ok(res, { ok: true });
}));

router.get("/:id", STAFF, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const subjects = await classSubjects(c.madrasa_id, [Number(c.id)]);
  const [teachers, students, timetable] = await Promise.all([
    db.all(`SELECT ta.id AS assignment_id, ta.role, u.id, u.full_name, p.staff_id, s.name_en AS subject_name FROM teacher_assignments ta JOIN users u ON u.id = ta.user_id LEFT JOIN teacher_profiles p ON p.user_id = u.id AND p.madrasa_id = u.madrasa_id LEFT JOIN subjects s ON s.id = ta.subject_id WHERE ta.madrasa_id = ? AND ta.class_id = ? ORDER BY u.full_name`, [c.madrasa_id, c.id]),
    db.all("SELECT id, admission_no, student_code, first_name, last_name, gender, status, photo_path FROM students WHERE madrasa_id = ? AND class_id = ? ORDER BY last_name, first_name LIMIT 300", [c.madrasa_id, c.id]),
    db.all("SELECT * FROM timetable_slots WHERE madrasa_id = ? AND class_id = ? ORDER BY day, period", [c.madrasa_id, c.id]),
  ]);
  ok(res, { class: classDto(c, subjects.get(Number(c.id)) || []), teachers, students, timetable });
}));

router.patch("/:id", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name_en !== undefined || b.class_name !== undefined) {
    const name = cleanStr(b.name_en || b.class_name, 120);
    if (!name) return err(res, 400, "Class name is required.");
    const dup = await db.get("SELECT id FROM classes WHERE madrasa_id = ? AND name_en = ? AND id <> ?", [c.madrasa_id, name, c.id]);
    if (dup) return err(res, 400, "A class with this name already exists.");
    sets.push("name_en = ?"); vals.push(name);
  }
  if (b.name_ar !== undefined) { sets.push("name_ar = ?"); vals.push(cleanStr(b.name_ar, 120)); }
  if (b.sort_order !== undefined) { sets.push("sort_order = ?"); vals.push(toNum(b.sort_order, 0)); }
  if (b.class_code !== undefined) {
    const code = cleanStr(b.class_code, 60).toUpperCase();
    if (code && await db.get("SELECT id FROM classes WHERE madrasa_id = ? AND class_code = ? AND id <> ? AND class_code <> ''", [c.madrasa_id, code, c.id])) return err(res, 400, "A class with this code already exists.");
    sets.push("class_code = ?"); vals.push(code);
  }
  if (b.education_track !== undefined) { sets.push("education_track = ?"); vals.push(normalizeTrack(b.education_track)); }
  if (b.program !== undefined) { sets.push("program = ?"); vals.push(cleanStr(b.program, 120)); }
  if (b.level !== undefined || b.level_name !== undefined) { sets.push("level_name = ?"); vals.push(cleanStr(b.level || b.level_name, 80)); }
  if (b.section_arm !== undefined || b.section !== undefined) { sets.push("section_arm = ?"); vals.push(cleanStr(b.section_arm || b.section, 80)); }
  if (b.session_id !== undefined || b.academic_session_id !== undefined) { const sid = b.session_id || b.academic_session_id ? toNum(b.session_id || b.academic_session_id, 0) : null; if (sid && !await sessionExists(c.madrasa_id, sid)) return err(res, 400, "Unknown academic session."); sets.push("session_id = ?"); vals.push(sid); }
  if (b.term_id !== undefined || b.term_semester_id !== undefined) { const termId = b.term_id || b.term_semester_id ? toNum(b.term_id || b.term_semester_id, 0) : null; if (termId && !await termExists(c.madrasa_id, termId)) return err(res, 400, "Unknown term/semester."); sets.push("term_id = ?"); vals.push(termId); }
  if (b.class_teacher_id !== undefined) { const id = b.class_teacher_id ? toNum(b.class_teacher_id, 0) : null; if (id && !await teacherExists(c.madrasa_id, id)) return err(res, 400, "Unknown class teacher."); sets.push("class_teacher_id = ?"); vals.push(id); }
  if (b.assistant_teacher_id !== undefined) { const id = b.assistant_teacher_id ? toNum(b.assistant_teacher_id, 0) : null; if (id && !await teacherExists(c.madrasa_id, id)) return err(res, 400, "Unknown assistant teacher."); sets.push("assistant_teacher_id = ?"); vals.push(id); }
  if (b.max_capacity !== undefined) { sets.push("max_capacity = ?"); vals.push(b.max_capacity ? toNum(b.max_capacity, 0) : null); }
  if (b.description !== undefined) { sets.push("description = ?"); vals.push(cleanStr(b.description, 5000)); }
  if (b.status !== undefined || b.is_active !== undefined) {
    const status = b.status !== undefined ? normalizeStatus(b.status, c.status || "active") : (b.is_active ? "active" : "inactive");
    sets.push("status = ?", "is_active = ?", "archived_at = ?"); vals.push(status, status === "active" ? 1 : 0, status === "archived" ? new Date().toISOString() : null);
  }
  if (!sets.length && b.subject_ids === undefined) return err(res, 400, "Nothing to update.");
  await db.transaction(async (tx) => {
    if (sets.length) await tx.run(`UPDATE classes SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?`, vals.concat([c.id, c.madrasa_id]));
    if (b.subject_ids !== undefined) await setClassSubjects(tx, c.madrasa_id, c.id, arr(b.subject_ids));
    if (b.class_teacher_id) await addTeacherAssignment(tx, c.madrasa_id, c.id, toNum(b.class_teacher_id, 0), "class_teacher", null, "", "", c.session_id || null);
    if (b.assistant_teacher_id) await addTeacherAssignment(tx, c.madrasa_id, c.id, toNum(b.assistant_teacher_id, 0), "assistant_class_teacher", null, "", "", c.session_id || null);
  });
  logActivity(db, { madrasaId: c.madrasa_id, userId: req.user.id, action: "class.update", entity: "class", entityId: String(c.id), ip: req.ip });
  ok(res, { ok: true });
}));

router.delete("/:id", ADMIN, asyncHandler(async (req, res) => {
  const c = await classRow(req, res, req.params.id); if (!c) return;
  await db.run("UPDATE classes SET status = 'archived', is_active = 0, archived_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [new Date().toISOString(), c.id, c.madrasa_id]);
  logActivity(db, { madrasaId: c.madrasa_id, userId: req.user.id, action: "class.archive", entity: "class", entityId: String(c.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
