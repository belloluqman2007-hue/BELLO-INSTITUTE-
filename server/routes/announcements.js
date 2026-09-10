"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Announcements routes
   ----------------------------------------------------------------------------
   madrasa_admin creates/edits; students & parents read (by audience).
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

function audienceForRole(role) {
  if (role === "student") return "students";
  if (role === "parent") return "parents";
  return null; // admins see all
}

router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const limit = Math.min(200, toNum(req.query.limit, 50));
  let rows;
  const aud = audienceForRole(req.user.role);
  if (aud) {
    rows = await db.all(
      "SELECT * FROM announcements WHERE madrasa_id = ? AND is_active = 1 AND (audience = 'all' OR audience = ?) ORDER BY created_at DESC, id DESC LIMIT ?",
      [tid, aud, limit]
    );
  } else {
    rows = await db.all("SELECT * FROM announcements WHERE madrasa_id = ? ORDER BY created_at DESC, id DESC LIMIT ?", [tid, limit]);
  }
  ok(res, { announcements: rows });
}));

router.post("/", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const title = cleanStr(b.title, 200);
  const body = cleanStr(b.body, 5000);
  if (!title || !body) return err(res, 400, "title and body are required.");
  const audience = ["all", "students", "parents"].includes(b.audience) ? b.audience : "all";
  const publishPublic = b.publish_public ? 1 : 0;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(String(b.publish_until || "")) ? String(b.publish_until) : null;
  const r = await db.run(
    "INSERT INTO announcements (madrasa_id, title, body, audience, is_active, created_by, publish_public, publish_until) VALUES (?,?,?,?,1,?,?,?)",
    [tid, title, body, audience, req.user.id, publishPublic, until]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "announcement.create", entity: "announcement", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.patch("/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const a = await db.get("SELECT * FROM announcements WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!a) return res.status(404).json({ error: "Announcement not found." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.title !== undefined) { sets.push("title = ?"); vals.push(cleanStr(b.title, 200)); }
  if (b.body !== undefined) { sets.push("body = ?"); vals.push(cleanStr(b.body, 5000)); }
  if (b.audience !== undefined && ["all", "students", "parents"].includes(b.audience)) { sets.push("audience = ?"); vals.push(b.audience); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
  if (b.publish_public !== undefined) { sets.push("publish_public = ?"); vals.push(b.publish_public ? 1 : 0); }
  if (b.publish_until !== undefined) {
    sets.push("publish_until = ?");
    vals.push(/^\d{4}-\d{2}-\d{2}$/.test(String(b.publish_until || "")) ? String(b.publish_until) : null);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(a.id);
  await db.run(`UPDATE announcements SET ${sets.join(", ")} WHERE id = ?`, vals);
  ok(res, { ok: true });
}));

router.delete("/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const a = await db.get("SELECT * FROM announcements WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!a) return res.status(404).json({ error: "Announcement not found." });
  await db.run("UPDATE announcements SET is_active = 0 WHERE id = ?", [a.id]);
  ok(res, { ok: true });
}));

module.exports = router;
