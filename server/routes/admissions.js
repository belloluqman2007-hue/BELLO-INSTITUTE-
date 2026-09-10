"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — online admission applications (admin side)
   ----------------------------------------------------------------------------
   The public site writes rows into admission_requests (routes/public.js); this
   router is the review queue for a madrasa:

     GET    /api/admissions?status=pending&q=&page=
     GET    /api/admissions/:id
     POST   /api/admissions/:id/approve     → creates the student (+ optional
                                               parent / student portal accounts)
     POST   /api/admissions/:id/reject      → status + note
     POST   /api/admissions/:id/hold        → "on hold", with a note
     DELETE /api/admissions/:id             → discard the application only

   Isolation: a madrasa admin only ever sees their own rows (tenant id comes
   from the session). A super admin may list platform-wide or pass
   ?madrasaId=N to work inside one tenant.
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity, checkPlanLimits } = require("../util");
const { requireAuth, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const admission = require("../services/admission");

const router = express.Router();
router.use(requireAuth);

const ADMIN = requireRole("madrasa_admin", "super_admin");

/** Resolves which tenant this call operates on. */
async function resolveTenant(req, res) {
  if (req.user.role === "madrasa_admin") return req.user.madrasaId;
  const mid = toNum((req.query && req.query.madrasaId) || (req.body && req.body.madrasa_id) || 0);
  if (!mid) return null; // platform-wide list for super admin
  const m = await db.get("SELECT id FROM madaris WHERE id = ?", [mid]);
  if (!m) { err(res, 404, "Madrasa not found."); return undefined; }
  return m.id;
}

async function loadRequest(req, res, id) {
  const tid = await resolveTenant(req, res);
  if (tid === undefined) return null;
  const row = await db.get("SELECT * FROM admission_requests WHERE id = ?", [toNum(id, 0)]);
  if (!row) { err(res, 404, "Application not found."); return null; }
  if (tid !== null && Number(row.madrasa_id) !== Number(tid)) { err(res, 404, "Application not found."); return null; }
  return row;
}

router.get("/", asyncHandler(async (req, res) => {
  const tid = await resolveTenant(req, res);
  if (tid === undefined) return;
  const status = ["pending", "approved", "rejected", "on_hold"].includes(cleanStr(req.query.status, 20)) ? cleanStr(req.query.status, 20) : "";
  const q = cleanStr(req.query.q, 80).toLowerCase();
  const page = Math.max(1, toNum(req.query.page, 1));
  const perPage = Math.min(200, Math.max(1, toNum(req.query.perPage, 50)));

  const where = [];
  const params = [];
  if (tid !== null) { where.push("a.madrasa_id = ?"); params.push(tid); }
  if (status) { where.push("a.status = ?"); params.push(status); }
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const rows = await db.all(
    `SELECT a.*, c.name_en AS class_name, m.name_en AS madrasa_name, m.slug AS madrasa_slug
     FROM admission_requests a
     LEFT JOIN classes c ON c.id = a.class_id
     LEFT JOIN madaris m ON m.id = a.madrasa_id
     ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    params.concat([perPage, (page - 1) * perPage])
  );
  const counts = await db.all("SELECT status, COUNT(*) AS n FROM admission_requests" + (tid !== null ? " WHERE madrasa_id = ?" : "") + " GROUP BY status", tid !== null ? [tid] : []);
  const byStatus = { pending: 0, approved: 0, rejected: 0, "on_hold": 0 };
  counts.forEach((c) => { byStatus[c.status] = Number(c.n); });
  const filtered = q
    ? rows.filter((r) => [r.first_name, r.last_name, r.parent_name, r.parent_phone, r.reference].filter(Boolean).join(" ").toLowerCase().includes(q))
    : rows;
  ok(res, { requests: filtered, total: filtered.length, page, perPage, byStatus });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  const cls = row.class_id ? await db.get("SELECT id, name_en, name_ar FROM classes WHERE id = ?", [row.class_id]) : null;
  const student = row.student_id ? await db.get("SELECT id, admission_no, first_name, last_name, status FROM students WHERE id = ?", [row.student_id]) : null;
  ok(res, { request: row, class: cls, student });
}));

/** Approve → create the student (and, optionally, portal accounts). */
router.post("/:id/approve", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  if (row.status === "approved" && row.student_id) return err(res, 400, "This application was already approved.");
  const b = req.body || {};
  const tid = row.madrasa_id;

  const limits = await checkPlanLimits(db, tid, "student");
  if (!limits.allowed) return err(res, 403, limits.message);

  const classId = b.class_id ? toNum(b.class_id, 0) : row.class_id || null;
  if (classId) {
    const c = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
    if (!c) return err(res, 400, "Unknown class.");
  }
  const session = await db.get("SELECT id FROM academic_sessions WHERE madrasa_id = ? ORDER BY is_current DESC, id DESC LIMIT 1", [tid]);
  const admissionNo = cleanStr(b.admission_no, 60).toUpperCase() || (await admission.nextAdmissionNo(tid)).admissionNo;
  const clash = await db.get("SELECT id FROM students WHERE madrasa_id = ? AND admission_no = ?", [tid, admissionNo]);
  if (clash) return err(res, 400, "That admission number is already in use.");

  const out = { studentId: 0, username: "", portalCreated: false };
  try {
    await db.transaction(async (tx) => {
      // Placeholders are generated from the column list, so a column can never
      // be added without its value (that mismatch is a 500 otherwise).
      const stuCols = ["madrasa_id", "admission_no", "first_name", "last_name", "name_ar", "gender", "date_of_birth",
        "class_id", "session_id", "status", "parent_name", "parent_phone", "address", "notes", "source_request_id"];
      const stuVals = [
        tid, admissionNo, row.first_name, row.last_name, row.name_ar || "", row.gender || "", row.date_of_birth || null,
        classId, session ? session.id : null, "active", row.parent_name, row.parent_phone, row.address || "",
        cleanStr(b.notes, 2000) || ("Admitted from online application " + row.reference), row.id,
      ];
      if (stuVals.length !== stuCols.length) throw new Error("internal: students insert column/value mismatch");
      const r = await tx.run(
        `INSERT INTO students (${stuCols.join(", ")}) VALUES (${stuCols.map(() => "?").join(", ")})`,
        stuVals
      );
      out.studentId = r.lastInsertRowid;

      // Optional: student portal account (username from admission number).
      const makeStudent = b.create_student_account === true || b.create_student_account === "true";
      const makeParent = b.create_parent_account === true || b.create_parent_account === "true";
      const password = String(b.password || "");
      if ((makeStudent || makeParent) && password.length < 8) {
        throw Object.assign(new Error("Portal password must be at least 8 characters."), { status: 400 });
      }
      const hash = (makeStudent || makeParent) ? bcrypt.hashSync(password, 10) : "";
      if (makeStudent) {
        const username = cleanStr(b.student_username, 100).toLowerCase() || admissionNo.toLowerCase();
        const taken = await tx.get("SELECT id FROM users WHERE username = ?", [username]);
        if (taken) throw Object.assign(new Error("Username " + username + " is already taken."), { status: 400 });
        await tx.run(
          "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, student_id) VALUES (?,?,?,?,?,?)",
          [tid, username, hash, "student", `${row.first_name} ${row.last_name}`.trim(), out.studentId]
        );
        out.portalCreated = true;
        out.username = username;
      }
      if (makeParent) {
        const username = cleanStr(b.parent_username, 100).toLowerCase() || (admissionNo.toLowerCase() + "-p");
        const taken = await tx.get("SELECT id FROM users WHERE username = ?", [username]);
        if (taken) throw Object.assign(new Error("Username " + username + " is already taken."), { status: 400 });
        const pr = await tx.run(
          "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, email, phone) VALUES (?,?,?,?,?,?,?)",
          [tid, username, hash, "parent", row.parent_name || "Parent", cleanStr(row.parent_email, 120), row.parent_phone]
        );
        await tx.run("INSERT INTO parent_links (madrasa_id, user_id, student_id) VALUES (?,?,?)", [tid, pr.lastInsertRowid, out.studentId]);
        out.portalCreated = true;
        out.parentUsername = username;
      }

      await tx.run(
        `UPDATE admission_requests SET status = 'approved', student_id = ?, reviewed_by = ?,
               reviewed_at = CURRENT_TIMESTAMP, review_note = ?, admission_no_assigned = ? WHERE id = ?`,
        [out.studentId, req.user.id, cleanStr(b.note, 1000), admissionNo, row.id]
      );
    });
  } catch (e) {
    if (e && e.status === 400) return err(res, 400, e.message);
    console.error("Admission approval failed:", e);
    return err(res, 500, "Could not admit this student. Nothing was saved — please try again.");
  }

  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "admission.approve", entity: "student", entityId: String(out.studentId), meta: { reference: row.reference, admissionNo }, ip: req.ip });
  ok(res, { ok: true, studentId: out.studentId, admissionNo, portalCreated: out.portalCreated, username: out.username, parentUsername: out.parentUsername || "" });
}));

async function setStatus(req, res, status) {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  await db.run(
    "UPDATE admission_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?",
    [status, req.user.id, cleanStr((req.body && req.body.note) || "", 1000), row.id]
  );
  logActivity(db, { madrasaId: row.madrasa_id, userId: req.user.id, action: "admission." + status, entity: "admission_request", entityId: String(row.id), meta: { reference: row.reference }, ip: req.ip });
  ok(res, { ok: true, status });
}

router.post("/:id/reject", ADMIN, asyncHandler((req, res) => setStatus(req, res, "rejected")));
router.post("/:id/hold", ADMIN, asyncHandler((req, res) => setStatus(req, res, "on_hold")));
router.post("/:id/reopen", ADMIN, asyncHandler((req, res) => setStatus(req, res, "pending")));

router.delete("/:id", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  if (row.student_id) return err(res, 400, "This application was admitted — delete the student record instead.");
  await db.run("DELETE FROM admission_requests WHERE id = ?", [row.id]);
  logActivity(db, { madrasaId: row.madrasa_id, userId: req.user.id, action: "admission.delete", entity: "admission_request", entityId: String(row.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
