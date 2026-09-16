"use strict";
/* Tenant-scoped communication delivery helpers.
 *
 * This service only ever receives a tenant id resolved by a route. It resolves
 * audience membership from the existing users, students, parent_links and
 * student group tables; it never creates duplicate accounts or relationships.
 */
const db = require("../db");
const { cleanStr, toNum } = require("../util");

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
  const out = [];
  for (const userId of ids) {
    const u = await db.get("SELECT id FROM users WHERE id = ? AND madrasa_id = ? AND is_active = 1", [userId, madrasaId]);
    if (!u) continue;
    const r = await db.run(
      "INSERT INTO notifications (madrasa_id, recipient_user_id, type, title, body, entity_type, entity_id, channel) VALUES (?,?,?,?,?,?,?,?)",
      [madrasaId, userId, cleanStr(payload.type, 50) || "school_notice", title, body, cleanStr(payload.entity_type, 50), payload.entity_id ? toNum(payload.entity_id, 0) : null, cleanStr(payload.channel, 20) || "in_app"]
    );
    out.push(Number(r.lastInsertRowid));
  }
  return out;
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
      (madrasa_id, student_id, recipient_user_id, parent_user_id, channel, message_type, subject, message, delivery_status, sent_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [madrasaId, studentId || null, recipientId || null, parentId || null, cleanStr(payload.channel, 20) || "in_app", cleanStr(payload.message_type, 50) || "notice", cleanStr(payload.subject, 200), cleanStr(payload.message, 5000), cleanStr(payload.delivery_status, 20) || "recorded", payload.sent_by ? toNum(payload.sent_by, 0) : null]
  );
  return Number(r.lastInsertRowid);
}

module.exports = { STAFF_ROLES, RECIPIENT_ROLES, asIds, audienceUserIds, createNotifications, notifyAudience, recordCommunication };
