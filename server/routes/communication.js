"use strict";
/* Communication workspace: private messages, notification centre and the
 * existing parent/guardian directory. All joins include madrasa_id. */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const comm = require("../services/communication");
const { fileUploader } = require("../middleware/upload");
const messageAttachment = fileUploader("message-attachments", "attachment", { extensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".webp"], maxMb: 15 });

const router = express.Router();
router.use(requireAuth, requireTenant);
const STAFF = requireRole("madrasa_admin", "teacher");
const ADMIN = requireRole("madrasa_admin");

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}
function ids(v) { return comm.asIds(v); }

async function userInTenant(tid, id) {
  return db.get("SELECT id, role, full_name, username, email, phone, student_id FROM users WHERE id = ? AND madrasa_id = ? AND is_active = 1", [id, tid]);
}

/* ---------------------------- private messages ------------------------- */
router.get("/messages", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const q = cleanStr(req.query.search, 120).toLowerCase();
  const folder = cleanStr(req.query.folder, 20).toLowerCase() || "inbox";
  const params = [tid, req.user.id];
  let where = folder === "sent"
    ? "m.madrasa_id = ? AND m.user_id = ? AND m.message_type = 'direct'"
    : "m.madrasa_id = ? AND m.recipient_user_id = ? AND m.message_type = 'direct'";
  if (folder === "all") { where = "m.madrasa_id = ? AND (m.user_id = ? OR m.recipient_user_id = ?)"; params.push(req.user.id); }
  if (q) { where += " AND (LOWER(m.body) LIKE ? OR LOWER(COALESCE(c.subject,'')) LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  const rows = await db.all(
    `SELECT m.id, m.conversation_id, m.user_id, m.recipient_user_id, m.body, m.created_at, m.read_at,
            m.attachment_path, m.attachment_name, c.subject,
            sender.full_name AS sender_name, recipient.full_name AS recipient_name
       FROM messages m
       LEFT JOIN communication_conversations c ON c.id = m.conversation_id AND c.madrasa_id = m.madrasa_id
       LEFT JOIN users sender ON sender.id = m.user_id AND sender.madrasa_id = m.madrasa_id
       LEFT JOIN users recipient ON recipient.id = m.recipient_user_id AND recipient.madrasa_id = m.madrasa_id
      WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT 300`, params
  );
  ok(res, { messages: rows });
}));

router.get("/conversations", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const rows = await db.all(
    `SELECT c.id, c.subject, c.kind, c.status, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM communication_participants p WHERE p.madrasa_id = c.madrasa_id AND p.conversation_id = c.id) AS participant_count,
            (SELECT COUNT(*) FROM messages m WHERE m.madrasa_id = c.madrasa_id AND m.conversation_id = c.id AND m.recipient_user_id = ? AND m.read_at IS NULL) AS unread_count,
            (SELECT m.body FROM messages m WHERE m.madrasa_id = c.madrasa_id AND m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM communication_conversations c
       JOIN communication_participants me ON me.conversation_id = c.id AND me.madrasa_id = c.madrasa_id AND me.user_id = ?
      WHERE c.madrasa_id = ? AND c.status <> 'deleted' AND me.archived_at IS NULL
      ORDER BY c.updated_at DESC, c.id DESC`, [req.user.id, req.user.id, tid]
  );
  ok(res, { conversations: rows });
}));

router.get("/conversations/:id", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const allowed = await db.get("SELECT id FROM communication_participants WHERE madrasa_id = ? AND conversation_id = ? AND user_id = ? AND archived_at IS NULL", [tid, id, req.user.id]);
  if (!allowed) return res.status(404).json({ error: "Conversation not found." });
  const conversation = await db.get("SELECT * FROM communication_conversations WHERE id = ? AND madrasa_id = ?", [id, tid]);
  const participants = await db.all("SELECT p.user_id, p.participant_role, u.full_name, u.username, u.role FROM communication_participants p JOIN users u ON u.id = p.user_id AND u.madrasa_id = p.madrasa_id WHERE p.madrasa_id = ? AND p.conversation_id = ?", [tid, id]);
  const messages = await db.all("SELECT m.*, u.full_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.user_id AND u.madrasa_id = m.madrasa_id WHERE m.madrasa_id = ? AND m.conversation_id = ? ORDER BY m.id", [tid, id]);
  await db.run("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE madrasa_id = ? AND conversation_id = ? AND recipient_user_id = ? AND read_at IS NULL", [tid, id, req.user.id]);
  await db.run("UPDATE communication_participants SET last_read_at = CURRENT_TIMESTAMP WHERE madrasa_id = ? AND conversation_id = ? AND user_id = ?", [tid, id, req.user.id]);
  ok(res, { conversation, participants, messages });
}));

router.post("/messages", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {};
  const recipientIds = [...new Set(ids(b.recipient_user_ids ?? b.recipient_ids ?? b.recipient_user_id))].filter((id) => id !== Number(req.user.id));
  if (!recipientIds.length) return err(res, 400, "At least one recipient is required.");
  const recipients = [];
  for (const id of recipientIds) { const u = await userInTenant(tid, id); if (!u) return err(res, 400, "One or more recipients are not available in this institution."); if (!comm.RECIPIENT_ROLES.includes(u.role)) return err(res, 400, "That user cannot receive internal messages."); recipients.push(u); }
  const body = cleanStr(b.body ?? b.content, 10000); if (!body) return err(res, 400, "Message body is required.");
  const kind = recipientIds.length > 1 ? "group" : "individual";
  const result = await db.transaction(async (tx) => {
    const c = await tx.run("INSERT INTO communication_conversations (madrasa_id, subject, kind, created_by) VALUES (?,?,?,?)", [tid, cleanStr(b.subject, 200), kind, req.user.id]);
    const conversationId = Number(c.lastInsertRowid);
    const everyone = [Number(req.user.id)].concat(recipientIds);
    for (const userId of [...new Set(everyone)]) {
      const user = userId === Number(req.user.id) ? req.user : recipients.find((x) => Number(x.id) === userId);
      await tx.run("INSERT INTO communication_participants (madrasa_id, conversation_id, user_id, participant_role) VALUES (?,?,?,?)", [tid, conversationId, userId, user.role || ""]);
    }
    const idsOut = [];
    for (const recipientId of recipientIds) {
      const m = await tx.run(
        "INSERT INTO messages (madrasa_id, scope, user_id, author_name, body, conversation_id, recipient_user_id, message_type, attachment_path, attachment_name, attachment_mime) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [tid, "direct", req.user.id, cleanStr(req.user.fullName || req.user.username, 160), body, conversationId, recipientId, "direct", cleanStr(b.attachment_path, 500), cleanStr(b.attachment_name, 255), cleanStr(b.attachment_mime, 120)]
      );
      idsOut.push(Number(m.lastInsertRowid));
    }
    return { conversationId, messageIds: idsOut };
  });
  for (const recipient of recipients) {
    await comm.createNotifications(tid, [recipient.id], { type: "message", title: cleanStr(b.subject, 200) || "New message", body, entity_type: "conversation", entity_id: result.conversationId });
    await comm.recordCommunication(tid, { recipient_user_id: recipient.id, parent_user_id: recipient.role === "parent" ? recipient.id : null, channel: "in_app", message_type: "message", subject: cleanStr(b.subject, 200), message: body, sent_by: req.user.id });
  }
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "communication.message.send", entity: "conversation", entityId: String(result.conversationId), ip: req.ip });
  ok(res, Object.assign({ ok: true }, result));
}));

router.post("/messages/:id/attachment", messageAttachment, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const message = await db.get("SELECT id, conversation_id FROM messages WHERE id = ? AND madrasa_id = ? AND (user_id = ? OR recipient_user_id = ?)", [id, tid, req.user.id, req.user.id]);
  if (!message) return res.status(404).json({ error: "Message not found." });
  if (!req.file) return err(res, 400, "Attachment is required.");
  const path = `/uploads/message-attachments/${req.file.filename}`;
  await db.run("UPDATE messages SET attachment_path = ?, attachment_name = ?, attachment_mime = ? WHERE id = ? AND madrasa_id = ?", [path, cleanStr(req.file.originalname, 255), cleanStr(req.file.mimetype, 120), id, tid]);
  ok(res, { ok: true, attachment_path: path, attachment_name: cleanStr(req.file.originalname, 255), attachment_mime: req.file.mimetype });
}));

router.patch("/conversations/:id/archive", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const p = await db.get("SELECT id FROM communication_participants WHERE madrasa_id = ? AND conversation_id = ? AND user_id = ?", [tid, id, req.user.id]);
  if (!p) return res.status(404).json({ error: "Conversation not found." });
  await db.run("UPDATE communication_participants SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ?", [p.id, tid]); ok(res, { ok: true });
}));

router.patch("/messages/:id/read", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const r = await db.run("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ? AND recipient_user_id = ?", [toNum(req.params.id, 0), tid, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: "Message not found." }); ok(res, { ok: true });
}));

/* ---------------------------- notification centre --------------------- */
router.get("/notifications", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const limit = Math.min(300, Math.max(1, toNum(req.query.limit, 100)));
  const rows = await db.all("SELECT * FROM notifications WHERE madrasa_id = ? AND recipient_user_id = ? ORDER BY id DESC LIMIT ?", [tid, req.user.id, limit]);
  const unread = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE madrasa_id = ? AND recipient_user_id = ? AND read_at IS NULL", [tid, req.user.id]);
  ok(res, { notifications: rows, unread: Number(unread.n || 0) });
}));
router.patch("/notifications/:id/read", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const r = await db.run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND madrasa_id = ? AND recipient_user_id = ?", [toNum(req.params.id, 0), tid, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: "Notification not found." }); ok(res, { ok: true });
}));
router.post("/notifications/read-all", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  await db.run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE madrasa_id = ? AND recipient_user_id = ? AND read_at IS NULL", [tid, req.user.id]); ok(res, { ok: true });
}));
router.get("/notification-preferences", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  ok(res, { preferences: await db.all("SELECT * FROM notification_preferences WHERE madrasa_id = ? AND user_id = ? ORDER BY notification_type", [tid, req.user.id]) });
}));
router.put("/notification-preferences", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; const type = cleanStr(b.notification_type || "*", 50);
  const values = [b.in_app === false || b.in_app === "0" ? 0 : 1, b.email ? 1 : 0, b.sms ? 1 : 0, b.whatsapp ? 1 : 0];
  const existing = await db.get("SELECT id FROM notification_preferences WHERE madrasa_id = ? AND user_id = ? AND notification_type = ?", [tid, req.user.id, type]);
  if (existing) await db.run("UPDATE notification_preferences SET in_app=?,email=?,sms=?,whatsapp=? WHERE id=? AND madrasa_id=?", values.concat([existing.id, tid]));
  else await db.run("INSERT INTO notification_preferences (madrasa_id,user_id,notification_type,in_app,email,sms,whatsapp) VALUES (?,?,?,?,?,?,?)", [tid, req.user.id, type].concat(values));
  ok(res, { ok: true });
}));

/* ---------------------------- parent communication --------------------- */
router.get("/parents", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const q = cleanStr(req.query.search, 120).toLowerCase();
  const where = ["u.madrasa_id = ?", "u.role = 'parent'", "u.is_active = 1"]; const params = [tid];
  if (q) { where.push("(LOWER(COALESCE(u.full_name,'')) LIKE ? OR LOWER(COALESCE(u.username,'')) LIKE ? OR LOWER(COALESCE(u.email,'')) LIKE ? OR LOWER(COALESCE(u.phone,'')) LIKE ?)"); const x = `%${q}%`; params.push(x,x,x,x); }
  const parents = await db.all(`SELECT u.id,u.username,u.full_name,u.email,u.phone,u.is_active FROM users u WHERE ${where.join(" AND ")} ORDER BY u.full_name`, params);
  for (const p of parents) {
    p.children = await db.all(`SELECT s.id,s.admission_no,s.first_name,s.last_name,s.class_id,c.name_en AS class_name FROM parent_links pl JOIN students s ON s.id=pl.student_id AND s.madrasa_id=pl.madrasa_id LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id WHERE pl.madrasa_id=? AND pl.user_id=? ORDER BY s.last_name,s.first_name`, [tid,p.id]);
  }
  ok(res, { parents });
}));
router.get("/parents/:id/history", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const parent = await userInTenant(tid, toNum(req.params.id, 0)); if (!parent || parent.role !== "parent") return res.status(404).json({ error: "Parent not found." });
  ok(res, { history: await db.all("SELECT * FROM communication_history WHERE madrasa_id = ? AND (recipient_user_id = ? OR parent_user_id = ?) ORDER BY id DESC LIMIT 300", [tid,parent.id,parent.id]) });
}));
router.post("/parents/send", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; let recipientIds = ids(b.parent_ids ?? b.recipient_ids ?? b.parent_id);
  if (b.class_id) {
    const rows = await db.all("SELECT DISTINCT pl.user_id FROM parent_links pl JOIN students s ON s.id=pl.student_id AND s.madrasa_id=pl.madrasa_id WHERE pl.madrasa_id=? AND s.class_id=?", [tid, toNum(b.class_id,0)]); recipientIds = recipientIds.concat(rows.map((r) => r.user_id));
  }
  if (b.student_id) {
    const rows = await db.all("SELECT user_id FROM parent_links WHERE madrasa_id=? AND student_id=?", [tid, toNum(b.student_id,0)]); recipientIds = recipientIds.concat(rows.map((r) => r.user_id));
  }
  recipientIds = [...new Set(recipientIds)];
  const validParents = [];
  for (const recipientId of recipientIds) { const parent = await userInTenant(tid, recipientId); if (parent && parent.role === "parent") validParents.push(parent.id); }
  recipientIds = [...new Set(validParents)]; if (!recipientIds.length) return err(res, 400, "Choose at least one parent, class or student.");
  const body = cleanStr(b.message ?? b.body, 10000); if (!body) return err(res, 400, "Message is required.");
  const notificationIds = await comm.createNotifications(tid, recipientIds, { type: cleanStr(b.message_type,50) || "parent_communication", title: cleanStr(b.subject,200) || "School message", body });
  for (const recipientId of recipientIds) {
    const child = b.student_id ? toNum(b.student_id,0) : null;
    await comm.recordCommunication(tid, { recipient_user_id: recipientId, parent_user_id: recipientId, student_id: child, channel: cleanStr(b.channel,20) || "in_app", message_type: cleanStr(b.message_type,50) || "parent_communication", subject: cleanStr(b.subject,200), message: body, sent_by: req.user.id });
  }
  ok(res, { ok: true, recipientIds, notificationIds });
}));
router.get("/history", STAFF, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const studentId = toNum(req.query.studentId,0); const parentId = toNum(req.query.parentId,0);
  const where = ["madrasa_id = ?"]; const params = [tid]; if (studentId) { where.push("student_id = ?"); params.push(studentId); } if (parentId) { where.push("(parent_user_id = ? OR recipient_user_id = ?)"); params.push(parentId,parentId); }
  ok(res, { history: await db.all(`SELECT * FROM communication_history WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 500`, params) });
}));

/* Friendly aliases used by integrations while the admin UI keeps the
 * Communication section as the only entry point. A root request is the
 * notification centre when this router is mounted at /api/notifications. */
router.get("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const rows = await db.all("SELECT * FROM notifications WHERE madrasa_id = ? AND recipient_user_id = ? ORDER BY id DESC LIMIT 100", [tid, req.user.id]);
  const unread = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE madrasa_id = ? AND recipient_user_id = ? AND read_at IS NULL", [tid, req.user.id]);
  ok(res, { notifications: rows, unread: Number(unread.n || 0) });
}));
module.exports = router;
