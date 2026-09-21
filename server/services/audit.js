"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — institution audit trail
   ----------------------------------------------------------------------------
   This is NOT a second log. It writes to the existing activity_log table that
   every module already uses through util.logActivity, and simply records the
   extra context the Admin Audit Log interface needs (module, user role, the
   previous and new values of the record that changed).

   Rules:
     • the tenant, user and role always come from the authenticated request —
       never from the request body,
     • sensitive fields (passwords, hashes, tokens, secrets, keys) are
       stripped from both the "before" and "after" snapshots before writing,
     • logging must never break the request it is describing.
   ========================================================================== */
const db = require("../db");

/** Field names that must never reach the audit log, at any nesting depth. */
const SENSITIVE = [
  "password", "password_hash", "passwordhash", "new_password", "current_password",
  "confirm_password", "token", "csrf", "secret", "api_key", "apikey", "secret_key",
  "access_token", "refresh_token", "private_key", "session", "cookie", "authorization",
  "signature", "otp", "pin",
];

function isSensitiveKey(key) {
  const k = String(key || "").toLowerCase().replace(/[^a-z_]/g, "");
  return SENSITIVE.some((s) => k === s || k.includes(s));
}

/**
 * Returns a shallow-cloned, redacted copy of a record. Nested objects are
 * redacted recursively; anything that is not a plain object is returned as-is.
 */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue; // dropped entirely, not even "[redacted]"
    out[key] = (v && typeof v === "object") ? redact(v, depth + 1) : v;
  }
  return out;
}

/** Serialises a redacted snapshot, guarding against oversized payloads. */
function snapshot(value) {
  if (value === null || value === undefined) return null;
  try {
    const json = JSON.stringify(redact(value));
    if (!json) return null;
    return json.length > 8000 ? json.slice(0, 7990) + '..."}' : json;
  } catch (e) {
    return null;
  }
}

/**
 * Best-effort client IP. Express already computes req.ip from the configured
 * trust-proxy setting, so no header is trusted directly here.
 */
function clientIp(req) {
  return String((req && req.ip) || "").slice(0, 64);
}

/**
 * Records an audit entry.
 *
 * @param {object} req      the authenticated Express request (source of truth
 *                          for tenant, user and role)
 * @param {object} entry
 *   @param {string} entry.action  e.g. "student.create"
 *   @param {string} entry.module  e.g. "students"
 *   @param {string} [entry.entity]    record type, e.g. "student"
 *   @param {string|number} [entry.entityId]
 *   @param {object} [entry.before]    previous value (redacted before writing)
 *   @param {object} [entry.after]     new value (redacted before writing)
 *   @param {object} [entry.meta]      extra context (redacted before writing)
 *   @param {number} [entry.madrasaId] override, only for super-admin support
 *                                     actions against a named institution
 */
async function record(req, entry = {}) {
  try {
    const user = (req && req.user) || {};
    const madrasaId = entry.madrasaId !== undefined ? entry.madrasaId : (user.madrasaId || null);
    await db.run(
      `INSERT INTO activity_log
         (madrasa_id, user_id, user_role, action, module, entity, entity_id,
          before_value, after_value, meta, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        madrasaId,
        user.id || null,
        String(user.role || "").slice(0, 30),
        String(entry.action || "").slice(0, 100),
        String(entry.module || "").slice(0, 40),
        String(entry.entity || "").slice(0, 60),
        String(entry.entityId === undefined || entry.entityId === null ? "" : entry.entityId).slice(0, 80),
        snapshot(entry.before),
        snapshot(entry.after),
        snapshot(entry.meta),
        clientIp(req),
      ]
    );
  } catch (e) {
    // Never let the audit trail break the action it is describing.
  }
}

/**
 * Reads the audit log for one institution with search, filters and pagination.
 * The tenant is supplied by the caller from the authenticated context.
 */
async function search(madrasaId, opts = {}) {
  const where = [];
  const params = [];
  if (madrasaId) { where.push("a.madrasa_id = ?"); params.push(madrasaId); }
  if (opts.module) { where.push("a.module = ?"); params.push(String(opts.module).slice(0, 40)); }
  if (opts.action) { where.push("a.action = ?"); params.push(String(opts.action).slice(0, 100)); }
  if (opts.userId) { where.push("a.user_id = ?"); params.push(Number(opts.userId)); }
  if (opts.entity) { where.push("a.entity = ?"); params.push(String(opts.entity).slice(0, 60)); }
  if (opts.from) { where.push("a.created_at >= ?"); params.push(String(opts.from).slice(0, 10) + " 00:00:00"); }
  if (opts.to) { where.push("a.created_at <= ?"); params.push(String(opts.to).slice(0, 10) + " 23:59:59"); }
  if (opts.search) {
    const q = `%${String(opts.search).toLowerCase().slice(0, 100)}%`;
    where.push("(LOWER(a.action) LIKE ? OR LOWER(a.entity) LIKE ? OR LOWER(a.entity_id) LIKE ? OR LOWER(COALESCE(u.full_name,'')) LIKE ? OR LOWER(COALESCE(u.username,'')) LIKE ?)");
    params.push(q, q, q, q, q);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const page = Math.max(1, Number(opts.page) || 1);
  const offset = (page - 1) * limit;

  const totalRow = await db.get(
    `SELECT COUNT(*) AS n FROM activity_log a LEFT JOIN users u ON u.id = a.user_id ${clause}`,
    params
  );
  const rows = await db.all(
    `SELECT a.id, a.madrasa_id, a.user_id, a.user_role, a.action, a.module, a.entity,
            a.entity_id, a.before_value, a.after_value, a.meta, a.ip, a.created_at,
            u.full_name AS user_name, u.username
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${clause}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    params.concat([limit, offset])
  );
  const total = Number((totalRow && totalRow.n) || 0);
  return { entries: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Distinct modules/actions present for one tenant — drives the filter menus. */
async function facets(madrasaId) {
  const scope = madrasaId ? "WHERE madrasa_id = ?" : "";
  const params = madrasaId ? [madrasaId] : [];
  const [modules, actions, users] = await Promise.all([
    db.all(`SELECT DISTINCT module FROM activity_log ${scope} ${scope ? "AND" : "WHERE"} module <> '' ORDER BY module`, params),
    db.all(`SELECT DISTINCT action FROM activity_log ${scope} ORDER BY action LIMIT 200`, params),
    db.all(
      `SELECT DISTINCT a.user_id, u.full_name, u.username
         FROM activity_log a JOIN users u ON u.id = a.user_id
         ${madrasaId ? "WHERE a.madrasa_id = ?" : ""}
        ORDER BY u.full_name LIMIT 200`,
      params
    ),
  ]);
  return {
    modules: modules.map((r) => r.module),
    actions: actions.map((r) => r.action),
    users: users.map((r) => ({ id: r.user_id, name: r.full_name || r.username })),
  };
}

module.exports = { record, search, facets, redact, snapshot, isSensitiveKey };
