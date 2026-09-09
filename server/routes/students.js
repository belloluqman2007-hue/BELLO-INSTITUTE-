"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Student management routes
   ----------------------------------------------------------------------------
   madrasa_admin: full CRUD for their madrasa only (plan limits enforced).
   teacher:       read-only, limited to assigned classes.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, validDate, validPhone, logActivity, checkPlanLimits } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments } = require("../middleware/tenant");
const { imageUploader } = require("../middleware/upload");
const admission = require("../services/admission");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

/* ------------------------------ list ----------------------------------- */

router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  // Only staff may list students (admins: whole madrasa, teachers: assigned classes)
  if (!["madrasa_admin", "teacher", "super_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Permission denied." });
  }

  let classFilter = null;
  if (req.user.role === "teacher") {
    // Teachers may only list students of classes assigned to them.
    // If a classId query param is given, intersect with the assigned set.
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (scope.anyClassAnySubject) {
      classFilter = req.query.classId ? [toNum(req.query.classId, 0)] : null;
    } else {
      const assigned = [...scope.assignedClassIds];
      if (assigned.length === 0) { res.json({ students: [], total: 0 }); return; }
      classFilter = req.query.classId ? assigned.filter((c) => c === toNum(req.query.classId, 0)) : assigned;
      if (classFilter.length === 0) { res.json({ students: [], total: 0 }); return; }
    }
  } else if (req.query.classId) {
    classFilter = [toNum(req.query.classId, 0)];
  }

  const search = cleanStr(req.query.search, 100).toLowerCase();
  const page = Math.max(1, toNum(req.query.page, 1));
  const perPage = Math.min(200, Math.max(1, toNum(req.query.perPage, 50)));
  const offset = (page - 1) * perPage;

  let where = "s.madrasa_id = ?";
  const params = [tid];
  if (classFilter) {
    where += " AND s.class_id IN (" + classFilter.map(() => "?").join(",") + ")";
    params.push(...classFilter);
  }
  if (search) {
    where += " AND (LOWER(s.first_name || ' ' || s.last_name) LIKE ? OR s.admission_no LIKE ? OR s.name_ar LIKE ?)";
    const like = "%" + search + "%";
    params.push(like, like, like);
  }
  if (req.query.status) {
    where += " AND s.status = ?";
    params.push(cleanStr(req.query.status, 20));
  }

  const total = await db.get(`SELECT COUNT(*) AS n FROM students s WHERE ${where}`, params);
  const rows = await db.all(
    `SELECT s.*, c.name_en AS class_en, c.name_ar AS class_ar
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE ${where}
     ORDER BY s.admission_no
     LIMIT ? OFFSET ?`,
    params.concat([perPage, offset])
  );
  ok(res, { students: rows, total: Number(total.n), page, perPage });
}));

/* ------------------------------ create --------------------------------- */

router.post("/", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const firstName = cleanStr(b.first_name, 100);
  if (!firstName) return err(res, 400, "First name is required.");

  const limitCheck = await checkPlanLimits(db, tid, "student");
  if (!limitCheck.allowed) return err(res, 403, limitCheck.message, { limit: limitCheck.limit, count: limitCheck.count });

  const classId = b.class_id ? toNum(b.class_id, 0) : null;
  if (classId) {
    const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
    if (!c) return err(res, 400, "Unknown class.");
  }
  const sessionId = b.session_id ? toNum(b.session_id, 0) : null;
  if (sessionId) {
    const s = await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid]);
    if (!s) return err(res, 400, "Unknown academic session.");
  }
  const dob = validDate(b.date_of_birth);
  if (b.date_of_birth && !dob) return err(res, 400, "Invalid date of birth (use YYYY-MM-DD).");
  const phone = validPhone(b.parent_phone) ? cleanStr(b.parent_phone, 60) : null;
  if (phone === null) return err(res, 400, "Invalid parent phone.");

  const { admissionNo } = await admission.nextAdmissionNo(tid);
  const r = await db.run(
    `INSERT INTO students (madrasa_id, admission_no, first_name, last_name, name_ar, gender, date_of_birth, class_id, session_id, parent_name, parent_phone, address, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      tid, admissionNo, firstName, cleanStr(b.last_name, 100), cleanStr(b.name_ar, 160),
      cleanStr(b.gender, 10), dob, classId, sessionId,
      cleanStr(b.parent_name, 160), phone, cleanStr(b.address, 255), cleanStr(b.notes, 2000),
    ]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.create", entity: "student", entityId: String(r.lastInsertRowid), meta: { admission_no: admissionNo }, ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid, admissionNo });
}));

/* ------------------------------ read one ------------------------------- */

router.get("/:id", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  // Only staff may fetch a student record by id. Students/parents use /api/portal.
  if (!["madrasa_admin", "teacher", "super_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Permission denied." });
  }
  const sid = toNum(req.params.id, 0);
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [sid, tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && (!s.class_id || !scope.assignedClassIds.has(Number(s.class_id)))) {
      return res.status(404).json({ error: "Student not found." });
    }
  }
  const classRow = s.class_id ? await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [s.class_id, tid]) : null;
  const terms = await db.all(
    `SELECT ts.*, t.name_en AS term_name, t.name_ar AS term_name_ar, t.position
     FROM term_summaries ts JOIN terms t ON t.id = ts.term_id
     WHERE ts.madrasa_id = ? AND ts.student_id = ? ORDER BY t.position DESC, ts.id DESC LIMIT 20`,
    [tid, s.id]
  );
  ok(res, {
    student: Object.assign({}, s, { class_en: classRow ? classRow.name_en : "", class_ar: classRow ? classRow.name_ar : "" }),
    terms,
  });
}));

/* ------------------------------ update --------------------------------- */

router.patch("/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const fieldMap = {
    first_name: 100, last_name: 100, name_ar: 160, gender: 10,
    parent_name: 160, address: 255, notes: 2000,
  };
  for (const [f, max] of Object.entries(fieldMap)) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(cleanStr(b[f], max)); }
  }
  if (b.date_of_birth !== undefined) {
    const d = b.date_of_birth ? validDate(b.date_of_birth) : null;
    if (b.date_of_birth && !d) return err(res, 400, "Invalid date of birth.");
    sets.push("date_of_birth = ?"); vals.push(d);
  }
  if (b.parent_phone !== undefined) {
    if (!validPhone(b.parent_phone)) return err(res, 400, "Invalid parent phone.");
    sets.push("parent_phone = ?"); vals.push(cleanStr(b.parent_phone, 60));
  }
  if (b.class_id !== undefined) {
    const cid = b.class_id ? toNum(b.class_id, 0) : null;
    if (cid) {
      const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [cid, tid]);
      if (!c) return err(res, 400, "Unknown class.");
    }
    sets.push("class_id = ?"); vals.push(cid);
  }
  if (b.session_id !== undefined) {
    sets.push("session_id = ?"); vals.push(b.session_id ? toNum(b.session_id, 0) : null);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(s.id);
  await db.run(`UPDATE students SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.update", entity: "student", entityId: String(s.id), ip: req.ip });
  ok(res, { ok: true });
}));

/* ------------------------------ status / promote ----------------------- */

router.patch("/:id/status", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  const status = cleanStr((req.body || {}).status, 20);
  if (!["active", "promoted", "graduated", "withdrawn", "suspended"].includes(status)) {
    return err(res, 400, "Invalid status.");
  }
  await db.run("UPDATE students SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, s.id]);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.status", entity: "student", entityId: String(s.id), meta: { status }, ip: req.ip });
  ok(res, { ok: true });
}));

/** Promote a student to another class (optionally next session). */
router.post("/:id/promote", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  const b = req.body || {};
  const classId = b.class_id ? toNum(b.class_id, 0) : null;
  if (classId) {
    const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
    if (!c) return err(res, 400, "Unknown target class.");
  }
  const sessionId = b.session_id ? toNum(b.session_id, 0) : null;
  await db.run(
    "UPDATE students SET class_id = COALESCE(?, class_id), session_id = COALESCE(?, session_id), status = 'promoted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [classId, sessionId, s.id]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.promote", entity: "student", entityId: String(s.id), meta: { class_id: classId, session_id: sessionId }, ip: req.ip });
  ok(res, { ok: true });
}));

/** Bulk promote: all students of a class -> target class (admin). */
router.post("/bulk-promote", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const fromClassId = toNum(b.from_class_id, 0);
  const toClassId = b.to_class_id ? toNum(b.to_class_id, 0) : null;
  if (!fromClassId) return err(res, 400, "from_class_id is required.");
  if (toClassId) {
    const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [toClassId, tid]);
    if (!c) return err(res, 400, "Unknown target class.");
  }
  const res2 = await db.run(
    "UPDATE students SET class_id = ?, status = 'promoted', updated_at = CURRENT_TIMESTAMP WHERE madrasa_id = ? AND class_id = ? AND status IN ('active','promoted')",
    [toClassId || fromClassId, tid, fromClassId]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.bulk_promote", entity: "class", entityId: String(fromClassId), meta: { moved: res2.changes }, ip: req.ip });
  ok(res, { ok: true, moved: res2.changes });
}));

/* ------------------------------ photo ---------------------------------- */

router.post("/:id/photo", requireRole("madrasa_admin"), imageUploader("photos", "photo"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  if (!req.file) return err(res, 400, "No image uploaded.");
  await db.run("UPDATE students SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [`/uploads/photos/${req.file.filename}`, s.id]);
  ok(res, { ok: true, photoPath: `/uploads/photos/${req.file.filename}` });
}));

/* ------------------------------ portal account ------------------------- */

/** Create (or reset) the student's portal login account. */
router.post("/:id/portal-account", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  const b = req.body || {};
  const username = cleanStr(b.username, 100).toLowerCase();
  const password = String(b.password || "");
  if (!username || password.length < 8) return err(res, 400, "username and a password of at least 8 characters are required.");
  if (!/^[a-z0-9_.-]{3,}$/.test(username)) return err(res, 400, "Invalid username format.");
  const hash = require("bcryptjs").hashSync(password, 10);

  const existing = await db.get("SELECT id FROM users WHERE student_id = ? AND madrasa_id = ? AND role = 'student'", [s.id, tid]);
  if (existing) {
    await db.run("UPDATE users SET username = ?, password_hash = ?, is_active = 1 WHERE id = ?", [username, hash, existing.id]);
    return ok(res, { ok: true, id: existing.id, created: false });
  }
  const clash = await db.get("SELECT id FROM users WHERE username = ?", [username]);
  if (clash) return err(res, 400, "That username is already taken.");
  const r = await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, student_id) VALUES (?,?,?,?,?,?)",
    [tid, username, hash, "student", `${s.first_name} ${s.last_name}`.trim(), s.id]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.portal_account", entity: "user", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid, created: true });
}));

/** Create a parent account and link one or more students to it. */
router.post("/:id/parent-account", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const s = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!s) return res.status(404).json({ error: "Student not found." });
  const b = req.body || {};
  const username = cleanStr(b.username, 100).toLowerCase();
  const password = String(b.password || "");
  const studentIds = Array.isArray(b.student_ids) ? b.student_ids.map((x) => toNum(x, 0)).filter(Boolean) : [s.id];
  if (!username || password.length < 8) return err(res, 400, "username and a password of at least 8 characters are required.");
  if (!/^[a-z0-9_.-]{3,}$/.test(username)) return err(res, 400, "Invalid username format.");
  const clash = await db.get("SELECT id FROM users WHERE username = ?", [username]);
  if (clash) return err(res, 400, "That username is already taken.");
  const hash = require("bcryptjs").hashSync(password, 10);
  const r = await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, phone) VALUES (?,?,?,?,?,?)",
    [tid, username, hash, "parent", cleanStr(b.full_name, 160) || s.parent_name, cleanStr(b.phone, 60) || s.parent_phone]
  );
  for (const sid of studentIds) {
    const st = await db.get("SELECT id FROM students WHERE id = ? AND madrasa_id = ?", [sid, tid]);
    if (st) await db.insertIgnore("parent_links", "madrasa_id, user_id, student_id", [tid, r.lastInsertRowid, sid]);
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.parent_account", entity: "user", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

/* ------------------------------ import (CSV) --------------------------- */

/**
 * CSV columns: first_name,last_name,name_ar,gender,date_of_birth,class (name en),
 * parent_name,parent_phone,address
 * Class is matched by English name (created if missing is NOT automatic — must
 * pre-create classes). Duplicate admission numbers are never produced: each
 * import row gets the next sequential number.
 */
router.post("/import", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const text = String((req.body || {}).csv || (req.body || {}).file || "");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return err(res, 400, "No CSV content provided.");

  // Parse header
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const idx = (name) => header.indexOf(name);

  if (idx("first_name") === -1) {
    return err(res, 400, "CSV must have a first_name column (and optionally last_name, name_ar, gender, date_of_birth, class, parent_name, parent_phone, address).");
  }

  const classNames = new Map();
  const allClasses = await db.all("SELECT id, name_en FROM classes WHERE madrasa_id = ?", [tid]);
  allClasses.forEach((c) => classNames.set(c.name_en.toLowerCase(), c.id));

  const results = { inserted: 0, errors: [] };
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (name) => (idx(name) >= 0 ? cols[idx(name)] || "" : "");
    const firstName = cleanStr(get("first_name"), 100);
    if (!firstName) { results.errors.push(`Line ${i + 1}: first_name required`); continue; }
    const dob = validDate(get("date_of_birth"));
    const clsName = cleanStr(get("class"), 120).toLowerCase();
    const classId = clsName ? classNames.get(clsName) : null;
    if (clsName && !classId) { results.errors.push(`Line ${i + 1}: unknown class "${get("class")}"`); continue; }

    const limitCheck = await checkPlanLimits(db, tid, "student");
    if (!limitCheck.allowed) { results.errors.push(`Line ${i + 1}: ${limitCheck.message}`); continue; }

    const { admissionNo } = await admission.nextAdmissionNo(tid);
    await db.run(
      `INSERT INTO students (madrasa_id, admission_no, first_name, last_name, name_ar, gender, date_of_birth, class_id, parent_name, parent_phone, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tid, admissionNo, firstName, cleanStr(get("last_name"), 100), cleanStr(get("name_ar"), 160),
        cleanStr(get("gender"), 10), dob, classId,
        cleanStr(get("parent_name"), 160), cleanStr(get("parent_phone"), 60), cleanStr(get("address"), 255),
      ]
    );
    results.inserted++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "student.import", entity: "student", meta: { inserted: results.inserted, errors: results.errors.length }, ip: req.ip });
  ok(res, results);
}));

module.exports = router;
