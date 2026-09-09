"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Teacher management routes
   ----------------------------------------------------------------------------
   madrasa_admin: create teacher accounts (plan limits), assign classes/
                  subjects, activate/deactivate.
   teacher:       read own assignments and classes.
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, validPhone, logActivity, checkPlanLimits } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

/* ------------------------------ list ----------------------------------- */

router.get("/", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const rows = await db.all(
    `SELECT id, username, full_name, full_name_ar, email, phone, is_active, created_at
     FROM users WHERE madrasa_id = ? AND role = 'teacher' ORDER BY full_name`,
    [tid]
  );
  const subs = await db.all("SELECT * FROM subjects WHERE madrasa_id = ?", [tid]);
  const classes = await db.all("SELECT * FROM classes WHERE madrasa_id = ?", [tid]);
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  for (const r of rows) {
    const a = await db.all("SELECT * FROM teacher_assignments WHERE madrasa_id = ? AND user_id = ?", [tid, r.id]);
    r.assignments = a.map((x) => ({
      classId: x.class_id,
      subjectId: x.subject_id,
      class: x.class_id ? classMap.get(x.class_id) : null,
      subject: x.subject_id ? subMap.get(x.subject_id) : null,
    }));
  }
  ok(res, { teachers: rows, classes, subjects: subs });
}));

/* ------------------------------ create --------------------------------- */

router.post("/", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const username = cleanStr(b.username, 100).toLowerCase();
  const password = String(b.password || "");
  const fullName = cleanStr(b.full_name, 160);
  if (!username || !password || !fullName) return err(res, 400, "username, password and full_name are required.");
  if (password.length < 8) return err(res, 400, "Password must be at least 8 characters.");
  if (!/^[a-z0-9_.-]{3,}$/.test(username)) return err(res, 400, "Username must be 3+ chars (letters, numbers, dot, dash, underscore).");

  const limitCheck = await checkPlanLimits(db, tid, "teacher");
  if (!limitCheck.allowed) return err(res, 403, limitCheck.message, { limit: limitCheck.limit, count: limitCheck.count });

  const taken = await db.get("SELECT id FROM users WHERE username = ?", [username]);
  if (taken) return err(res, 400, "That username is already taken.");

  const phone = cleanStr(b.phone, 60);
  if (b.phone && !validPhone(b.phone)) return err(res, 400, "Invalid phone number.");

  const hash = bcrypt.hashSync(password, 10);
  const r = await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, full_name_ar, email, phone) VALUES (?,?,?,?,?,?,?,?)",
    [tid, username, hash, "teacher", fullName, cleanStr(b.full_name_ar, 160), cleanStr(b.email, 120), phone]
  );
  await setAssignments(tid, r.lastInsertRowid, b.assignments);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "teacher.create", entity: "user", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

/** assignments: [{ class_id, subject_id? }]  (subject_id optional) */
async function setAssignments(tid, userId, assignments) {
  if (!Array.isArray(assignments)) return;
  await db.run("DELETE FROM teacher_assignments WHERE madrasa_id = ? AND user_id = ?", [tid, userId]);
  for (const a of assignments) {
    const cid = a.class_id ? toNum(a.class_id, 0) : null;
    const sid = a.subject_id ? toNum(a.subject_id, 0) : null;
    if (cid) {
      const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [cid, tid]);
      if (!c) continue;
    }
    if (sid) {
      const s = await db.get("SELECT id FROM subjects WHERE id = ? AND madrasa_id = ?", [sid, tid]);
      if (!s) continue;
    }
    await db.insertIgnore("teacher_assignments", "madrasa_id, user_id, class_id, subject_id", [tid, userId, cid, sid]);
  }
}

/* ------------------------------ update --------------------------------- */

router.patch("/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const u = await db.get("SELECT * FROM users WHERE id = ? AND madrasa_id = ? AND role = 'teacher'", [toNum(req.params.id, 0), tid]);
  if (!u) return res.status(404).json({ error: "Teacher not found." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.full_name !== undefined) { sets.push("full_name = ?"); vals.push(cleanStr(b.full_name, 160)); }
  if (b.email !== undefined) { sets.push("email = ?"); vals.push(cleanStr(b.email, 120)); }
  if (b.phone !== undefined) {
    if (b.phone && !validPhone(b.phone)) return err(res, 400, "Invalid phone number.");
    sets.push("phone = ?"); vals.push(cleanStr(b.phone, 60));
  }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
  if (b.password && String(b.password).length >= 8) {
    sets.push("password_hash = ?"); vals.push(bcrypt.hashSync(String(b.password), 10));
  }
  if (sets.length) {
    vals.push(u.id);
    await db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
  }
  if (b.assignments !== undefined) {
    await setAssignments(tid, u.id, b.assignments);
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "teacher.update", entity: "user", entityId: String(u.id), ip: req.ip });
  ok(res, { ok: true });
}));

/* ------------------------------ teacher self-service ------------------- */

router.get("/me/assignments", requireRole("teacher"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const scope = await getTeacherAssignments(tid, req.user.id);
  const classes = scope.anyClassAnySubject
    ? await db.all("SELECT * FROM classes WHERE madrasa_id = ? AND is_active = 1 ORDER BY sort_order", [tid])
    : await db.all("SELECT * FROM classes WHERE madrasa_id = ? AND id IN (" + (scope.assignedClassIds.length ? [...scope.assignedClassIds].map(() => "?").join(",") : "NULL") + ") ORDER BY sort_order", [tid].concat([...scope.assignedClassIds]));
  const subjects = await db.all("SELECT * FROM subjects WHERE madrasa_id = ? AND is_active = 1", [tid]);
  const subMap = new Map(subjects.map((s) => [s.id, s]));
  const rows = await db.all("SELECT * FROM teacher_assignments WHERE madrasa_id = ? AND user_id = ?", [tid, req.user.id]);
  ok(res, {
    classes,
    subjects: [...scope.classSubjects].map((k) => {
      const [c, s] = k.split(":").map(Number);
      return { classId: c, subject: subMap.get(s) };
    }),
    assignments: rows,
  });
}));

module.exports = router;
