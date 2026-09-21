"use strict";
/* Tenant-scoped communication delivery helpers.
 *
 * This service only ever receives a tenant id resolved by a route. It resolves
 * audience membership from the existing users, students, parent_links and
 * student group tables; it never creates duplicate accounts or relationships.
 */
const db = require("../db");
const { cleanStr, toNum } = require("../util");
const delivery = require("./delivery");

/* Event types that may leave the dashboard through an external provider. The
 * in-app notification is ALWAYS created first and is never conditional on a
 * provider being configured. */
const DELIVERABLE_TYPES = new Set(["fee_reminder", "payment_received", "announcement", "result_published", "admission_decision", "ptm_booking"]);

const STAFF_ROLES = ["madrasa_admin", "teacher"];
const RECIPIENT_ROLES = ["madrasa_admin", "teacher", "student", "parent"];

function asIds(value) {
  if (Array.isArray(value)) return value.map((x) => toNum(x, 0)).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").map((x) => toNum(x.trim(), 0)).filter(Boolean);
}

async function activeUsers(madrasaId, where = "", params = []) {
  return db.all(
    `SELECT id, role, student_id FROM users WHERE madrasa_id = ? AND is_active = 1 AND role IN ('madrasa_admin','teacher','student','parent') ${where}`,
    [madrasaId].concat(params)
  );
}

async function audienceUserIds(madrasaId, target = {}) {
  const type = String(target.target_type || target.type || target.audience || "all").toLowerCase();
  const ids = asIds(target.target_ids || target.ids || target.user_ids);
  let users = [];

  if (["individual", "individual_users", "users"].includes(type)) {
    if (!ids.length) return [];
    users = await activeUsers(madrasaId, `AND id IN (${ids.map(() => "?").join(",")})`, ids);
  } else if (["teachers", "teacher_group", "specific_teacher_group"].includes(type)) {
    if (type === "teachers") users = await activeUsers(madrasaId, "AND role = 'teacher'");
    else users = await activeUsers(madrasaId, `AND role = 'teacher' AND id IN (${ids.map(() => "?").join(",") || "0"})`, ids);
  } else if (type === "parents") {
    users = await activeUsers(madrasaId, "AND role = 'parent'");
  } else if (type === "students") {
    users = await activeUsers(madrasaId, "AND role = 'student'");
  } else if (["islamic_section", "western_section", "section"].includes(type)) {
    const section = type === "section" ? String(target.section || "islamic").toLowerCase() : type.replace("_section", "");
    const studentRows = await db.all(
      `SELECT id FROM students WHERE madrasa_id = ? AND (LOWER(COALESCE(section,'')) = ? OR LOWER(COALESCE(education_track,'')) IN (?, 'both'))`,
      [madrasaId, section, section]
    );
    const studentIds = studentRows.map((r) => Number(r.id));
    if (!studentIds.length) return [];
    const marks = studentIds.map(() => "?").join(",");
    users = await activeUsers(madrasaId, `AND (role = 'student' AND student_id IN (${marks}) OR role = 'parent' AND id IN (SELECT pl.user_id FROM parent_links pl WHERE pl.madrasa_id = ? AND pl.student_id IN (${marks})))`, studentIds.concat([madrasaId], studentIds));
  } else if (["class", "specific_class"].includes(type)) {
    const classIds = ids.length ? ids : asIds(target.class_id);
    if (!classIds.length) return [];
    const marks = classIds.map(() => "?").join(",");
    const studentRows = await db.all(`SELECT id FROM students WHERE madrasa_id = ? AND class_id IN (${marks})`, [madrasaId].concat(classIds));
    const studentIds = studentRows.map((r) => Number(r.id));
    if (!studentIds.length) return [];
    const sm = studentIds.map(() => "?").join(",");
    users = await activeUsers(madrasaId, `AND ((role = 'student' AND student_id IN (${sm})) OR (role = 'parent' AND id IN (SELECT pl.user_id FROM parent_links pl WHERE pl.madrasa_id = ? AND pl.student_id IN (${sm}))))`, studentIds.concat([madrasaId], studentIds));
  } else if (["student_group", "specific_student_group"].includes(type)) {
    if (!ids.length) return [];
    const gm = ids.map(() => "?").join(",");
    const studentRows = await db.all(`SELECT student_id AS id FROM student_group_members WHERE madrasa_id = ? AND group_id IN (${gm})`, [madrasaId].concat(ids));
    const studentIds = studentRows.map((r) => Number(r.id));
    if (!studentIds.length) return [];
    const sm = studentIds.map(() => "?").join(",");
    users = await activeUsers(madrasaId, `AND ((role = 'student' AND student_id IN (${sm})) OR (role = 'parent' AND id IN (SELECT pl.user_id FROM parent_links pl WHERE pl.madrasa_id = ? AND pl.student_id IN (${sm}))))`, studentIds.concat([madrasaId], studentIds));
  } else {
    // Entire institution means every active member, including staff, students
    // and parents who already belong to this tenant.
    users = await activeUsers(madrasaId);
  }
  return [...new Set(users.map((u) => Number(u.id)))];
}

async function createNotifications(madrasaId, userIds, payload = {}) {
  const ids = [...new Set(asIds(userIds))];
  if (!ids.length) return [];
  const title = cleanStr(payload.title, 200);
  const body = cleanStr(payload.body, 5000);
  if (!title || !body) return [];
  // Validate all recipients in ONE batched query (was one SELECT per user —
  // an N+1 that made a whole-tenant announcement run thousands of queries).
  const valid = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const cm = chunk.map(() => "?").join(",");
    const rows = await db.all(`SELECT id FROM users WHERE madrasa_id = ? AND id IN (${cm}) AND is_active = 1`, [madrasaId].concat(chunk));
    for (const r of rows) valid.add(Number(r.id));
  }
  const recipients = ids.filter((id) => valid.has(Number(id)));
  if (!recipients.length) return [];
  const type = cleanStr(payload.type, 50) || "school_notice";
  const entityType = cleanStr(payload.entity_type, 50);
  const entityId = payload.entity_id ? toNum(payload.entity_id, 0) : null;
  const channel = cleanStr(payload.channel, 20) || "in_app";
  // Multi-row INSERT in chunks: one statement per 500 recipients instead of
  // one statement per recipient. Auto-increment ids of a multi-row insert are
  // one contiguous block on both SQLite and MySQL/InnoDB, so the returned ids
  // (callers echo them back) stay accurate.
  const out = [];
  const dialect = await db.dialect();
  for (let i = 0; i < recipients.length; i += 500) {
    const chunk = recipients.slice(i, i + 500);
    const values = chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",");
    const params = [];
    for (const userId of chunk) params.push(madrasaId, userId, type, title, body, entityType, entityId, channel);
    const r = await db.run(`INSERT INTO notifications (madrasa_id, recipient_user_id, type, title, body, entity_type, entity_id, channel) VALUES ${values}`, params);
    const reported = Number(r.lastInsertRowid);
    const affected = Number(r.changes || chunk.length);
    // A multi-row INSERT allocates ONE contiguous id block on both drivers,
    // but they report different ends of it: SQLite → LAST rowid, MySQL → FIRST.
    // Callers only echo these ids back, and 0 means "not reconstructed".
    if (reported > 0 && affected === chunk.length) {
      const firstId = dialect === "mysql" ? reported : reported - chunk.length + 1;
      for (let k = 0; k < chunk.length; k++) out.push(firstId + k);
    } else {
      for (let k = 0; k < chunk.length; k++) out.push(0);
    }
  }
  // The in-app notification above is the source of truth; external delivery
  // is best-effort and can never fail this loop.
  for (const userId of recipients) {
    await dispatchExternal(madrasaId, userId, { type: payload.type, title, body, student_id: payload.student_id || null, sent_by: payload.sent_by || null });
  }
  return out;
}

/* Historic type names already written by existing routes, mapped onto the
 * deliverable event list so no caller has to change its payload. */
const TYPE_ALIASES = { admission_update: "admission_decision", payment_confirmation: "payment_received", school_notice: "announcement" };
function deliverableType(type) {
  const t = String(type || "").toLowerCase();
  const canonical = TYPE_ALIASES[t] || t;
  return DELIVERABLE_TYPES.has(canonical) ? canonical : "";
}

/** Preference row for a user: the exact type wins, otherwise the "*" default. */
async function preferencesFor(madrasaId, userId, type) {
  const rows = await db.all(
    "SELECT * FROM notification_preferences WHERE madrasa_id = ? AND user_id = ? AND notification_type IN (?, '*')",
    [madrasaId, userId, type]
  );
  return rows.find((r) => r.notification_type === type) || rows.find((r) => r.notification_type === "*") || null;
}

/**
 * Fan an already-created in-app notification out to the recipient's chosen
 * external channels. Never throws and never blocks the in-app notification:
 * a failure is recorded in communication_history with status "failed".
 */
async function dispatchExternal(madrasaId, userId, payload = {}) {
  const results = [];
  try {
    const type = deliverableType(payload.type);
    if (!type) return results;
    const prefs = await preferencesFor(madrasaId, userId, type);
    if (!prefs) return results;
    const user = await db.get("SELECT id, full_name, email, phone FROM users WHERE id = ? AND madrasa_id = ? AND is_active = 1", [userId, madrasaId]);
    if (!user) return results;

    const subject = cleanStr(payload.title, 200) || "School notification";
    const message = cleanStr(payload.body, 5000);
    const wanted = [];
    if (Number(prefs.email) === 1 && delivery.validEmail(user.email)) wanted.push(["email", delivery.validEmail(user.email)]);
    if (Number(prefs.sms) === 1 && delivery.normalisePhone(user.phone)) wanted.push(["sms", delivery.normalisePhone(user.phone)]);
    if (Number(prefs.whatsapp) === 1 && delivery.normalisePhone(user.phone)) wanted.push(["whatsapp", delivery.normalisePhone(user.phone)]);

    for (const [channel, address] of wanted) {
      const r = await delivery.send(channel, address, { subject, message });
      if (r.skipped) continue; // provider "none" — graceful no-op, nothing logged as failed
      results.push({ channel, address, result: r });
      await recordCommunication(madrasaId, {
        recipient_user_id: userId,
        parent_user_id: payload.parent_user_id || null,
        student_id: payload.student_id || null,
        channel,
        message_type: type,
        subject,
        message,
        delivery_status: r.ok ? "sent" : "failed",
        error_message: r.error,
        provider: r.provider,
        provider_message_id: r.messageId,
        recipient_address: address,
        sent_by: payload.sent_by || null,
      });
    }
  } catch (e) {
    console.error("[communication] external dispatch failed:", e.message);
  }
  return results;
}

async function notifyAudience(madrasaId, target, payload) {
  return createNotifications(madrasaId, await audienceUserIds(madrasaId, target), payload);
}

async function recordCommunication(madrasaId, payload = {}) {
  const studentId = payload.student_id ? toNum(payload.student_id, 0) : null;
  const recipientId = payload.recipient_user_id ? toNum(payload.recipient_user_id, 0) : null;
  const parentId = payload.parent_user_id ? toNum(payload.parent_user_id, 0) : null;
  const r = await db.run(
    `INSERT INTO communication_history
      (madrasa_id, student_id, recipient_user_id, parent_user_id, channel, message_type, subject, message, delivery_status, sent_by,
       error_message, provider, provider_message_id, recipient_address)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [madrasaId, studentId || null, recipientId || null, parentId || null, cleanStr(payload.channel, 20) || "in_app", cleanStr(payload.message_type, 50) || "notice", cleanStr(payload.subject, 200), cleanStr(payload.message, 5000), cleanStr(payload.delivery_status, 20) || "recorded", payload.sent_by ? toNum(payload.sent_by, 0) : null,
     cleanStr(payload.error_message, 500), cleanStr(payload.provider, 30), cleanStr(payload.provider_message_id, 160), cleanStr(payload.recipient_address, 255)]
  );
  return Number(r.lastInsertRowid);
}

module.exports = { STAFF_ROLES, RECIPIENT_ROLES, DELIVERABLE_TYPES, asIds, audienceUserIds, createNotifications, notifyAudience, recordCommunication, dispatchExternal, preferencesFor, deliverableType };
