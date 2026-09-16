"use strict";
/* Canonical, tenant-scoped announcement management. The older /api/announcements
 * URL remains for compatibility; the admin sidebar exposes it only under
 * Communication, so there is one website/news management system. */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity, validDate } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const { imageUploader, fileUploader } = require("../middleware/upload");
const communication = require("../services/communication");
const announcementImage = imageUploader("announcement-images", "image");
const announcementFile = fileUploader("announcement-files", "attachment", { extensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".webp"], maxMb: 15 });

const router = express.Router();
router.use(requireAuth, requireTenant);
const ADMIN = requireRole("madrasa_admin");

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

const TARGETS = new Set(["all", "institution", "islamic_section", "western_section", "students", "teachers", "parents", "specific_class", "specific_student_group", "specific_teacher_group", "individual_users"]);
const STATUSES = new Set(["draft", "scheduled", "published", "archived"]);
function targetType(body) {
  const raw = cleanStr(body.target_type || body.audience, 40).toLowerCase();
  if (raw === "all") return "all";
  return TARGETS.has(raw) ? raw : "all";
}
function targetIds(body) {
  const source = body.target_ids ?? body.class_id ?? body.group_id ?? body.user_ids ?? [];
  const values = Array.isArray(source) ? source : String(source || "").split(",");
  return values.map((x) => toNum(x, 0)).filter(Boolean);
}
function requestedStatus(body, existing) {
  if (body.status !== undefined && STATUSES.has(String(body.status).toLowerCase())) return String(body.status).toLowerCase();
  if (body.is_active !== undefined) return body.is_active ? "published" : "archived";
  return existing || "published";
}
function scheduledDate(value) { return value ? validDate(value) : null; }

function visibleForRole(req) {
  if (req.user.role === "student") return "students";
  if (req.user.role === "parent") return "parents";
  if (req.user.role === "teacher") return "teachers";
  return null;
}

router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const audience = visibleForRole(req);
  const limit = Math.min(200, Math.max(1, toNum(req.query.limit, 100)));
  let rows;
  if (audience) {
    rows = await db.all(
      `SELECT a.*, u.full_name AS author_name
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by AND u.madrasa_id = a.madrasa_id
        WHERE a.madrasa_id = ? AND a.status = 'published' AND a.is_active = 1
          AND (a.scheduled_at IS NULL OR a.scheduled_at <= CURRENT_TIMESTAMP)
          AND (a.target_type IN ('all','institution',?) OR a.audience IN ('all',?))
        ORDER BY COALESCE(a.published_at,a.created_at) DESC, a.id DESC LIMIT ?`,
      [tid, audience, audience, limit]
    );
  } else {
    const where = ["a.madrasa_id = ?"];
    const params = [tid];
    const status = cleanStr(req.query.status, 20).toLowerCase();
    if (STATUSES.has(status)) { where.push("a.status = ?"); params.push(status); }
    if (req.query.search) { where.push("(LOWER(a.title) LIKE ? OR LOWER(a.body) LIKE ?)"); const q = `%${cleanStr(req.query.search, 100).toLowerCase()}%`; params.push(q, q); }
    rows = await db.all(
      `SELECT a.*, u.full_name AS author_name FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by AND u.madrasa_id = a.madrasa_id
       WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      params.concat([limit])
    );
  }
  ok(res, { announcements: rows });
}));

router.post("/", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {};
  const title = cleanStr(b.title, 200); const body = cleanStr(b.body ?? b.content, 10000);
  if (!title || !body) return err(res, 400, "title and body are required.");
  const target = targetType(b); const ids = targetIds(b);
  const status = requestedStatus(b, b.publish_at || b.scheduled_at ? "scheduled" : (b.status || "published"));
  const scheduledAt = b.scheduled_at || b.publish_at ? scheduledDate(b.scheduled_at || b.publish_at) : null;
  if ((status === "scheduled" || b.scheduled_at) && !scheduledAt) return err(res, 400, "scheduled_at must be YYYY-MM-DD.");
  const publishedAt = status === "published" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;
  const audience = ["all", "students", "parents"].includes(target) ? target : (target === "institution" ? "all" : target);
  const r = await db.run(
    `INSERT INTO announcements
      (madrasa_id,title,body,audience,is_active,created_by,publish_public,publish_until,status,scheduled_at,published_at,image_path,attachment_path,attachment_name,attachment_mime,target_type,target_ids,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [tid, title, body, audience, status === "published" ? 1 : 0, req.user.id, b.publish_public ? 1 : 0, validDate(b.publish_until), status, scheduledAt, publishedAt, cleanStr(b.image_path || b.image, 500), cleanStr(b.attachment_path || b.attachment, 500), cleanStr(b.attachment_name, 255), cleanStr(b.attachment_mime, 120), target, JSON.stringify(ids)]
  );
  const id = Number(r.lastInsertRowid);
  if (status === "published") await communication.notifyAudience(tid, { target_type: target, target_ids: ids }, { type: "announcement", title, body, entity_type: "announcement", entity_id: id });
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "announcement.create", entity: "announcement", entityId: String(id), ip: req.ip });
  ok(res, { ok: true, id, status });
}));

router.patch("/:id", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const current = await db.get("SELECT * FROM announcements WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!current) return res.status(404).json({ error: "Announcement not found." });
  const b = req.body || {}; const sets = []; const vals = [];
  if (b.title !== undefined) { sets.push("title = ?"); vals.push(cleanStr(b.title, 200)); }
  if (b.body !== undefined || b.content !== undefined) { sets.push("body = ?"); vals.push(cleanStr(b.body ?? b.content, 10000)); }
  if (b.target_type !== undefined || b.audience !== undefined || b.target_ids !== undefined || b.user_ids !== undefined) {
    const target = targetType(b); const ids = targetIds(b); sets.push("target_type = ?", "target_ids = ?", "audience = ?"); vals.push(target, JSON.stringify(ids), ["all","students","parents"].includes(target) ? target : (target === "institution" ? "all" : target));
  }
  if (b.publish_public !== undefined) { sets.push("publish_public = ?"); vals.push(b.publish_public ? 1 : 0); }
  if (b.publish_until !== undefined) { sets.push("publish_until = ?"); vals.push(validDate(b.publish_until)); }
  for (const [key, max] of [["image_path",500],["attachment_path",500],["attachment_name",255],["attachment_mime",120]]) if (b[key] !== undefined) { sets.push(`${key} = ?`); vals.push(cleanStr(b[key], max)); }
  if (b.scheduled_at !== undefined) { const date = scheduledDate(b.scheduled_at); if (b.scheduled_at && !date) return err(res, 400, "scheduled_at must be YYYY-MM-DD."); sets.push("scheduled_at = ?"); vals.push(date); }
  const next = requestedStatus(b, current.status || (current.is_active ? "published" : "archived"));
  if (b.status !== undefined || b.is_active !== undefined || next !== current.status) {
    sets.push("status = ?", "is_active = ?", "published_at = ?", "archived_at = ?"); vals.push(next, next === "published" ? 1 : 0, next === "published" ? (current.published_at || new Date().toISOString().slice(0,19).replace("T"," ")) : current.published_at, next === "archived" ? new Date().toISOString().slice(0,19).replace("T"," ") : null);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(id, tid); await db.run(`UPDATE announcements SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?`, vals);
  if (next === "published" && current.status !== "published") {
    const target = targetType(Object.assign({}, current, b)); const ids = targetIds(Object.assign({}, current, b));
    await communication.notifyAudience(tid, { target_type: target, target_ids: ids }, { type: "announcement", title: cleanStr(b.title || current.title, 200), body: cleanStr(b.body || current.body, 10000), entity_type: "announcement", entity_id: id });
  }
  ok(res, { ok: true, status: next });
}));

router.delete("/:id", ADMIN, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const a = await db.get("SELECT id FROM announcements WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!a) return res.status(404).json({ error: "Announcement not found." });
  await db.run("UPDATE announcements SET status = 'archived', is_active = 0, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [id, tid]);
  ok(res, { ok: true, archived: true });
}));

// Files are uploaded through the existing secure upload pipeline. The database
// stores only the generated public path and original display metadata.
router.post("/:id/image", ADMIN, announcementImage, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const row = await db.get("SELECT id FROM announcements WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!row || !req.file) return err(res, row ? 400 : 404, row ? "Image is required." : "Announcement not found.");
  const path = `/uploads/announcement-images/${req.file.filename}`;
  await db.run("UPDATE announcements SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [path, id, tid]);
  ok(res, { ok: true, image_path: path });
}));
router.post("/:id/attachment", ADMIN, announcementFile, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const row = await db.get("SELECT id FROM announcements WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!row || !req.file) return err(res, row ? 400 : 404, row ? "Attachment is required." : "Announcement not found.");
  const path = `/uploads/announcement-files/${req.file.filename}`;
  await db.run("UPDATE announcements SET attachment_path = ?, attachment_name = ?, attachment_mime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [path, cleanStr(req.file.originalname, 255), cleanStr(req.file.mimetype, 120), id, tid]);
  ok(res, { ok: true, attachment_path: path, attachment_name: cleanStr(req.file.originalname, 255), attachment_mime: req.file.mimetype });
}));

module.exports = router;
