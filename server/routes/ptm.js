"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Parent-Teacher Meeting (PTM) booking
   ----------------------------------------------------------------------------
   One meeting DAY per ptm_sessions row. The slot grid is DERIVED from
   session_start + session_end + slot_duration_mins (never stored twice), so
   editing the times can never orphan a stored slot row.

     Admin
       GET    /api/ptm                         list PTM sessions (+counts)
       POST   /api/ptm                         create (auto-builds slot grid
                                               and the teacher participation
                                               list from existing teachers)
       GET    /api/ptm/:id                     one session + slot grid
       PATCH  /api/ptm/:id                     edit / open / close
       GET    /api/ptm/:id/schedule            full booking grid (print/review)
       GET    /api/ptm/:id/export.csv          all bookings as CSV
     Teacher
       GET    /api/ptm/mine                    upcoming sessions they are in
       POST   /api/ptm/:id/availability        opt in / opt out
     Parent
       GET    /api/ptm/:id/teachers            their children's teachers
       GET    /api/ptm/:id/available-slots?teacherId=
       POST   /api/ptm/bookings                book a slot
       DELETE /api/ptm/bookings/:id            cancel (parent or admin)

   Conventions — identical to the health / library / leave modules:
     • every query filters on madrasa_id resolved from the SESSION; a
       client-supplied tenant id is never trusted;
     • a cross-tenant row answers 404 so existence is not leaked;
     • parents only ever reach students linked to them through parent_links;
     • the in-app notification is written through the existing
       services/communication.js (which also fans out to email/SMS/WhatsApp
       when the recipient's preferences and a provider are configured).

   BOTH institution categories (Islamic School and Western Academy) use this
   same engine, the same tables and the same endpoints — only the wording on
   screen differs, and that is decided by the frontend from the tenant's
   category. Nothing here branches on category.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, clampNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const comm = require("../services/communication");
const csv = require("../services/csv");

const router = express.Router();
router.use(requireAuth, requireTenant);

const ADMIN = requireRole("madrasa_admin", "super_admin");
const STATUSES = new Set(["draft", "open", "closed"]);
const MAX_SLOTS = 400; // a safety ceiling on a generated grid

function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { err(res, 400, "Madrasa context required."); return null; }
  return tid;
}
function today() { return new Date().toISOString().slice(0, 10); }
function isAdmin(req) { return req.user.role === "madrasa_admin" || req.user.role === "super_admin"; }

/* ------------------------------- time helpers ---------------------------- */
/** 'HH:MM' (also accepts 'HH:MM:SS' from MySQL TIME columns) -> minutes. */
function toMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value === null || value === undefined ? "" : value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function toHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** The derived slot grid for a session row: [{ slot_number, start, end }]. */
function slotGrid(row) {
  const start = toMinutes(row.session_start);
  const end = toMinutes(row.session_end);
  const duration = Math.max(1, Number(row.slot_duration_mins) || 10);
  if (start === null || end === null || end <= start) return [];
  const count = Math.min(MAX_SLOTS, Math.floor((end - start) / duration));
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({ slot_number: i + 1, start: toHHMM(start + i * duration), end: toHHMM(start + (i + 1) * duration) });
  }
  return slots;
}
function slotTimeFor(row, slotNumber) {
  const slot = slotGrid(row).find((s) => s.slot_number === Number(slotNumber));
  return slot ? slot.start : "";
}

/* ------------------------------- data helpers ---------------------------- */
async function loadSession(req, res, tid, id, { allowDraft = true } = {}) {
  const sid = toNum(id, 0);
  if (!sid) { err(res, 400, "Invalid id."); return null; }
  const row = await db.get("SELECT * FROM ptm_sessions WHERE id = ? AND madrasa_id = ?", [sid, tid]);
  if (!row) { err(res, 404, "Meeting session not found."); return null; }
  // A draft is an internal plan: only staff may see it at all.
  if (!allowDraft && row.status === "draft" && !isAdmin(req)) { err(res, 404, "Meeting session not found."); return null; }
  return row;
}

/** Children of this parent (tenant-scoped, through the existing parent_links). */
async function parentChildren(tid, parentUserId) {
  return db.all(
    `SELECT s.id, s.first_name, s.last_name, s.admission_no, s.class_id, c.name_en AS class_en
       FROM parent_links pl
       JOIN students s ON s.id = pl.student_id AND s.madrasa_id = pl.madrasa_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = s.madrasa_id
      WHERE pl.madrasa_id = ? AND pl.user_id = ?
      ORDER BY s.first_name, s.last_name`,
    [tid, parentUserId]
  );
}

/**
 * Teachers of one class: the existing teaching assignments plus the class's
 * own class/assistant teacher. No new relationship table is introduced.
 */
async function teachersForClass(tid, ptmSessionId, classId) {
  if (!classId) return [];
  return db.all(
    `SELECT u.id, u.full_name, u.username, ts.available
       FROM users u
       JOIN ptm_teacher_slots ts ON ts.teacher_user_id = u.id AND ts.madrasa_id = u.madrasa_id AND ts.ptm_session_id = ?
      WHERE u.madrasa_id = ? AND u.role = 'teacher' AND u.is_active = 1 AND ts.available = 1
        AND (EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.madrasa_id = u.madrasa_id AND ta.user_id = u.id AND ta.class_id = ?)
             OR EXISTS (SELECT 1 FROM classes c WHERE c.madrasa_id = u.madrasa_id AND c.id = ? AND (c.class_teacher_id = u.id OR c.assistant_teacher_id = u.id)))
      ORDER BY u.full_name, u.id`,
    [ptmSessionId, tid, classId, classId]
  );
}

/** Subjects a teacher is assigned to in a class — shown next to their name. */
async function teacherSubjects(tid, teacherUserId, classId) {
  if (!classId) return [];
  const rows = await db.all(
    `SELECT DISTINCT su.name_en FROM teacher_assignments ta
       JOIN subjects su ON su.id = ta.subject_id AND su.madrasa_id = ta.madrasa_id
      WHERE ta.madrasa_id = ? AND ta.user_id = ? AND ta.class_id = ? ORDER BY su.name_en`,
    [tid, teacherUserId, classId]
  );
  return rows.map((r) => r.name_en);
}

/** Active (non-cancelled) bookings of one meeting session. */
async function bookingsFor(tid, ptmSessionId, { includeCancelled = false } = {}) {
  return db.all(
    `SELECT b.*, s.first_name, s.last_name, s.admission_no, c.name_en AS class_en,
            p.full_name AS parent_name, p.username AS parent_username, p.phone AS parent_phone, p.email AS parent_email,
            t.full_name AS teacher_name
       FROM ptm_bookings b
       LEFT JOIN students s ON s.id = b.student_id AND s.madrasa_id = b.madrasa_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = b.madrasa_id
       LEFT JOIN users p ON p.id = b.parent_user_id AND p.madrasa_id = b.madrasa_id
       LEFT JOIN users t ON t.id = b.teacher_user_id AND t.madrasa_id = b.madrasa_id
      WHERE b.madrasa_id = ? AND b.ptm_session_id = ? ${includeCancelled ? "" : "AND b.status <> 'cancelled'"}
      ORDER BY b.slot_number, b.teacher_user_id`,
    [tid, ptmSessionId]
  );
}

function sessionDto(row, slots) {
  return {
    id: Number(row.id),
    title: row.title,
    date: String(row.date || "").slice(0, 10),
    session_start: String(row.session_start || "").slice(0, 5),
    session_end: String(row.session_end || "").slice(0, 5),
    slot_duration_mins: Number(row.slot_duration_mins || 0),
    location: row.location || "",
    term_id: row.term_id ? Number(row.term_id) : null,
    session_id: row.session_id ? Number(row.session_id) : null,
    status: row.status,
    created_by: row.created_by ? Number(row.created_by) : null,
    created_at: row.created_at,
    slot_count: (slots || slotGrid(row)).length,
  };
}

/** Human summary used in every notification (date, time, location). */
function meetingSummary(session, slotTime) {
  const when = `${String(session.date).slice(0, 10)}${slotTime ? ` at ${slotTime}` : ""}`;
  const where = session.location ? ` · ${session.location}` : "";
  return `${session.title}: ${when}${where}`;
}

async function notifyBooking(tid, session, booking, { cancelled = false, actorId = null } = {}) {
  const studentName = [booking.first_name, booking.last_name].filter(Boolean).join(" ").trim() || "your child";
  const teacherName = booking.teacher_name || "the teacher";
  const parentName = booking.parent_name || booking.parent_username || "a parent";
  const title = cancelled ? "Parent-teacher meeting cancelled" : "Parent-teacher meeting confirmed";
  const summary = meetingSummary(session, String(booking.slot_time || "").slice(0, 5));
  try {
    await comm.createNotifications(tid, [booking.parent_user_id], {
      type: "ptm_booking",
      title,
      body: `${cancelled ? "Cancelled" : "Confirmed"} — meeting with ${teacherName} about ${studentName}. ${summary}.`,
      entity_type: "ptm_booking",
      entity_id: booking.id,
      student_id: booking.student_id,
      sent_by: actorId,
    });
    await comm.createNotifications(tid, [booking.teacher_user_id], {
      type: "ptm_booking",
      title,
      body: `${cancelled ? "Cancelled" : "Confirmed"} — meeting with ${parentName} about ${studentName}. ${summary}.`,
      entity_type: "ptm_booking",
      entity_id: booking.id,
      student_id: booking.student_id,
      sent_by: actorId,
    });
  } catch (e) {
    // Notification delivery must never fail a confirmed booking.
    console.error("[ptm] notification failed:", e.message);
  }
}

/* ============================ ADMIN: sessions ============================= */

/**
 * List meeting sessions for this tenant. Staff see everything; parents and
 * students only ever see sessions that are actually open/closed (never a
 * draft the administrator is still preparing).
 */
router.get("/", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const where = ["p.madrasa_id = ?"];
  const params = [tid];
  if (!isAdmin(req)) where.push("p.status <> 'draft'");
  const status = cleanStr(req.query.status, 20).toLowerCase();
  if (status) {
    if (!STATUSES.has(status)) return err(res, 400, "Unknown status.");
    where.push("p.status = ?"); params.push(status);
  }
  if (["1", "true", "yes"].includes(String(req.query.upcoming || "").toLowerCase())) {
    where.push("p.date >= ?"); params.push(today());
  }
  const rows = await db.all(
    `SELECT p.*, t.name_en AS term_name, a.label AS session_label,
            (SELECT COUNT(*) FROM ptm_teacher_slots ts WHERE ts.madrasa_id = p.madrasa_id AND ts.ptm_session_id = p.id AND ts.available = 1) AS teacher_count,
            (SELECT COUNT(*) FROM ptm_bookings b WHERE b.madrasa_id = p.madrasa_id AND b.ptm_session_id = p.id AND b.status <> 'cancelled') AS booking_count
       FROM ptm_sessions p
       LEFT JOIN terms t ON t.id = p.term_id AND t.madrasa_id = p.madrasa_id
       LEFT JOIN academic_sessions a ON a.id = p.session_id AND a.madrasa_id = p.madrasa_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.date DESC, p.id DESC LIMIT 200`,
    params
  );
  ok(res, {
    sessions: rows.map((r) => Object.assign(sessionDto(r), {
      term_name: r.term_name || "",
      session_label: r.session_label || "",
      teacher_count: Number(r.teacher_count || 0),
      booking_count: Number(r.booking_count || 0),
      slot_capacity: slotGrid(r).length * Number(r.teacher_count || 0),
    })),
  });
}));

/** The teacher's own upcoming meeting sessions (with their bookings). */
router.get("/mine", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  if (req.user.role !== "teacher") return err(res, 403, "Only teachers have a meeting participation list.");
  const rows = await db.all(
    `SELECT p.*, ts.available
       FROM ptm_sessions p
       JOIN ptm_teacher_slots ts ON ts.ptm_session_id = p.id AND ts.madrasa_id = p.madrasa_id AND ts.teacher_user_id = ?
      WHERE p.madrasa_id = ? AND p.status <> 'draft' AND p.date >= ?
      ORDER BY p.date, p.id`,
    [req.user.id, tid, today()]
  );
  const sessions = [];
  for (const row of rows) {
    const bookings = await db.all(
      `SELECT b.id, b.slot_number, b.slot_time, b.status, b.notes, b.student_id,
              s.first_name, s.last_name, s.admission_no, c.name_en AS class_en,
              u.full_name AS parent_name, u.phone AS parent_phone, u.email AS parent_email
         FROM ptm_bookings b
         LEFT JOIN students s ON s.id = b.student_id AND s.madrasa_id = b.madrasa_id
         LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = b.madrasa_id
         LEFT JOIN users u ON u.id = b.parent_user_id AND u.madrasa_id = b.madrasa_id
        WHERE b.madrasa_id = ? AND b.ptm_session_id = ? AND b.teacher_user_id = ? AND b.status <> 'cancelled'
        ORDER BY b.slot_number`,
      [tid, row.id, req.user.id]
    );
    sessions.push(Object.assign(sessionDto(row), {
      available: Number(row.available) === 1,
      slots: slotGrid(row),
      bookings,
    }));
  }
  ok(res, { sessions });
}));

/** Create a meeting session. The slot grid and the participating-teacher list
    are generated automatically from the times and the existing teachers. */
router.post("/", ADMIN, asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const b = req.body || {};
  const title = cleanStr(b.title, 200);
  if (!title) return err(res, 400, "A meeting title is required.");
  const date = validDate(b.date);
  if (!date) return err(res, 400, "A valid meeting date (YYYY-MM-DD) is required.");
  const start = toMinutes(b.session_start);
  const end = toMinutes(b.session_end);
  if (start === null) return err(res, 400, "A valid start time (HH:MM) is required.");
  if (end === null) return err(res, 400, "A valid end time (HH:MM) is required.");
  if (end <= start) return err(res, 400, "The end time must be after the start time.");
  const duration = Math.floor(clampNum(b.slot_duration_mins, 5, 240, 10));
  if (Math.floor((end - start) / duration) < 1) return err(res, 400, "The meeting window is shorter than one slot.");

  const termId = b.term_id ? toNum(b.term_id, 0) : null;
  const sessionId = b.session_id ? toNum(b.session_id, 0) : null;
  if (termId && !await db.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid])) return err(res, 400, "Unknown term.");
  if (sessionId && !await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid])) return err(res, 400, "Unknown academic session.");

  const status = cleanStr(b.status, 20).toLowerCase() || "draft";
  if (!STATUSES.has(status)) return err(res, 400, "Status must be draft, open or closed.");

  const created = await db.transaction(async (tx) => {
    const r = await tx.run(
      `INSERT INTO ptm_sessions (madrasa_id, title, date, session_start, session_end, slot_duration_mins, location, term_id, session_id, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid, title, date, toHHMM(start), toHHMM(end), duration, cleanStr(b.location, 200), termId, sessionId, status, req.user.id]
    );
    const id = Number(r.lastInsertRowid);
    // Every active teacher of this institution is enrolled as available by
    // default; each can opt out later from their own screen.
    const teachers = await tx.all("SELECT id FROM users WHERE madrasa_id = ? AND role = 'teacher' AND is_active = 1", [tid]);
    for (const t of teachers) {
      await tx.run("INSERT INTO ptm_teacher_slots (madrasa_id, ptm_session_id, teacher_user_id, available) VALUES (?,?,?,1)", [tid, id, t.id]);
    }
    return { id, teachers: teachers.length };
  });

  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "ptm.session.create", entity: "ptm_session", entityId: String(created.id), ip: req.ip });
  const row = await db.get("SELECT * FROM ptm_sessions WHERE id = ? AND madrasa_id = ?", [created.id, tid]);
  ok(res, { ok: true, id: created.id, teachers: created.teachers, session: sessionDto(row), slots: slotGrid(row) });
}));

/** One session with its derived slot grid and participating teachers. */
router.get("/:id", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id, { allowDraft: false }); if (!row) return;
  const teachers = await db.all(
    `SELECT ts.teacher_user_id AS id, ts.available, u.full_name, u.username
       FROM ptm_teacher_slots ts JOIN users u ON u.id = ts.teacher_user_id AND u.madrasa_id = ts.madrasa_id
      WHERE ts.madrasa_id = ? AND ts.ptm_session_id = ? AND u.is_active = 1
      ORDER BY u.full_name, u.id`,
    [tid, row.id]
  );
  ok(res, { session: sessionDto(row), slots: slotGrid(row), teachers });
}));

/** Edit a session or change its status (draft -> open -> closed). */
router.patch("/:id", ADMIN, asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id); if (!row) return;
  const b = req.body || {};
  const next = {
    title: row.title,
    date: String(row.date).slice(0, 10),
    session_start: String(row.session_start).slice(0, 5),
    session_end: String(row.session_end).slice(0, 5),
    slot_duration_mins: Number(row.slot_duration_mins),
    location: row.location || "",
    term_id: row.term_id || null,
    session_id: row.session_id || null,
    status: row.status,
  };

  if (b.title !== undefined) {
    const title = cleanStr(b.title, 200);
    if (!title) return err(res, 400, "A meeting title is required.");
    next.title = title;
  }
  if (b.date !== undefined) {
    const date = validDate(b.date);
    if (!date) return err(res, 400, "A valid meeting date (YYYY-MM-DD) is required.");
    next.date = date;
  }
  if (b.session_start !== undefined) {
    const v = toMinutes(b.session_start);
    if (v === null) return err(res, 400, "A valid start time (HH:MM) is required.");
    next.session_start = toHHMM(v);
  }
  if (b.session_end !== undefined) {
    const v = toMinutes(b.session_end);
    if (v === null) return err(res, 400, "A valid end time (HH:MM) is required.");
    next.session_end = toHHMM(v);
  }
  if (b.slot_duration_mins !== undefined) next.slot_duration_mins = Math.floor(clampNum(b.slot_duration_mins, 5, 240, next.slot_duration_mins));
  if (b.location !== undefined) next.location = cleanStr(b.location, 200);
  if (b.term_id !== undefined) {
    const termId = b.term_id ? toNum(b.term_id, 0) : null;
    if (termId && !await db.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid])) return err(res, 400, "Unknown term.");
    next.term_id = termId;
  }
  if (b.session_id !== undefined) {
    const sessionId = b.session_id ? toNum(b.session_id, 0) : null;
    if (sessionId && !await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid])) return err(res, 400, "Unknown academic session.");
    next.session_id = sessionId;
  }
  if (b.status !== undefined) {
    const status = cleanStr(b.status, 20).toLowerCase();
    if (!STATUSES.has(status)) return err(res, 400, "Status must be draft, open or closed.");
    next.status = status;
  }

  if (toMinutes(next.session_end) <= toMinutes(next.session_start)) return err(res, 400, "The end time must be after the start time.");
  const slots = slotGrid(next);
  if (!slots.length) return err(res, 400, "The meeting window is shorter than one slot.");

  // A shorter window must never silently strand a family that has already
  // booked: refuse the edit and say how many bookings are in the way.
  const stranded = await db.get(
    "SELECT COUNT(*) AS n FROM ptm_bookings WHERE madrasa_id = ? AND ptm_session_id = ? AND status <> 'cancelled' AND slot_number > ?",
    [tid, row.id, slots.length]
  );
  if (Number(stranded.n || 0) > 0) {
    return err(res, 409, `${stranded.n} existing booking(s) fall outside the new time window. Cancel them first or keep a longer window.`);
  }

  await db.run(
    `UPDATE ptm_sessions SET title=?, date=?, session_start=?, session_end=?, slot_duration_mins=?, location=?, term_id=?, session_id=?, status=?
      WHERE id = ? AND madrasa_id = ?`,
    [next.title, next.date, next.session_start, next.session_end, next.slot_duration_mins, next.location, next.term_id, next.session_id, next.status, row.id, tid]
  );
  // Slot times move with the window, so stored copies are refreshed too.
  for (const slot of slots) {
    await db.run(
      "UPDATE ptm_bookings SET slot_time = ? WHERE madrasa_id = ? AND ptm_session_id = ? AND slot_number = ?",
      [slot.start, tid, row.id, slot.slot_number]
    );
  }
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "ptm.session.update", entity: "ptm_session", entityId: String(row.id), meta: { status: next.status }, ip: req.ip });
  const updated = await db.get("SELECT * FROM ptm_sessions WHERE id = ? AND madrasa_id = ?", [row.id, tid]);
  ok(res, { ok: true, session: sessionDto(updated), slots: slotGrid(updated) });
}));

/** The full booking grid: teachers as columns, slots as rows. */
router.get("/:id/schedule", ADMIN, asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id); if (!row) return;
  const teachers = await db.all(
    `SELECT ts.teacher_user_id AS id, ts.available, u.full_name, u.username
       FROM ptm_teacher_slots ts JOIN users u ON u.id = ts.teacher_user_id AND u.madrasa_id = ts.madrasa_id
      WHERE ts.madrasa_id = ? AND ts.ptm_session_id = ? AND u.is_active = 1 AND ts.available = 1
      ORDER BY u.full_name, u.id`,
    [tid, row.id]
  );
  const bookings = await bookingsFor(tid, row.id);
  const byCell = new Map();
  for (const bk of bookings) byCell.set(`${bk.slot_number}:${bk.teacher_user_id}`, bk);
  const slots = slotGrid(row);
  const grid = slots.map((slot) => ({
    slot_number: slot.slot_number,
    start: slot.start,
    end: slot.end,
    cells: teachers.map((t) => {
      const bk = byCell.get(`${slot.slot_number}:${t.id}`);
      return bk
        ? {
          teacher_user_id: Number(t.id), booking_id: Number(bk.id), status: bk.status,
          parent_name: bk.parent_name || bk.parent_username || "",
          student_name: [bk.first_name, bk.last_name].filter(Boolean).join(" ").trim(),
          admission_no: bk.admission_no || "", class_en: bk.class_en || "", notes: bk.notes || "",
        }
        : { teacher_user_id: Number(t.id), booking_id: null };
    }),
  }));
  ok(res, {
    session: sessionDto(row), teachers, slots, grid,
    stats: { teachers: teachers.length, slots: slots.length, booked: bookings.length, capacity: teachers.length * slots.length },
  });
}));

/** Every booking of this session as a CSV file. */
router.get("/:id/export.csv", ADMIN, asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id); if (!row) return;
  const bookings = await bookingsFor(tid, row.id, { includeCancelled: true });
  csv.sendCsv(res, `ptm-${String(row.date).slice(0, 10)}-bookings.csv`, csv.toCsv(bookings, [
    { label: "Meeting", value: () => row.title },
    { label: "Date", value: () => String(row.date).slice(0, 10) },
    { label: "Location", value: () => row.location || "" },
    { label: "Slot", key: "slot_number" },
    { label: "Time", value: (r) => String(r.slot_time || "").slice(0, 5) },
    { label: "Teacher", key: "teacher_name" },
    { label: "Student", value: (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() },
    { label: "Admission No", key: "admission_no" },
    { label: "Class", key: "class_en" },
    { label: "Parent / guardian", value: (r) => r.parent_name || r.parent_username || "" },
    { label: "Parent phone", key: "parent_phone" },
    { label: "Parent email", key: "parent_email" },
    { label: "Status", key: "status" },
    { label: "Notes", key: "notes" },
    { label: "Booked at", value: (r) => String(r.booked_at || "").slice(0, 19) },
  ]));
}));

/* ============================ TEACHER: availability ======================= */

/**
 * Mark availability for this meeting session (opt in / opt out).
 * A teacher may only change their own row; an administrator may change any
 * teacher's row in their own institution.
 */
router.post("/:id/availability", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id); if (!row) return;
  const b = req.body || {};
  let teacherId = req.user.id;
  if (b.teacher_user_id !== undefined && b.teacher_user_id !== null && String(b.teacher_user_id) !== "") {
    const wanted = toNum(b.teacher_user_id, 0);
    if (wanted !== Number(req.user.id) && !isAdmin(req)) return err(res, 403, "You may only change your own availability.");
    teacherId = wanted;
  } else if (req.user.role !== "teacher") {
    return err(res, 400, "teacher_user_id is required.");
  }
  const teacher = await db.get("SELECT id FROM users WHERE id = ? AND madrasa_id = ? AND role = 'teacher' AND is_active = 1", [teacherId, tid]);
  if (!teacher) return err(res, 404, "Teacher not found in this institution.");

  const raw = b.available === undefined ? true : b.available;
  const available = !(raw === false || raw === 0 || raw === "0" || String(raw).toLowerCase() === "false");

  if (!available) {
    const booked = await db.get(
      "SELECT COUNT(*) AS n FROM ptm_bookings WHERE madrasa_id = ? AND ptm_session_id = ? AND teacher_user_id = ? AND status <> 'cancelled'",
      [tid, row.id, teacherId]
    );
    if (Number(booked.n || 0) > 0) return err(res, 409, `${booked.n} parent(s) already booked this teacher. Cancel those bookings before opting out.`);
  }

  const existing = await db.get("SELECT id FROM ptm_teacher_slots WHERE madrasa_id = ? AND ptm_session_id = ? AND teacher_user_id = ?", [tid, row.id, teacherId]);
  if (existing) await db.run("UPDATE ptm_teacher_slots SET available = ? WHERE id = ? AND madrasa_id = ?", [available ? 1 : 0, existing.id, tid]);
  else await db.run("INSERT INTO ptm_teacher_slots (madrasa_id, ptm_session_id, teacher_user_id, available) VALUES (?,?,?,?)", [tid, row.id, teacherId, available ? 1 : 0]);

  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "ptm.availability", entity: "ptm_session", entityId: String(row.id), meta: { teacherId, available }, ip: req.ip });
  ok(res, { ok: true, ptm_session_id: Number(row.id), teacher_user_id: Number(teacherId), available });
}));

/* ============================== PARENT: booking =========================== */

/** The parent's children and, per child, the teachers taking part. */
router.get("/:id/teachers", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id, { allowDraft: false }); if (!row) return;
  if (req.user.role !== "parent" && !isAdmin(req)) return err(res, 403, "Only parents and administrators can browse meeting teachers.");

  let children;
  if (req.user.role === "parent") children = await parentChildren(tid, req.user.id);
  else {
    const studentId = toNum(req.query.studentId, 0);
    if (!studentId) return err(res, 400, "studentId is required.");
    children = await db.all(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, s.class_id, c.name_en AS class_en
         FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = s.madrasa_id
        WHERE s.id = ? AND s.madrasa_id = ?`,
      [studentId, tid]
    );
    if (!children.length) return err(res, 404, "Student not found.");
  }

  const out = [];
  for (const child of children) {
    const teachers = await teachersForClass(tid, row.id, child.class_id);
    const withSubjects = [];
    for (const t of teachers) {
      withSubjects.push({ id: Number(t.id), full_name: t.full_name, username: t.username, subjects: await teacherSubjects(tid, t.id, child.class_id) });
    }
    out.push(Object.assign({}, child, { teachers: withSubjects }));
  }

  const myBookings = req.user.role === "parent"
    ? await db.all(
      `SELECT b.*, u.full_name AS teacher_name, s.first_name, s.last_name
         FROM ptm_bookings b
         LEFT JOIN users u ON u.id = b.teacher_user_id AND u.madrasa_id = b.madrasa_id
         LEFT JOIN students s ON s.id = b.student_id AND s.madrasa_id = b.madrasa_id
        WHERE b.madrasa_id = ? AND b.ptm_session_id = ? AND b.parent_user_id = ? AND b.status <> 'cancelled'
        ORDER BY b.slot_number`,
      [tid, row.id, req.user.id]
    )
    : [];
  ok(res, { session: sessionDto(row), slots: slotGrid(row), children: out, bookings: myBookings });
}));

/**
 * Free slots for one teacher in this meeting session. A parent may only ask
 * about a teacher of one of their own linked children.
 */
router.get("/:id/available-slots", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const row = await loadSession(req, res, tid, req.params.id, { allowDraft: false }); if (!row) return;
  const teacherId = toNum(req.query.teacherId, 0);
  if (!teacherId) return err(res, 400, "teacherId is required.");

  const participant = await db.get(
    `SELECT ts.available, u.full_name FROM ptm_teacher_slots ts
       JOIN users u ON u.id = ts.teacher_user_id AND u.madrasa_id = ts.madrasa_id
      WHERE ts.madrasa_id = ? AND ts.ptm_session_id = ? AND ts.teacher_user_id = ? AND u.is_active = 1`,
    [tid, row.id, teacherId]
  );
  if (!participant) return err(res, 404, "That teacher is not part of this meeting session.");
  if (Number(participant.available) !== 1) return err(res, 409, "That teacher is not available for this meeting session.");

  if (req.user.role === "parent") {
    const children = await parentChildren(tid, req.user.id);
    const classIds = [...new Set(children.map((c) => Number(c.class_id)).filter(Boolean))];
    let allowed = false;
    for (const classId of classIds) {
      const list = await teachersForClass(tid, row.id, classId);
      if (list.some((t) => Number(t.id) === teacherId)) { allowed = true; break; }
    }
    if (!allowed) return err(res, 403, "That teacher does not teach any of your children.");
  } else if (req.user.role === "student") {
    return err(res, 403, "Only parents book parent-teacher meetings.");
  } else if (req.user.role === "teacher" && Number(req.user.id) !== teacherId) {
    return err(res, 403, "You may only view your own slots.");
  }

  const taken = await db.all(
    "SELECT slot_number, parent_user_id FROM ptm_bookings WHERE madrasa_id = ? AND ptm_session_id = ? AND teacher_user_id = ? AND status <> 'cancelled'",
    [tid, row.id, teacherId]
  );
  const takenNumbers = new Set(taken.map((t) => Number(t.slot_number)));
  // A parent already meeting another teacher at that time cannot also be here.
  const mine = req.user.role === "parent"
    ? await db.all("SELECT slot_number FROM ptm_bookings WHERE madrasa_id = ? AND ptm_session_id = ? AND parent_user_id = ? AND status <> 'cancelled'", [tid, row.id, req.user.id])
    : [];
  const myNumbers = new Set(mine.map((t) => Number(t.slot_number)));

  const slots = slotGrid(row).map((slot) => ({
    slot_number: slot.slot_number,
    start: slot.start,
    end: slot.end,
    available: row.status === "open" && !takenNumbers.has(slot.slot_number) && !myNumbers.has(slot.slot_number),
    taken: takenNumbers.has(slot.slot_number),
    clashes_with_my_booking: myNumbers.has(slot.slot_number),
  }));
  ok(res, {
    session: sessionDto(row),
    teacher: { id: teacherId, full_name: participant.full_name },
    slots,
    open: row.status === "open",
  });
}));

/** Book a slot. Validates no double-booking per parent and per teacher slot. */
router.post("/bookings", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  if (req.user.role !== "parent") return err(res, 403, "Only a parent account can book a meeting slot.");
  const b = req.body || {};
  const ptmSessionId = toNum(b.ptm_session_id || b.session_id, 0);
  const teacherId = toNum(b.teacher_user_id, 0);
  const studentId = toNum(b.student_id, 0);
  const slotNumber = toNum(b.slot_number, 0);
  if (!ptmSessionId) return err(res, 400, "ptm_session_id is required.");
  if (!teacherId) return err(res, 400, "teacher_user_id is required.");
  if (!studentId) return err(res, 400, "student_id is required.");
  if (!slotNumber || slotNumber < 1) return err(res, 400, "A valid slot_number is required.");

  const session = await db.get("SELECT * FROM ptm_sessions WHERE id = ? AND madrasa_id = ?", [ptmSessionId, tid]);
  if (!session) return err(res, 404, "Meeting session not found.");
  if (session.status !== "open") return err(res, 409, "This meeting session is not open for booking.");

  const slots = slotGrid(session);
  const slot = slots.find((s) => s.slot_number === slotNumber);
  if (!slot) return err(res, 400, "That slot is not part of this meeting session.");

  // The child must be linked to THIS parent in THIS institution.
  const link = await db.get(
    `SELECT s.id, s.first_name, s.last_name, s.class_id FROM parent_links pl
       JOIN students s ON s.id = pl.student_id AND s.madrasa_id = pl.madrasa_id
      WHERE pl.madrasa_id = ? AND pl.user_id = ? AND pl.student_id = ?`,
    [tid, req.user.id, studentId]
  );
  if (!link) return err(res, 404, "Student not found.");

  const participant = await db.get(
    "SELECT available FROM ptm_teacher_slots WHERE madrasa_id = ? AND ptm_session_id = ? AND teacher_user_id = ?",
    [tid, ptmSessionId, teacherId]
  );
  if (!participant) return err(res, 404, "That teacher is not part of this meeting session.");
  if (Number(participant.available) !== 1) return err(res, 409, "That teacher is not available for this meeting session.");

  const classTeachers = await teachersForClass(tid, ptmSessionId, link.class_id);
  if (!classTeachers.some((t) => Number(t.id) === teacherId)) return err(res, 403, "That teacher does not teach the selected child.");

  let bookingId;
  try {
    bookingId = await db.transaction(async (tx) => {
      const clash = await tx.get(
        "SELECT id FROM ptm_bookings WHERE ptm_session_id = ? AND teacher_user_id = ? AND slot_number = ? AND status <> 'cancelled'",
        [ptmSessionId, teacherId, slotNumber]
      );
      if (clash) throw Object.assign(new Error("That slot has just been taken. Choose another time."), { status: 409 });
      const mine = await tx.get(
        "SELECT id FROM ptm_bookings WHERE ptm_session_id = ? AND parent_user_id = ? AND slot_number = ? AND status <> 'cancelled'",
        [ptmSessionId, req.user.id, slotNumber]
      );
      if (mine) throw Object.assign(new Error("You already have a meeting booked at that time."), { status: 409 });
      const duplicate = await tx.get(
        "SELECT id FROM ptm_bookings WHERE ptm_session_id = ? AND parent_user_id = ? AND teacher_user_id = ? AND student_id = ? AND status <> 'cancelled'",
        [ptmSessionId, req.user.id, teacherId, studentId]
      );
      if (duplicate) throw Object.assign(new Error("You already have a meeting with this teacher about this child."), { status: 409 });
      const r = await tx.run(
        `INSERT INTO ptm_bookings (madrasa_id, ptm_session_id, teacher_user_id, student_id, parent_user_id, slot_number, slot_time, status, notes)
         VALUES (?,?,?,?,?,?,?,'booked',?)`,
        [tid, ptmSessionId, teacherId, studentId, req.user.id, slotNumber, slot.start, cleanStr(b.notes, 2000)]
      );
      return Number(r.lastInsertRowid);
    });
  } catch (e) {
    if (e && e.status === 409) return err(res, 409, e.message);
    throw e;
  }

  const booking = (await bookingsFor(tid, ptmSessionId, { includeCancelled: true })).find((x) => Number(x.id) === bookingId);
  await notifyBooking(tid, session, booking, { actorId: req.user.id });
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "ptm.booking.create", entity: "ptm_booking", entityId: String(bookingId), ip: req.ip });
  ok(res, {
    ok: true,
    id: bookingId,
    confirmation: {
      booking_id: bookingId,
      title: session.title,
      date: String(session.date).slice(0, 10),
      slot_number: slotNumber,
      slot_time: slot.start,
      slot_end: slot.end,
      location: session.location || "",
      teacher_name: booking ? booking.teacher_name : "",
      student_name: [link.first_name, link.last_name].filter(Boolean).join(" ").trim(),
      summary: meetingSummary(session, slot.start),
    },
  });
}));

/** Cancel a booking. The parent who made it, or an administrator. */
router.delete("/bookings/:id", asyncHandler(async (req, res) => {
  const tid = tenantId(req, res); if (!tid) return;
  const id = toNum(req.params.id, 0);
  if (!id) return err(res, 400, "Invalid id.");
  const booking = await db.get("SELECT * FROM ptm_bookings WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!booking) return err(res, 404, "Booking not found.");
  const owner = Number(booking.parent_user_id) === Number(req.user.id);
  if (!owner && !isAdmin(req)) return err(res, 404, "Booking not found.");
  if (booking.status === "cancelled") return err(res, 409, "That booking is already cancelled.");

  await db.run("UPDATE ptm_bookings SET status = 'cancelled' WHERE id = ? AND madrasa_id = ?", [id, tid]);
  const session = await db.get("SELECT * FROM ptm_sessions WHERE id = ? AND madrasa_id = ?", [booking.ptm_session_id, tid]);
  const full = (await bookingsFor(tid, booking.ptm_session_id, { includeCancelled: true })).find((x) => Number(x.id) === id);
  if (session && full) await notifyBooking(tid, session, full, { cancelled: true, actorId: req.user.id });
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "ptm.booking.cancel", entity: "ptm_booking", entityId: String(id), ip: req.ip });
  ok(res, { ok: true, cancelled: true, id });
}));

module.exports = router;
module.exports.slotGrid = slotGrid;
module.exports.toHHMM = toHHMM;
module.exports.toMinutes = toMinutes;
