"use strict";
/* ============================================================================
   Academic calendar & school events
   ----------------------------------------------------------------------------
   Sessions and terms already exist (academic_sessions / terms); this module
   adds the events that live INSIDE them: holidays, exam weeks, PTM dates,
   admission deadlines, result publication and school activities.

   Every row is tenant-owned. Audience targeting decides who sees an event:
     all                — everyone in the institution
     teachers | staff   — teaching and administrative staff
     students           — students and their parents (family events)
     parents            — parents only
     specific_classes   — students of the listed classes and their parents,
                          plus staff
   Students and parents can only ever read published events that target them;
   creating and editing is permission-gated (calendar.manage) and audited.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const { requireStaffPermission, requirePermission } = require("../services/permissions");

const router = express.Router();
router.use(requireAuth, requireTenant);

const EVENT_TYPES = new Set(["term", "holiday", "exam", "ptm", "admission_deadline", "results_publication", "activity", "other"]);
const AUDIENCES = new Set(["all", "teachers", "staff", "students", "parents", "specific_classes"]);
const STATUSES = new Set(["draft", "published", "archived"]);
const STAFF_ROLES = new Set(["madrasa_admin", "teacher", "super_admin"]);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

function timeOrEmpty(value) {
  const v = cleanStr(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "";
}

function targetIds(body) {
  const source = body.target_ids ?? body.class_ids ?? [];
  const values = Array.isArray(source) ? source : String(source || "").split(",");
  return values.map((x) => toNum(x, 0)).filter(Boolean);
}

function parseTargetIds(row) {
  try { return JSON.parse(row || "[]").map(Number); } catch (e) { return []; }
}

/* ------------------------------ validation ------------------------------ */

async function eventInput(tid, body, current = {}) {
  const b = body || {};
  const title = cleanStr(b.title !== undefined ? b.title : current.title, 200);
  if (!title) return { error: "Title is required." };
  const rawStart = b.start_date !== undefined ? b.start_date : current.start_date;
  const startDate = validDate(rawStart);
  if (!startDate) return { error: "A valid start date (YYYY-MM-DD) is required." };
  const rawEnd = b.end_date !== undefined ? b.end_date : current.end_date;
  const endDate = rawEnd ? validDate(rawEnd) : null;
  if (rawEnd && !endDate) return { error: "End date must use YYYY-MM-DD." };
  if (endDate && endDate < startDate) return { error: "End date cannot precede the start date." };
  const type = EVENT_TYPES.has(cleanStr(b.event_type !== undefined ? b.event_type : current.event_type, 40)) ? cleanStr(b.event_type !== undefined ? b.event_type : current.event_type, 40) : "activity";
  const audienceRaw = cleanStr(b.audience !== undefined ? b.audience : current.audience, 30);
  const audience = AUDIENCES.has(audienceRaw) ? audienceRaw : "all";
  const status = STATUSES.has(cleanStr(b.status !== undefined ? b.status : current.status, 20)) ? cleanStr(b.status !== undefined ? b.status : current.status, 20) : "published";
  let classes = b.target_ids !== undefined || b.class_ids !== undefined ? targetIds(b) : parseTargetIds(current.target_ids);
  if (audience !== "specific_classes") classes = [];
  if (audience === "specific_classes" && classes.length) {
    for (const classId of classes) {
      if (!await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid])) return { error: "Unknown class in the target list." };
    }
  }
  return {
    title, startDate, endDate, type, audience, classes, status,
    description: cleanStr(b.description !== undefined ? b.description : current.description, 5000),
    location: cleanStr(b.location !== undefined ? b.location : current.location, 160),
    startTime: b.start_time !== undefined ? timeOrEmpty(b.start_time) : timeOrEmpty(current.start_time),
    endTime: b.end_time !== undefined ? timeOrEmpty(b.end_time) : timeOrEmpty(current.end_time),
  };
}

/* ---------------------------- audience filter ---------------------------- */

/** Resolves the audience filter for the signed-in user against one event row. */
function eventVisibleToUser(event, user, studentRows) {
  if (STAFF_ROLES.has(user.role)) return true;
  const audience = event.audience || "all";
  if (audience === "all" || audience === "institution") return true;
  if (user.role === "student") {
    if (audience === "students") return true;
    if (audience === "parents" || audience === "teachers" || audience === "staff") return false;
  } else if (user.role === "parent") {
    if (audience === "students" || audience === "parents") return true;
    if (audience === "teachers" || audience === "staff") return false;
  } else return false;
  if (audience === "specific_classes") {
    const classes = parseTargetIds(event.target_ids);
    return studentRows.some((s) => s.class_id && classes.includes(Number(s.class_id)));
  }
  return false;
}

/** The student rows this user may act for (own record / linked children). */
async function studentsOfUser(req, tid) {
  if (req.user.role === "student") {
    if (!req.user.studentId) return [];
    const row = await db.get("SELECT id, class_id FROM students WHERE id = ? AND madrasa_id = ?", [req.user.studentId, tid]);
    return row ? [row] : [];
  }
  if (req.user.role === "parent") {
    return db.all(
      `SELECT s.id, s.class_id FROM students s
       JOIN parent_links pl ON pl.student_id = s.id AND pl.madrasa_id = s.madrasa_id
       WHERE pl.madrasa_id = ? AND pl.user_id = ?`,
      [tid, req.user.id]
    );
  }
  return [];
}

/* -------------------------------- routes --------------------------------- */

/**
 * GET /api/calendar?from=&to=&type=&status=&limit=
 * Staff (calendar.view) see the whole calendar; students and parents see the
 * published events that target them.
 */
router.get("/", requireStaffPermission("calendar.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const where = ["madrasa_id = ?"]; const params = [tid];
  const isStaff = STAFF_ROLES.has(req.user.role);
  if (isStaff && req.query.status && STATUSES.has(cleanStr(req.query.status, 20))) {
    where.push("status = ?"); params.push(cleanStr(req.query.status, 20));
  } else if (!isStaff || !req.query.status) {
    // Portals (and the default staff view) only ever see published events.
    where.push("status = 'published'");
  }
  if (req.query.type && EVENT_TYPES.has(cleanStr(req.query.type, 40))) { where.push("event_type = ?"); params.push(cleanStr(req.query.type, 40)); }
  const from = validDate(req.query.from);
  if (from) { where.push("COALESCE(end_date, start_date) >= ?"); params.push(from); }
  const to = validDate(req.query.to);
  if (to) { where.push("start_date <= ?"); params.push(to); }
  const limit = Math.min(500, Math.max(1, toNum(req.query.limit, 200)));
  const rows = await db.all(
    `SELECT * FROM calendar_events WHERE ${where.join(" AND ")} ORDER BY start_date, start_time, id LIMIT ?`,
    params.concat([limit])
  );
  let events = rows;
  if (!isStaff) {
    const students = await studentsOfUser(req, tid);
    events = rows.filter((e) => eventVisibleToUser(e, req.user, students));
  }
  ok(res, {
    events: events.map((e) => Object.assign({}, e, {
      target_ids: parseTargetIds(e.target_ids),
    })),
  });
}));

router.post("/", requirePermission("calendar.manage"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const input = await eventInput(tid, req.body);
  if (input.error) return err(res, 400, input.error);
  const result = await db.run(
    `INSERT INTO calendar_events (madrasa_id, title, description, event_type, start_date, end_date, start_time, end_time, location, audience, target_ids, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tid, input.title, input.description, input.type, input.startDate, input.endDate, input.startTime, input.endTime, input.location, input.audience, JSON.stringify(input.classes), input.status, req.user.id]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "calendar.event.create", entity: "calendar_event", entityId: String(result.lastInsertRowid), meta: { title: input.title, date: input.startDate }, ip: req.ip });
  ok(res, { ok: true, id: Number(result.lastInsertRowid) });
}));

router.patch("/:id", requirePermission("calendar.manage"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const row = await db.get("SELECT * FROM calendar_events WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!row) return err(res, 404, "Event not found.");
  const input = await eventInput(tid, req.body, row);
  if (input.error) return err(res, 400, input.error);
  await db.run(
    `UPDATE calendar_events SET title=?, description=?, event_type=?, start_date=?, end_date=?, start_time=?, end_time=?, location=?, audience=?, target_ids=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND madrasa_id=?`,
    [input.title, input.description, input.type, input.startDate, input.endDate, input.startTime, input.endTime, input.location, input.audience, JSON.stringify(input.classes), input.status, id, tid]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "calendar.event.update", entity: "calendar_event", entityId: String(id), meta: { title: input.title }, ip: req.ip });
  ok(res, { ok: true });
}));

router.delete("/:id", requirePermission("calendar.manage"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const result = await db.run("DELETE FROM calendar_events WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!result.changes) return err(res, 404, "Event not found.");
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "calendar.event.delete", entity: "calendar_event", entityId: String(id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
