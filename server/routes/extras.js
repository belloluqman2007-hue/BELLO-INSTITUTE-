"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — School extras (chat, homework, notifications, users)
   ----------------------------------------------------------------------------
   Tenant-scoped companions to the core modules:
     GET  /api/notifications          latest announcements + attention counts
     GET  /api/chat?scope=general|staff
     POST /api/chat                   { scope, body }
     DELETE /api/chat/:id
     GET  /api/homework?classId=
     POST /api/homework               { class_id, subject_id?, title, details?, due_date? }
     DELETE /api/homework/:id
     GET  /api/users                  (madrasa_admin) every login in this madrasa
     PATCH /api/users/:id             (madrasa_admin) activate / deactivate

   Isolation: every query filters by the caller's own madrasa_id (from the
   session, never from the client). Staff chat is madrasa_admin + teacher only.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const { requireStaffPermission } = require("../services/permissions");

const router = express.Router();
// Per-route auth: this router is mounted at "/", so a router-level gate would 401
// every later /api route (including the logged-out /api/health check).
const gate = [requireAuth, requireTenant];

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

function audienceForRole(role) {
  if (role === "student") return "students";
  if (role === "parent") return "parents";
  return null;
}

const STAFF = ["madrasa_admin", "teacher"];

/* ------------------------------ notifications -------------------------- */

router.get("/notifications", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const aud = audienceForRole(req.user.role);
  const announcements = aud
    ? await db.all(
      "SELECT id, title, body, audience, created_at FROM announcements WHERE madrasa_id = ? AND is_active = 1 AND (audience = 'all' OR audience = ?) ORDER BY created_at DESC, id DESC LIMIT 20",
      [tid, aud]
    )
    : await db.all(
      "SELECT id, title, body, audience, created_at FROM announcements WHERE madrasa_id = ? AND is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 20",
      [tid]
    );
  const counts = {};
  if (req.user.role === "madrasa_admin") {
    const p = await db.get("SELECT COUNT(*) AS n FROM admission_requests WHERE madrasa_id = ? AND status = 'pending'", [tid]);
    const u = await db.get("SELECT COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND published_at IS NULL", [tid]);
    const hw = await db.get("SELECT COUNT(*) AS n FROM homework WHERE madrasa_id = ?", [tid]);
    counts.pendingAdmissions = Number(p.n);
    counts.unpublishedSummaries = Number(u.n);
    counts.homework = Number(hw.n);
  } else if (req.user.role === "teacher") {
    const hw = await db.get("SELECT COUNT(*) AS n FROM homework WHERE madrasa_id = ?", [tid]);
    counts.homework = Number(hw.n);
  } else if (req.user.role === "student" && req.user.studentId) {
    const t = await db.get("SELECT COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND published_at IS NOT NULL", [tid, req.user.studentId]);
    counts.publishedTerms = Number(t.n);
  } else if (req.user.role === "parent") {
    const kids = await db.all("SELECT student_id FROM parent_links WHERE madrasa_id = ? AND user_id = ?", [tid, req.user.id]);
    counts.children = kids.length;
  }
  ok(res, { announcements, counts });
}));

/* ------------------------------ chat ----------------------------------- */

function chatScope(req) {
  const s = String((req.query && req.query.scope) || ((req.body && req.body.scope)) || "general").toLowerCase();
  return s === "staff" ? "staff" : "general";
}

router.get("/chat", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const scope = chatScope(req);
  if (scope === "staff" && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ error: "Staff chat is for staff only." });
  }
  const limit = Math.min(100, Math.max(1, toNum(req.query.limit, 50)));
  // Backfill-safe: older DBs without the messages table answer empty.
  let rows = [];
  try {
    rows = await db.all(
      `SELECT m.id, m.scope, m.user_id, m.author_name, m.body, m.created_at,
              u.role AS author_role, u.full_name AS author_full
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.madrasa_id = ? AND m.scope = ? ORDER BY m.id DESC LIMIT ?`,
      [tid, scope, limit]
    );
  } catch (e) { rows = []; }
  rows.reverse();
  ok(res, {
    scope,
    messages: rows.map((m) => ({
      id: m.id,
      scope: m.scope,
      userId: m.user_id,
      author: m.author_name || m.author_full || "—",
      authorRole: m.author_role || "",
      body: m.body,
      createdAt: m.created_at,
      mine: Number(m.user_id) === Number(req.user.id),
    })),
  });
}));

router.post("/chat", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const scope = chatScope(req);
  if (scope === "staff" && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ error: "Staff chat is for staff only." });
  }
  const body = cleanStr(req.body && req.body.body, 2000);
  if (!body) return err(res, 400, "Message cannot be empty.");
  const author = cleanStr(req.user.fullName || req.user.username, 160);
  const r = await db.run(
    "INSERT INTO messages (madrasa_id, scope, user_id, author_name, body) VALUES (?,?,?,?,?)",
    [tid, scope, req.user.id, author, body]
  );
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.delete("/chat/:id", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const m = await db.get("SELECT * FROM messages WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!m) return res.status(404).json({ error: "Message not found." });
  const canDelete = req.user.role === "madrasa_admin" || Number(m.user_id) === Number(req.user.id);
  if (!canDelete) return res.status(403).json({ error: "You can only delete your own messages." });
  await db.run("DELETE FROM messages WHERE id = ?", [m.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ homework ------------------------------- */

async function homeworkClassIds(req, tid) {
  if (req.user.role === "madrasa_admin" || req.user.role === "teacher") return null; // all
  if (req.user.role === "student") {
    const s = await db.get("SELECT class_id FROM students WHERE id = ? AND madrasa_id = ?", [req.user.studentId, tid]);
    return s && s.class_id ? [s.class_id] : [];
  }
  const rows = await db.all(
    `SELECT DISTINCT s.class_id AS class_id FROM students s
     JOIN parent_links pl ON pl.student_id = s.id AND pl.madrasa_id = s.madrasa_id
     WHERE pl.madrasa_id = ? AND pl.user_id = ? AND s.class_id IS NOT NULL`,
    [tid, req.user.id]
  );
  return rows.map((r) => r.class_id);
}

router.get("/homework", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const allowed = await homeworkClassIds(req, tid);
  const wantClass = toNum(req.query.classId, 0);
  const kind = ["lesson", "assignment"].includes(cleanStr(req.query.kind, 20)) ? cleanStr(req.query.kind, 20) : "";
  let rows = [];
  try {
    rows = await db.all(
      `SELECT h.*, c.name_en AS class_en, c.name_ar AS class_ar,
              s.name_en AS subject_en, s.name_ar AS subject_ar,
              u.full_name AS author
       FROM homework h
       LEFT JOIN classes c ON c.id = h.class_id
       LEFT JOIN subjects s ON s.id = h.subject_id
       LEFT JOIN users u ON u.id = h.created_by
       WHERE h.madrasa_id = ? ORDER BY h.id DESC LIMIT 200`,
      [tid]
    );
  } catch (e) { rows = []; }
  if (allowed !== null) rows = rows.filter((r) => !r.class_id || allowed.includes(r.class_id));
  if (wantClass) rows = rows.filter((r) => Number(r.class_id) === wantClass);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  ok(res, { homework: rows });
}));

router.post("/homework", requireRole("madrasa_admin", "teacher"), ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const title = cleanStr(b.title, 200);
  if (!title) return err(res, 400, "title is required.");
  const classId = b.class_id ? toNum(b.class_id, 0) : null;
  const subjectId = b.subject_id ? toNum(b.subject_id, 0) : null;
  if (classId) {
    const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
    if (!c) return err(res, 400, "Unknown class.");
  }
  if (subjectId) {
    const s = await db.get("SELECT id FROM subjects WHERE id = ? AND madrasa_id = ?", [subjectId, tid]);
    if (!s) return err(res, 400, "Unknown subject.");
  }
  const due = b.due_date ? validDate(b.due_date) : null;
  if (b.due_date && !due) return err(res, 400, "due_date must be YYYY-MM-DD.");
  const kind = ["lesson", "assignment"].includes(cleanStr(b.kind, 20)) ? cleanStr(b.kind, 20) : "assignment";
  const r = await db.run(
    "INSERT INTO homework (madrasa_id, class_id, subject_id, title, details, due_date, kind, created_by) VALUES (?,?,?,?,?,?,?,?)",
    [tid, classId, subjectId, title, cleanStr(b.details, 5000), due, kind, req.user.id]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "homework.create", entity: "homework", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.delete("/homework/:id", requireRole("madrasa_admin", "teacher"), ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const h = await db.get("SELECT * FROM homework WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!h) return res.status(404).json({ error: "Homework not found." });
  if (req.user.role !== "madrasa_admin" && Number(h.created_by) !== Number(req.user.id)) {
    return res.status(403).json({ error: "You can only delete homework you created." });
  }
  await db.run("DELETE FROM homework WHERE id = ?", [h.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ my attendance -------------------------- */

router.get("/my-attendance", ...gate, asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  let studentIds = [];
  if (req.user.role === "student") {
    if (req.user.studentId) studentIds = [req.user.studentId];
  } else if (req.user.role === "parent") {
    const rows = await db.all("SELECT student_id FROM parent_links WHERE madrasa_id = ? AND user_id = ?", [tid, req.user.id]);
    studentIds = rows.map((r) => r.student_id);
  } else {
    return res.status(403).json({ error: "Staff should use the class attendance register." });
  }
  const out = [];
  for (const sid of studentIds) {
    const stu = await db.get(
      "SELECT s.id, s.admission_no, s.first_name, s.last_name, s.name_ar, c.name_en AS class_en FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND s.madrasa_id = ?",
      [sid, tid]
    );
    if (!stu) continue;
    const rows = await db.all("SELECT day, status FROM attendance WHERE madrasa_id = ? AND student_id = ? ORDER BY day DESC LIMIT 90", [tid, sid]);
    const counts = { present: 0, absent: 0, excused: 0 };
    rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });
    out.push({ student: stu, records: rows, counts });
  }
  ok(res, { attendance: out });
}));

/* ------------------------------ users ---------------------------------- */

router.get("/users", requireRole("madrasa_admin"), ...gate, requireStaffPermission("users.manage"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const rows = await db.all(
    "SELECT id, username, role, full_name, full_name_ar, email, phone, is_active, student_id, created_at FROM users WHERE madrasa_id = ? ORDER BY role, full_name",
    [tid]
  );
  ok(res, { users: rows });
}));

router.patch("/users/:id", requireRole("madrasa_admin"), ...gate, requireStaffPermission("users.manage"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const u = await db.get("SELECT * FROM users WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!u) return res.status(404).json({ error: "User not found." });
  if (Number(u.id) === Number(req.user.id)) return err(res, 400, "You cannot deactivate your own account.");
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.is_active !== undefined) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
  if (b.full_name !== undefined) { sets.push("full_name = ?"); vals.push(cleanStr(b.full_name, 160)); }
  if (b.phone !== undefined) { sets.push("phone = ?"); vals.push(cleanStr(b.phone, 60)); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(u.id);
  await db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "user.update", entity: "user", entityId: String(u.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
