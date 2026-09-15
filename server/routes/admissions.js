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
const fs = require("fs");
const path = require("path");
const db = require("../db");
const config = require("../config");
const { asyncHandler, err, ok, cleanStr, toNum, logActivity, checkPlanLimits } = require("../util");
const { requireAuth, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const admission = require("../services/admission");
const { fileUploader } = require("../middleware/upload");

const applicationDocumentUploader = fileUploader("files", "document", {
  dir: path.join(config.DATA_DIR, "private-student-documents"),
  extensions: [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"],
  maxMb: 10,
});

const router = express.Router();
router.use(requireAuth, requireRole("madrasa_admin", "super_admin"));

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
  const status = ["pending", "under_review", "approved", "accepted", "rejected", "waitlisted", "needs_info", "on_hold"].includes(cleanStr(req.query.status, 20)) ? cleanStr(req.query.status, 20) : "";
  const q = cleanStr(req.query.q || req.query.search, 80).toLowerCase();
  const page = Math.max(1, toNum(req.query.page, 1));
  const perPage = Math.min(200, Math.max(1, toNum(req.query.perPage, 50)));

  const where = [];
  const params = [];
  if (tid !== null) { where.push("a.madrasa_id = ?"); params.push(tid); }
  if (status) { where.push("a.status = ?"); params.push(status); }
  if (req.query.sessionId) { where.push("a.desired_session_id = ?"); params.push(toNum(req.query.sessionId, 0)); }
  if (req.query.program) { where.push("a.program = ?"); params.push(cleanStr(req.query.program, 120)); }
  if (q) { where.push("(LOWER(a.first_name) LIKE ? OR LOWER(a.last_name) LIKE ? OR LOWER(a.parent_name) LIKE ? OR LOWER(a.parent_phone) LIKE ? OR LOWER(a.reference) LIKE ? OR LOWER(a.program) LIKE ?)"); const like = `%${q}%`; params.push(like, like, like, like, like, like); }
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const countRow = await db.get(`SELECT COUNT(*) AS n FROM admission_requests a ${whereSql}`, params);
  const rows = await db.all(
    `SELECT a.*, c.name_en AS class_name, m.name_en AS madrasa_name, m.slug AS madrasa_slug, s.label AS session_label
     FROM admission_requests a
     LEFT JOIN classes c ON c.id = a.class_id
     LEFT JOIN academic_sessions s ON s.id = a.desired_session_id
     LEFT JOIN madaris m ON m.id = a.madrasa_id
     ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    params.concat([perPage, (page - 1) * perPage])
  );
  const counts = await db.all("SELECT status, COUNT(*) AS n FROM admission_requests" + (tid !== null ? " WHERE madrasa_id = ?" : "") + " GROUP BY status", tid !== null ? [tid] : []);
  const statusCounts = { pending: 0, under_review: 0, approved: 0, accepted: 0, rejected: 0, waitlisted: 0, needs_info: 0, on_hold: 0 };
  counts.forEach((c) => { statusCounts[c.status] = Number(c.n); });
  // Keep the original compact shape for existing consumers while exposing the
  // complete workflow counts to the new student-management screen.
  const byStatus = { pending: statusCounts.pending, approved: statusCounts.approved, on_hold: statusCounts.on_hold, rejected: statusCounts.rejected };
  ok(res, { requests: rows, total: Number(countRow.n), page, perPage, totalPages: Math.max(1, Math.ceil(Number(countRow.n) / perPage)), byStatus, statusCounts });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  const cls = row.class_id ? await db.get("SELECT id, name_en, name_ar FROM classes WHERE id = ? AND madrasa_id = ?", [row.class_id, row.madrasa_id]) : null;
  const student = row.student_id ? await db.get("SELECT id, student_code, admission_no, first_name, last_name, status FROM students WHERE id = ? AND madrasa_id = ?", [row.student_id, row.madrasa_id]) : null;
  const [history, documents] = await Promise.all([
    db.all("SELECT * FROM admission_application_history WHERE application_id = ? AND madrasa_id = ? ORDER BY id DESC", [row.id, row.madrasa_id]),
    db.all("SELECT id, document_name, original_name, mime_type, file_size, created_at FROM admission_documents WHERE application_id = ? AND madrasa_id = ? ORDER BY id DESC", [row.id, row.madrasa_id]),
  ]);
  ok(res, { request: row, class: cls, student, history, documents });
}));

router.patch("/:id", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id); if (!row) return;
  const b = req.body || {}; const sets = []; const vals = [];
  const fields = [
    ["first_name", 100], ["middle_name", 100], ["last_name", 100], ["preferred_name", 100], ["name_ar", 160], ["gender", 10],
    ["nationality", 80], ["state_of_origin", 80], ["lga", 80], ["religion", 60], ["previous_school", 200], ["quran_level", 80],
    ["program", 120], ["islamic_program", 120], ["western_program", 120], ["education_track", 20], ["section", 80], ["parent_name", 160], ["father_name", 160], ["mother_name", 160],
    ["guardian_name", 160], ["guardian_relationship", 80], ["parent_phone", 60], ["alternative_phone", 60], ["parent_email", 120],
    ["address", 255], ["emergency_contact", 160], ["additional_info", 4000], ["message", 2000], ["interview_notes", 2000], ["fee_status", 20], ["fee_reference", 120],
  ];
  for (const [field, max] of fields) if (b[field] !== undefined) { sets.push(`${field} = ?`); vals.push(cleanStr(b[field], max)); }
  if (b.date_of_birth !== undefined) { const d = b.date_of_birth ? String(b.date_of_birth).slice(0, 10) : null; if (b.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return err(res, 400, "Invalid date of birth."); sets.push("date_of_birth = ?"); vals.push(d); }
  if (b.interview_date !== undefined) { const d = b.interview_date ? String(b.interview_date).slice(0, 10) : null; sets.push("interview_date = ?"); vals.push(d); }
  if (b.class_id !== undefined) { const cid = b.class_id ? toNum(b.class_id, 0) : null; if (cid && !await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [cid, row.madrasa_id])) return err(res, 400, "Unknown class."); sets.push("class_id = ?"); vals.push(cid); }
  for (const field of ["islamic_class_id", "western_class_id"]) if (b[field] !== undefined) { const cid = b[field] ? toNum(b[field], 0) : null; if (cid && !await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [cid, row.madrasa_id])) return err(res, 400, "Unknown education-track class."); sets.push(`${field} = ?`); vals.push(cid); }
  if (b.desired_session_id !== undefined) { const sid = b.desired_session_id ? toNum(b.desired_session_id, 0) : null; if (sid && !await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sid, row.madrasa_id])) return err(res, 400, "Unknown academic session."); sets.push("desired_session_id = ?"); vals.push(sid); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(row.id, row.madrasa_id);
  await db.run(`UPDATE admission_requests SET ${sets.join(", ")} WHERE id = ? AND madrasa_id = ?`, vals);
  logActivity(db, { madrasaId: row.madrasa_id, userId: req.user.id, action: "admission.update", entity: "admission_request", entityId: String(row.id), ip: req.ip });
  ok(res, { ok: true });
}));

/** Approve/convert → create the student (and, optionally, portal accounts). */
async function approveApplication(req, res) {
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
  for (const field of ["islamic_class_id", "western_class_id"]) if (row[field] && !await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [row[field], tid])) return err(res, 400, "Unknown education-track class.");
  const session = await db.get("SELECT id FROM academic_sessions WHERE madrasa_id = ? ORDER BY is_current DESC, id DESC LIMIT 1", [tid]);
  const admissionNo = cleanStr(b.admission_no, 60).toUpperCase() || (await admission.nextAdmissionNo(tid)).admissionNo;
  const clash = await db.get("SELECT id FROM students WHERE madrasa_id = ? AND admission_no = ?", [tid, admissionNo]);
  if (clash) return err(res, 400, "That admission number is already in use.");

  const out = { studentId: 0, username: "", portalCreated: false };
  try {
    await db.transaction(async (tx) => {
      // Placeholders are generated from the column list, so a column can never
      // be added without its value (that mismatch is a 500 otherwise).
      const studentCode = cleanStr(b.student_code, 60).toUpperCase() || admissionNo;
      const codeClash = await tx.get("SELECT id FROM students WHERE madrasa_id = ? AND student_code = ?", [tid, studentCode]);
      if (codeClash) throw Object.assign(new Error("That student ID is already in use."), { status: 400 });
      const stuCols = ["madrasa_id", "admission_no", "student_code", "first_name", "middle_name", "last_name", "preferred_name", "name_ar", "gender", "date_of_birth",
        "nationality", "state_of_origin", "lga", "religion", "admission_date", "class_id", "section", "islamic_class_id", "western_class_id", "islamic_program", "western_program", "session_id", "program", "education_track", "student_type", "previous_school", "previous_class", "status",
        "parent_name", "father_name", "mother_name", "guardian_name", "guardian_relationship", "parent_phone", "alternative_phone", "parent_email", "address", "residential_address", "emergency_contact", "emergency_info", "notes", "source_request_id"];
      const stuVals = [
        tid, admissionNo, studentCode, row.first_name, cleanStr(row.middle_name, 100), row.last_name, row.preferred_name || "", row.name_ar || "", row.gender || "", row.date_of_birth || null,
        row.nationality || "", row.state_of_origin || "", row.lga || "", row.religion || "", new Date().toISOString().slice(0, 10), classId, row.section || "", row.islamic_class_id || null, row.western_class_id || null, row.islamic_program || "", row.western_program || "", row.desired_session_id || (session ? session.id : null), row.program || "", row.education_track || "both", row.student_type || "new", row.previous_school || "", row.previous_class || "", "active",
        row.parent_name || "", row.father_name || "", row.mother_name || "", row.guardian_name || "", row.guardian_relationship || "", row.parent_phone || "", row.alternative_phone || "", row.parent_email || "", row.address || "", row.address || "", row.emergency_contact || "", row.additional_info || "", cleanStr(b.notes, 2000) || ("Admitted from online application " + row.reference), row.id,
      ];
      if (stuVals.length !== stuCols.length) throw new Error("internal: students insert column/value mismatch");
      const r = await tx.run(
        `INSERT INTO students (${stuCols.join(", ")}) VALUES (${stuCols.map(() => "?").join(", ")})`,
        stuVals
      );
      out.studentId = r.lastInsertRowid;
      if (classId || (row.desired_session_id || (session && session.id))) await tx.run("INSERT INTO student_class_history (madrasa_id, student_id, from_class_id, to_class_id, from_session_id, to_session_id, action, changed_by) VALUES (?,?,?,?,?,?,?,?)", [tid, out.studentId, null, classId, null, row.desired_session_id || (session ? session.id : null), "enrollment", req.user.id]);
      const applicationDocs = await tx.all("SELECT document_name, storage_path, original_name, mime_type, file_size, uploaded_by FROM admission_documents WHERE application_id = ? AND madrasa_id = ?", [row.id, tid]);
      for (const doc of applicationDocs) await tx.run("INSERT INTO student_documents (madrasa_id, student_id, document_name, storage_path, original_name, mime_type, file_size, uploaded_by) VALUES (?,?,?,?,?,?,?,?)", [tid, out.studentId, doc.document_name, doc.storage_path, doc.original_name, doc.mime_type, doc.file_size, doc.uploaded_by || req.user.id]);

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
               reviewed_at = CURRENT_TIMESTAMP, review_note = ?, admission_no_assigned = ? WHERE id = ? AND madrasa_id = ?`,
        [out.studentId, req.user.id, cleanStr(b.note, 1000), admissionNo, row.id, tid]
      );
      await tx.run("INSERT INTO admission_application_history (madrasa_id, application_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?,?)", [tid, row.id, row.status, "approved", cleanStr(b.note, 1000), req.user.id]);
    });
  } catch (e) {
    if (e && e.status === 400) return err(res, 400, e.message);
    console.error("Admission approval failed:", e);
    return err(res, 500, "Could not admit this student. Nothing was saved — please try again.");
  }

  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "admission.approve", entity: "student", entityId: String(out.studentId), meta: { reference: row.reference, admissionNo }, ip: req.ip });
  ok(res, { ok: true, studentId: out.studentId, admissionNo, portalCreated: out.portalCreated, username: out.username, parentUsername: out.parentUsername || "" });
}

router.post("/:id/approve", ADMIN, asyncHandler(approveApplication));
router.post("/:id/convert", ADMIN, asyncHandler(approveApplication));

async function setStatus(req, res, status) {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  const note = cleanStr((req.body && (req.body.note || req.body.review_note)) || "", 2000);
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE admission_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ? AND madrasa_id = ?",
      [status, req.user.id, note, row.id, row.madrasa_id]
    );
    await tx.run("INSERT INTO admission_application_history (madrasa_id, application_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?,?)", [row.madrasa_id, row.id, row.status, status, note, req.user.id]);
  });
  logActivity(db, { madrasaId: row.madrasa_id, userId: req.user.id, action: "admission." + status, entity: "admission_request", entityId: String(row.id), meta: { reference: row.reference, note }, ip: req.ip });
  ok(res, { ok: true, status });
}

router.post("/:id/reject", ADMIN, asyncHandler((req, res) => setStatus(req, res, "rejected")));
router.post("/:id/hold", ADMIN, asyncHandler((req, res) => setStatus(req, res, "on_hold")));
router.post("/:id/waitlist", ADMIN, asyncHandler((req, res) => setStatus(req, res, "waitlisted")));
router.post("/:id/request-info", ADMIN, asyncHandler((req, res) => setStatus(req, res, "needs_info")));
router.post("/:id/under-review", ADMIN, asyncHandler((req, res) => setStatus(req, res, "under_review")));
router.post("/:id/accept", ADMIN, asyncHandler((req, res) => setStatus(req, res, "accepted")));
router.post("/:id/reopen", ADMIN, asyncHandler((req, res) => setStatus(req, res, "pending")));
router.patch("/:id/review", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id); if (!row) return;
  const b = req.body || {};
  const allowed = ["pending", "under_review", "accepted", "approved", "rejected", "waitlisted", "needs_info", "on_hold"];
  const status = allowed.includes(cleanStr(b.status, 30)) ? cleanStr(b.status, 30) : row.status;
  const note = cleanStr(b.review_note || b.note, 2000);
  const sets = ["status = ?", "review_note = ?", "reviewed_by = ?", "reviewed_at = CURRENT_TIMESTAMP"]; const vals = [status, note, req.user.id];
  if (b.interview_date !== undefined) { const d = b.interview_date ? String(b.interview_date).slice(0, 10) : null; if (b.interview_date && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return err(res, 400, "Invalid interview date."); sets.push("interview_date = ?"); vals.push(d); }
  if (b.interview_notes !== undefined) { sets.push("interview_notes = ?"); vals.push(cleanStr(b.interview_notes, 2000)); }
  if (b.fee_status !== undefined) { sets.push("fee_status = ?"); vals.push(cleanStr(b.fee_status, 20)); }
  vals.push(row.id, row.madrasa_id);
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE admission_requests SET ${sets.join(", ")} WHERE id = ? AND madrasa_id = ?`, vals);
    if (row.status !== status) await tx.run("INSERT INTO admission_application_history (madrasa_id, application_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?,?)", [row.madrasa_id, row.id, row.status, status, note, req.user.id]);
  });
  ok(res, { ok: true, status });
}));

router.post("/:id/documents", ADMIN, applicationDocumentUploader, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id); if (!row) return;
  if (!req.file) return err(res, 400, "No document uploaded.");
  const name = cleanStr(req.body && req.body.document_name, 200) || cleanStr(req.file.originalname, 200);
  const r = await db.run("INSERT INTO admission_documents (madrasa_id, application_id, document_name, storage_path, original_name, mime_type, file_size, uploaded_by) VALUES (?,?,?,?,?,?,?,?)", [row.madrasa_id, row.id, name, req.file.path, cleanStr(req.file.originalname, 255), cleanStr(req.file.mimetype, 120), Number(req.file.size || 0), req.user.id]);
  ok(res, { ok: true, id: r.lastInsertRowid, documentName: name });
}));
router.get("/:id/documents/:documentId", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id); if (!row) return;
  const doc = await db.get("SELECT * FROM admission_documents WHERE id = ? AND application_id = ? AND madrasa_id = ?", [toNum(req.params.documentId, 0), row.id, row.madrasa_id]);
  if (!doc || !fs.existsSync(doc.storage_path)) return err(res, 404, "Document not found.");
  res.download(doc.storage_path, doc.original_name || doc.document_name);
}));

router.delete("/:id", ADMIN, asyncHandler(async (req, res) => {
  const row = await loadRequest(req, res, req.params.id);
  if (!row) return;
  if (row.student_id) return err(res, 400, "This application was admitted — delete the student record instead.");
  await db.run("DELETE FROM admission_requests WHERE id = ?", [row.id]);
  logActivity(db, { madrasaId: row.madrasa_id, userId: req.user.id, action: "admission.delete", entity: "admission_request", entityId: String(row.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
