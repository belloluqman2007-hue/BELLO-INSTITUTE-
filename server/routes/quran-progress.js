"use strict";
/* ============================================================================
   EduSphere — Qur'an / Hifz progress module
   ----------------------------------------------------------------------------
   This is deliberately a small category-specific module, not a fork of the
   education platform. It uses the same authenticated tenant context, students
   and teacher assignments as every other academic record. Western tenants are
   denied at the route boundary, so Hifz tracking can never leak into their
   experience or require special branches throughout shared CRUD routes.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, clampNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments, teacherCanMarkAttendance } = require("../middleware/tenant");
const { CATEGORY_CONFIG } = require("../services/institution");

const router = express.Router();
router.use(requireAuth, requireTenant);

const PERFORMANCE_STATUSES = new Set(["excellent", "good", "developing", "needs_support", "needs_revision"]);

function todayIso() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function hifzStaff(req, res) {
  if (["madrasa_admin", "teacher", "super_admin"].includes(req.user.role)) return true;
  err(res, 403, "Only administrators and teachers can access Qur'an progress.");
  return false;
}

function hifzAdmin(req, res) {
  if (["madrasa_admin", "super_admin"].includes(req.user.role)) return true;
  err(res, 403, "Only an administrator can change Qur'an progress settings.");
  return false;
}

async function getContext(req, res, options = {}) {
  const tid = effectiveTenantId(req);
  if (!tid) { err(res, 400, "Institution context required."); return null; }
  const madrasa = await db.get("SELECT id, category, status FROM madaris WHERE id = ?", [tid]);
  if (!madrasa || madrasa.status !== "active") { err(res, 404, "Institution not found."); return null; }
  // This is the one category gate. All record and scope operations below are
  // generic and remain independent of the institution vocabulary.
  const category = CATEGORY_CONFIG[madrasa.category];
  if (!category || !category.hifzEnabledByDefault) { err(res, 404, "Qur'an progress is not enabled for this academy."); return null; }
  const row = await db.get("SELECT value FROM settings WHERE madrasa_id = ? AND key_name = 'hifz_progress_enabled'", [tid]);
  const enabled = !row || String(row.value) !== "0";
  if (!enabled && !options.allowDisabled) { err(res, 403, "Qur'an / Hifz progress is currently disabled in Institution Settings."); return null; }
  return { tid, madrasa, enabled };
}

async function studentInScope(req, res, tid, studentId) {
  const student = await db.get(
    "SELECT s.*, c.name_en AS class_en FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND s.madrasa_id = ?",
    [studentId, tid]
  );
  if (!student) { err(res, 404, "Student not found."); return null; }
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!student.class_id || !teacherCanMarkAttendance(scope, Number(student.class_id))) {
      err(res, 404, "Student not found.");
      return null;
    }
  }
  return student;
}

function optionalScore(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) return { error: `${label} must be a score from 1 to 5.` };
  return { value: Math.round(n) };
}

/** Validates both snake_case API fields and camelCase UI fields. */
function recordFields(body, partial) {
  const b = body || {};
  const data = {};
  const has = (key, alternate) => b[key] !== undefined || (alternate && b[alternate] !== undefined);
  const value = (key, alternate) => b[key] !== undefined ? b[key] : b[alternate];

  if (has("progress_date", "date")) {
    const date = validDate(value("progress_date", "date"));
    if (!date) return { error: "A valid progress date (YYYY-MM-DD) is required." };
    data.progress_date = date;
  } else if (!partial) data.progress_date = todayIso();

  if (has("surah")) data.surah = cleanStr(b.surah, 80);
  if (has("juz")) data.juz = cleanStr(b.juz, 20);
  if (has("ayah_from", "ayahFrom")) {
    const n = toNum(value("ayah_from", "ayahFrom"), 0);
    if (n < 0 || n > 286) return { error: "Ayah start must be between 0 and 286." };
    data.ayah_from = n || null;
  }
  if (has("ayah_to", "ayahTo")) {
    const n = toNum(value("ayah_to", "ayahTo"), 0);
    if (n < 0 || n > 286) return { error: "Ayah end must be between 0 and 286." };
    data.ayah_to = n || null;
  }
  const from = data.ayah_from;
  const to = data.ayah_to;
  if (from && to && to < from) return { error: "Ayah end must not come before the ayah start." };

  if (has("memorization_progress", "memorizationProgress")) data.memorization_progress = clampNum(value("memorization_progress", "memorizationProgress"), 0, 100, 0);
  if (has("revision_progress", "revisionProgress")) data.revision_progress = clampNum(value("revision_progress", "revisionProgress"), 0, 100, 0);
  if (has("recitation_assessment", "recitationAssessment")) {
    const score = optionalScore(value("recitation_assessment", "recitationAssessment"), "Recitation assessment");
    if (score.error) return score;
    data.recitation_assessment = score.value;
  }
  if (has("tajweed_assessment", "tajweedAssessment")) {
    const score = optionalScore(value("tajweed_assessment", "tajweedAssessment"), "Tajweed assessment");
    if (score.error) return score;
    data.tajweed_assessment = score.value;
  }
  if (has("teacher_comments", "teacherComments")) data.teacher_comments = cleanStr(value("teacher_comments", "teacherComments"), 3000);
  if (has("performance_status", "performanceStatus")) {
    const status = cleanStr(value("performance_status", "performanceStatus"), 30).toLowerCase();
    if (status && !PERFORMANCE_STATUSES.has(status)) return { error: "Performance status must be excellent, good, developing, needs support, or needs revision." };
    data.performance_status = status || "developing";
  }

  if (!partial && !data.surah && !data.juz) return { error: "Provide at least a Surah or Juz for this progress entry." };
  return { data };
}

async function saveSetting(tid, key, value) {
  const dialect = await db.dialect();
  if (dialect === "sqlite") {
    return db.run("INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON CONFLICT(madrasa_id, key_name) DO UPDATE SET value = excluded.value", [tid, key, value]);
  }
  return db.run("INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [tid, key, value]);
}

/* -------------------------- module configuration ----------------------- */
router.get("/config", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res, { allowDisabled: true });
  if (!ctx) return;
  ok(res, { enabled: ctx.enabled, category: ctx.madrasa.category, statuses: [...PERFORMANCE_STATUSES] });
}));

router.put("/config", asyncHandler(async (req, res) => {
  if (!hifzAdmin(req, res)) return;
  const ctx = await getContext(req, res, { allowDisabled: true });
  if (!ctx) return;
  const enabled = !!((req.body || {}).enabled);
  await saveSetting(ctx.tid, "hifz_progress_enabled", enabled ? "1" : "0");
  logActivity(db, { madrasaId: ctx.tid, userId: req.user.id, action: "hifz.settings", entity: "settings", entityId: String(ctx.tid), meta: { enabled }, ip: req.ip });
  ok(res, { ok: true, enabled });
}));

/* ----------------------------- summaries -------------------------------- */
router.get("/overview", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;
  const [totals, statuses, latest] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS records, COUNT(DISTINCT student_id) AS students,
              COALESCE(AVG(memorization_progress),0) AS memorization_average,
              COALESCE(AVG(revision_progress),0) AS revision_average
         FROM quran_progress WHERE madrasa_id = ?`,
      [ctx.tid]
    ),
    db.all("SELECT performance_status, COUNT(*) AS count FROM quran_progress WHERE madrasa_id = ? GROUP BY performance_status", [ctx.tid]),
    db.all(
      `SELECT qp.*, s.first_name, s.last_name, s.admission_no, c.name_en AS class_en
         FROM quran_progress qp
         JOIN students s ON s.id = qp.student_id AND s.madrasa_id = qp.madrasa_id
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE qp.madrasa_id = ? ORDER BY qp.progress_date DESC, qp.id DESC LIMIT 5`,
      [ctx.tid]
    ),
  ]);
  ok(res, {
    enabled: true,
    totals: {
      records: Number(totals.records || 0),
      students: Number(totals.students || 0),
      memorizationAverage: Math.round(Number(totals.memorization_average || 0)),
      revisionAverage: Math.round(Number(totals.revision_average || 0)),
    },
    byStatus: statuses.map((row) => ({ status: row.performance_status, count: Number(row.count || 0) })),
    latest,
  });
}));

/* ---------------------------- record CRUD ------------------------------ */

/**
 * GET /api/quran-progress/me — the family's read-only view of the same
 * records staff manage: a student sees their own progress, a parent sees each
 * linked child's. Records are never writable from the portal, and the
 * category gate (Islamic institutions only) applies exactly as it does for
 * staff.
 */
router.get("/me", asyncHandler(async (req, res) => {
  if (!["student", "parent"].includes(req.user.role)) {
    return err(res, 403, "Staff should use the Qur'an progress workspace.");
  }
  const ctx = await getContext(req, res);
  if (!ctx) return;
  let studentIds = [];
  if (req.user.role === "student") {
    if (req.user.studentId) studentIds = [Number(req.user.studentId)];
  } else {
    const rows = await db.all("SELECT student_id FROM parent_links WHERE madrasa_id = ? AND user_id = ?", [ctx.tid, req.user.id]);
    studentIds = rows.map((r) => Number(r.student_id));
  }
  if (!studentIds.length) return ok(res, { records: [], students: [] });
  const marks = studentIds.map(() => "?").join(",");
  const records = await db.all(
    `SELECT qp.*, s.first_name, s.last_name, c.name_en AS class_en
       FROM quran_progress qp
       JOIN students s ON s.id = qp.student_id AND s.madrasa_id = qp.madrasa_id
       LEFT JOIN classes c ON c.id = s.class_id
      WHERE qp.madrasa_id = ? AND qp.student_id IN (${marks})
      ORDER BY qp.progress_date DESC, qp.id DESC LIMIT 100`,
    [ctx.tid].concat(studentIds)
  );
  const students = await db.all(
    `SELECT s.id, s.first_name, s.last_name FROM students s WHERE s.madrasa_id = ? AND s.id IN (${marks})`,
    [ctx.tid].concat(studentIds)
  );
  ok(res, { records, students });
}));
router.get("/", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;
  const studentId = req.query.studentId ? toNum(req.query.studentId, 0) : null;
  if (req.query.studentId && !studentId) return err(res, 400, "studentId must be a valid student id.");
  if (studentId && !await studentInScope(req, res, ctx.tid, studentId)) return;
  const limit = Math.min(250, Math.max(1, toNum(req.query.limit, 100)));
  const where = ["qp.madrasa_id = ?"]; const values = [ctx.tid];
  if (studentId) { where.push("qp.student_id = ?"); values.push(studentId); }
  if (req.query.status) { where.push("qp.performance_status = ?"); values.push(cleanStr(req.query.status, 30)); }
  const records = await db.all(
    `SELECT qp.*, s.first_name, s.last_name, s.admission_no, c.name_en AS class_en,
            u.full_name AS recorded_by_name
       FROM quran_progress qp
       JOIN students s ON s.id = qp.student_id AND s.madrasa_id = qp.madrasa_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN users u ON u.id = qp.recorded_by
      WHERE ${where.join(" AND ")}
      ORDER BY qp.progress_date DESC, qp.id DESC LIMIT ?`,
    values.concat(limit)
  );
  ok(res, { records });
}));

router.post("/", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;
  const studentId = toNum((req.body || {}).student_id || (req.body || {}).studentId, 0);
  if (!studentId) return err(res, 400, "student_id is required.");
  if (!await studentInScope(req, res, ctx.tid, studentId)) return;
  const parsed = recordFields(req.body, false);
  if (parsed.error) return err(res, 400, parsed.error);
  const d = parsed.data;
  const result = await db.run(
    `INSERT INTO quran_progress
       (madrasa_id, student_id, surah, juz, ayah_from, ayah_to, memorization_progress, revision_progress,
        recitation_assessment, tajweed_assessment, teacher_comments, progress_date, performance_status, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ctx.tid, studentId, d.surah || "", d.juz || "", d.ayah_from || null, d.ayah_to || null,
      d.memorization_progress || 0, d.revision_progress || 0, d.recitation_assessment || null,
      d.tajweed_assessment || null, d.teacher_comments || "", d.progress_date, d.performance_status || "developing", req.user.id]
  );
  logActivity(db, { madrasaId: ctx.tid, userId: req.user.id, action: "hifz.progress.create", entity: "quran_progress", entityId: String(result.lastInsertRowid), meta: { studentId, surah: d.surah || "", juz: d.juz || "" }, ip: req.ip });
  ok(res, { ok: true, id: result.lastInsertRowid });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;
  const record = await db.get("SELECT * FROM quran_progress WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), ctx.tid]);
  if (!record) return err(res, 404, "Qur'an progress record not found.");
  if (req.user.role === "teacher") {
    if (Number(record.recorded_by) !== Number(req.user.id)) return err(res, 404, "Qur'an progress record not found.");
    if (!await studentInScope(req, res, ctx.tid, Number(record.student_id))) return;
  }
  const parsed = recordFields(req.body, true);
  if (parsed.error) return err(res, 400, parsed.error);
  const entries = Object.entries(parsed.data);
  if (!entries.length) return err(res, 400, "Nothing to update.");
  // Partial updates still have to preserve a sensible ayah range alongside
  // the record's existing boundary (e.g. PATCH ayah_to must not cross below
  // a saved ayah_from).
  const finalFrom = Object.prototype.hasOwnProperty.call(parsed.data, "ayah_from") ? parsed.data.ayah_from : record.ayah_from;
  const finalTo = Object.prototype.hasOwnProperty.call(parsed.data, "ayah_to") ? parsed.data.ayah_to : record.ayah_to;
  if (finalFrom && finalTo && Number(finalTo) < Number(finalFrom)) return err(res, 400, "Ayah end must not come before the ayah start.");
  const sets = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);
  values.push(record.id);
  await db.run(`UPDATE quran_progress SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
  logActivity(db, { madrasaId: ctx.tid, userId: req.user.id, action: "hifz.progress.update", entity: "quran_progress", entityId: String(record.id), ip: req.ip });
  ok(res, { ok: true });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  if (!hifzStaff(req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;
  const record = await db.get("SELECT * FROM quran_progress WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), ctx.tid]);
  if (!record) return err(res, 404, "Qur'an progress record not found.");
  if (req.user.role === "teacher") {
    if (Number(record.recorded_by) !== Number(req.user.id)) return err(res, 404, "Qur'an progress record not found.");
    if (!await studentInScope(req, res, ctx.tid, Number(record.student_id))) return;
  }
  await db.run("DELETE FROM quran_progress WHERE id = ?", [record.id]);
  logActivity(db, { madrasaId: ctx.tid, userId: req.user.id, action: "hifz.progress.delete", entity: "quran_progress", entityId: String(record.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = router;
