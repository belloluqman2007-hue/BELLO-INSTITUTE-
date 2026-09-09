"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — shared utilities
   ========================================================================== */

/** Wraps async route handlers so rejections hit the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** JSON error helper. 404 (not 403) is used for tenant isolation so resource
    existence is not leaked across tenants. */
function err(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

function ok(res, data = {}) {
  return res.json(data);
}

/* ------------------------------ validation ------------------------------- */

function cleanStr(v, max = 255) {
  return String(v === null || v === undefined ? "" : v).trim().slice(0, max);
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(v, min, max, fallback) {
  const n = toNum(v, fallback);
  return Math.min(max, Math.max(min, n));
}

function validDate(v) {
  const s = cleanStr(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function validPhone(v) {
  const s = cleanStr(v, 20);
  return s === "" || /^[+\d][\d\s-]{5,19}$/.test(s);
}

function validEmail(v) {
  const s = cleanStr(v, 120);
  return s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ------------------------------ activity log ----------------------------- */

async function logActivity(db, { madrasaId = null, userId = null, action, entity = "", entityId = "", meta = null, ip = "" }) {
  try {
    await db.run(
      "INSERT INTO activity_log (madrasa_id, user_id, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?,?)",
      [madrasaId, userId, action, entity, entityId, meta ? JSON.stringify(meta) : null, ip]
    );
  } catch (e) {
    // Logging must never break the request.
  }
}

/* --------------------------- plan limit checks --------------------------- */

async function checkPlanLimits(db, madrasaId, kind) {
  // kind: "student" | "teacher"
  const row = await db.get(
    `SELECT p.student_limit, p.teacher_limit, p.code AS plan_code,
            (SELECT COUNT(*) FROM students WHERE madrasa_id = m.id AND status IN ('active','promoted','suspended')) AS students,
            (SELECT COUNT(*) FROM users u WHERE u.madrasa_id = m.id AND u.role = 'teacher' AND u.is_active = 1) AS teachers
     FROM madaris m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id = ?`,
    [madrasaId]
  );
  if (!row) return { allowed: true };
  const limit = kind === "student" ? Number(row.student_limit) : Number(row.teacher_limit);
  const count = kind === "student" ? Number(row.students) : Number(row.teachers);
  if (limit < 0) return { allowed: true }; // unlimited
  return {
    allowed: count < limit,
    limit,
    count,
    plan: row.plan_code,
    message: `Plan limit reached: your ${row.plan_code} plan allows ${limit} ${kind}(s) (currently ${count}). Contact the platform to upgrade.`,
  };
}

module.exports = {
  asyncHandler,
  err,
  ok,
  cleanStr,
  isBlank,
  toNum,
  clampNum,
  validDate,
  validPhone,
  validEmail,
  logActivity,
  checkPlanLimits,
};
