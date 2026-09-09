"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Super Admin (platform-level) routes
   ----------------------------------------------------------------------------
   Everything here is protected by requireSuperAdmin. A super admin can:
     • manage madaris (create, suspend/activate, plan, profile)
     • manage each madrasa's admin account
     • manage subscription plans
     • view platform statistics & activity
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity } = require("../util");
const { requireSuperAdmin } = require("../middleware/auth");
const analytics = require("../services/analytics");

const router = express.Router();
router.use(requireSuperAdmin);

/* ------------------------------ stats ---------------------------------- */

router.get("/stats", asyncHandler(async (req, res) => {
  const [madaris, active, admins, teachers, parents, studentsCount] = await Promise.all([
    db.get("SELECT COUNT(*) AS n FROM madaris"),
    db.get("SELECT COUNT(*) AS n FROM madaris WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'madrasa_admin' AND is_active = 1"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND is_active = 1"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'parent' AND is_active = 1"),
    db.get("SELECT COUNT(*) AS n FROM students WHERE status IN ('active','promoted','suspended')"),
  ]);
  const byPlan = await db.all(
    "SELECT p.code, COUNT(m.id) AS n FROM plans p LEFT JOIN madaris m ON m.plan_id = p.id GROUP BY p.code ORDER BY p.sort_order"
  );
  const recentActivity = await db.all(
    "SELECT a.*, u.username, m.slug AS madrasa_slug FROM activity_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN madaris m ON m.id = a.madrasa_id ORDER BY a.id DESC LIMIT 30"
  );
  ok(res, {
    madaris: Number(madaris.n),
    activeMadaris: Number(active.n),
    students: Number(studentsCount.n),
    teachers: Number(teachers.n),
    madrasaAdmins: Number(admins.n),
    parents: Number(parents.n),
    byPlan,
    recentActivity,
  });
}));

/* ---------------------------- analytics -------------------------------- */

/**
 * GET /api/platform/analytics?months=12
 * Platform-wide dashboard aggregates: tenant growth, enrolment, plan mix,
 * fee collections and activity. Super admin only (enforced by the router-wide
 * requireSuperAdmin above). Contains no student-level data.
 */
router.get("/analytics", asyncHandler(async (req, res) => {
  const data = await analytics.platformAnalytics({ months: req.query.months });
  ok(res, { analytics: data });
}));

/* ------------------------------ madaris -------------------------------- */

router.get("/madaris", asyncHandler(async (req, res) => {
  const rows = await db.all(`
    SELECT m.*, p.code AS plan_code, p.name AS plan_name,
      (SELECT COUNT(*) FROM students s WHERE s.madrasa_id = m.id AND s.status IN ('active','promoted','suspended')) AS student_count,
      (SELECT COUNT(*) FROM users u WHERE u.madrasa_id = m.id AND u.role = 'teacher' AND u.is_active = 1) AS teacher_count
    FROM madaris m LEFT JOIN plans p ON p.id = m.plan_id
    ORDER BY m.id DESC
  `);
  ok(res, { madaris: rows });
}));

router.post("/madaris", asyncHandler(async (req, res) => {
  const b = req.body || {};
  const slug = cleanStr(b.slug, 80).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const nameEn = cleanStr(b.name_en, 160);
  if (!slug || !nameEn) return err(res, 400, "A unique slug and English name are required.");
  const exists = await db.get("SELECT id FROM madaris WHERE slug = ?", [slug]);
  if (exists) return err(res, 400, "That slug is already taken.");
  const planId = toNum(b.plan_id, 1);
  const plan = await db.get("SELECT id FROM plans WHERE id = ?", [planId]);
  if (!plan) return err(res, 400, "Unknown plan.");

  const r = await db.run(
    `INSERT INTO madaris (slug, name_en, name_ar, motto_en, motto_ar, address, city, state_name, phone, email, plan_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active')`,
    [
      slug, nameEn, cleanStr(b.name_ar, 160), cleanStr(b.motto_en, 160), cleanStr(b.motto_ar, 160),
      cleanStr(b.address, 255), cleanStr(b.city, 80), cleanStr(b.state_name, 80),
      cleanStr(b.phone, 60), cleanStr(b.email, 120), plan.id,
    ]
  );
  const mid = r.lastInsertRowid;

  // Create the madrasa admin account at the same time (required to manage the madrasa)
  let adminCreated = false;
  const adminUser = cleanStr(b.admin_username, 100).toLowerCase();
  const adminPass = String(b.admin_password || "");
  if (adminUser && adminPass.length >= 8) {
    const taken = await db.get("SELECT id FROM users WHERE username = ?", [adminUser]);
    if (!taken) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await db.run(
        "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
        [mid, adminUser, hash, "madrasa_admin", cleanStr(b.admin_full_name, 160) || "Madrasa Administrator"]
      );
      adminCreated = true;
    }
  }
  logActivity(db, { userId: req.user.id, action: "madrasa.create", entity: "madrasa", entityId: String(mid), meta: { slug }, ip: req.ip });
  ok(res, { ok: true, id: mid, adminCreated });
}));

async function loadMadrasa(req, res, id) {
  const mid = toNum(id, 0);
  const row = await db.get("SELECT * FROM madaris WHERE id = ?", [mid]);
  if (!row) { res.status(404).json({ error: "Madrasa not found." }); return null; }
  return row;
}

router.get("/madaris/:id", asyncHandler(async (req, res) => {
  const m = await loadMadrasa(req, res, req.params.id);
  if (!m) return;
  const plan = await db.get("SELECT * FROM plans WHERE id = ?", [m.plan_id]);
  const admin = await db.get("SELECT id, username, full_name, email, phone, is_active FROM users WHERE madrasa_id = ? AND role = 'madrasa_admin'", [m.id]);
  ok(res, { madrasa: m, plan, admin });
}));

router.patch("/madaris/:id", asyncHandler(async (req, res) => {
  const m = await loadMadrasa(req, res, req.params.id);
  if (!m) return;
  const b = req.body || {};
  const fields = ["name_en", "name_ar", "motto_en", "motto_ar", "address", "city", "state_name", "phone", "email", "notes"];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(cleanStr(b[f], f === "notes" ? 2000 : 255)); }
  }
  if (b.status !== undefined && ["active", "suspended"].includes(b.status)) { sets.push("status = ?"); vals.push(b.status); }
  if (b.plan_id !== undefined) {
    const plan = await db.get("SELECT id FROM plans WHERE id = ?", [toNum(b.plan_id, 0)]);
    if (!plan) return err(res, 400, "Unknown plan.");
    sets.push("plan_id = ?"); vals.push(plan.id);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(m.id);
  await db.run(`UPDATE madaris SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { userId: req.user.id, madrasaId: m.id, action: "madrasa.update", entity: "madrasa", entityId: String(m.id), meta: { fields: sets.map((s) => s.split(" ")[0]) }, ip: req.ip });
  ok(res, { ok: true });
}));

/** Create or reset the madrasa's admin account. */
router.post("/madaris/:id/admin", asyncHandler(async (req, res) => {
  const m = await loadMadrasa(req, res, req.params.id);
  if (!m) return;
  const b = req.body || {};
  const username = cleanStr(b.username, 100).toLowerCase();
  const password = String(b.password || "");
  if (!username || password.length < 8) return err(res, 400, "Username and a password of at least 8 characters are required.");
  const existing = await db.get("SELECT id, username FROM users WHERE madrasa_id = ? AND role = 'madrasa_admin'", [m.id]);
  if (existing) {
    // Reset existing admin (optionally change the username)
    const hash = bcrypt.hashSync(password, 10);
    if (existing.username !== username) {
      const clash = await db.get("SELECT id FROM users WHERE username = ?", [username]);
      if (clash) return err(res, 400, "That username is taken by another account.");
    }
    await db.run(
      "UPDATE users SET username = ?, password_hash = ?, full_name = ?, email = ?, phone = ?, is_active = 1 WHERE id = ?",
      [username, hash, cleanStr(b.full_name, 160) || existing.username, cleanStr(b.email, 120), cleanStr(b.phone, 60), existing.id]
    );
    logActivity(db, { userId: req.user.id, madrasaId: m.id, action: "madrasa.admin.reset", entity: "user", entityId: String(existing.id), ip: req.ip });
  } else {
    const clash = await db.get("SELECT id FROM users WHERE username = ?", [username]);
    if (clash) return err(res, 400, "That username is taken by another account.");
    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run(
      "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, email, phone) VALUES (?,?,?,?,?,?,?)",
      [m.id, username, hash, "madrasa_admin", cleanStr(b.full_name, 160) || "Madrasa Administrator", cleanStr(b.email, 120), cleanStr(b.phone, 60)]
    );
    logActivity(db, { userId: req.user.id, madrasaId: m.id, action: "madrasa.admin.create", entity: "user", entityId: String(r.lastInsertRowid), ip: req.ip });
  }
  ok(res, { ok: true, username });
}));

/* ------------------------------ plans ---------------------------------- */

router.get("/plans", asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM madaris m WHERE m.plan_id = p.id) AS madaris_count
     FROM plans p ORDER BY p.sort_order`
  );
  ok(res, { plans: rows.map((p) => Object.assign({}, p, { features: JSON.parse(p.features || "{}") })) });
}));

router.post("/plans", asyncHandler(async (req, res) => {
  const b = req.body || {};
  const code = cleanStr(b.code, 30).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = cleanStr(b.name, 80);
  if (!code || !name) return err(res, 400, "code and name are required.");
  const exists = await db.get("SELECT id FROM plans WHERE code = ?", [code]);
  if (exists) return err(res, 400, "Plan code already exists.");
  const r = await db.run(
    "INSERT INTO plans (code, name, name_ar, price_ngn, student_limit, teacher_limit, features, sort_order) VALUES (?,?,?,?,?,?,?,?)",
    [code, name, cleanStr(b.name_ar, 80), toNum(b.price_ngn, 0), toNum(b.student_limit, -1), toNum(b.teacher_limit, -1), JSON.stringify(b.features || {}), toNum(b.sort_order, 99)]
  );
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.patch("/plans/:id", asyncHandler(async (req, res) => {
  const b = req.body || {};
  const p = await db.get("SELECT * FROM plans WHERE id = ?", [toNum(req.params.id, 0)]);
  if (!p) return res.status(404).json({ error: "Plan not found." });
  const fields = ["name", "name_ar", "price_ngn", "student_limit", "teacher_limit", "sort_order", "is_active"];
  const sets = [];
  const vals = [];
  for (const f of fields) if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === "name_ar" || f === "name" ? cleanStr(b[f], 80) : toNum(b[f], 0)); }
  if (b.features !== undefined) { sets.push("features = ?"); vals.push(JSON.stringify(b.features)); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(p.id);
  await db.run(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, vals);
  ok(res, { ok: true });
}));

/* ------------------------------ activity ------------------------------- */

router.get("/activity", asyncHandler(async (req, res) => {
  const mid = toNum(req.query.madrasaId, 0);
  const limit = Math.min(200, toNum(req.query.limit, 50));
  const rows = mid
    ? await db.all("SELECT * FROM activity_log WHERE madrasa_id = ? ORDER BY id DESC LIMIT ?", [mid, limit])
    : await db.all("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", [limit]);
  ok(res, { activity: rows });
}));

/* ------------------------------ platform settings ---------------------- */

router.get("/settings", asyncHandler(async (req, res) => {
  const rows = await db.all("SELECT key_name, value FROM platform_settings");
  const out = {};
  rows.forEach((r) => { out[r.key_name] = r.value; });
  ok(res, { settings: out });
}));

router.put("/settings", asyncHandler(async (req, res) => {
  const b = req.body || {};
  const dialect = await db.dialect();
  for (const [k, v] of Object.entries(b)) {
    const key = cleanStr(k, 80);
    if (!key) continue;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (dialect === "sqlite") {
      await db.run(
        `INSERT INTO platform_settings (key_name, value) VALUES (?, ?)
         ON CONFLICT(key_name) DO UPDATE SET value = excluded.value`,
        [key, val]
      );
    } else {
      await db.run(
        "INSERT INTO platform_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [key, val]
      );
    }
  }
  logActivity(db, { userId: req.user.id, action: "platform.settings", entity: "settings", ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
