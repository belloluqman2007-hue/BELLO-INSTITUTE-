"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Student & Parent portals
   ----------------------------------------------------------------------------
   student:  own profile, results history, report card, announcements.
   parent:   linked children (parent_links), their results, report cards,
             announcements. A parent can NEVER see a child they are not
             linked to (backend-enforced).
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, toNum } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");
const grading = require("../services/grading");
const { renderReportCard } = require("./results");

const router = express.Router();
router.use(requireAuth, requireTenant, requireRole("student", "parent"));

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

/** Resolves the student rows this user is allowed to see. */
async function accessibleStudents(req, tid) {
  if (req.user.role === "student") {
    const row = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [req.user.studentId, tid]);
    return row ? [row] : [];
  }
  // parent: linked children only
  return db.all(
    `SELECT s.* FROM students s
     JOIN parent_links pl ON pl.student_id = s.id AND pl.madrasa_id = s.madrasa_id
     WHERE pl.madrasa_id = ? AND pl.user_id = ? AND s.madrasa_id = ?`,
    [tid, req.user.id, tid]
  );
}

/* ------------------------------ me / profile --------------------------- */

router.get("/me", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const students = await accessibleStudents(req, tid);
  const madrasa = await db.get("SELECT name_en, name_ar, logo_path, motto_en, motto_ar FROM madaris WHERE id = ?", [tid]);
  const out = {
    role: req.user.role,
    user: { id: req.user.id, username: req.user.username, fullName: req.user.fullName },
    madrasa,
    children: [],
  };
  for (const s of students) {
    const cls = s.class_id ? await db.get("SELECT name_en, name_ar FROM classes WHERE id = ?", [s.class_id]) : null;
    out.children.push(Object.assign({}, s, {
      classEn: cls ? cls.name_en : "",
      classAr: cls ? cls.name_ar : "",
    }));
  }
  if (req.user.role === "student" && out.children.length) out.self = out.children[0];
  ok(res, out);
}));

/* ------------------------------ results -------------------------------- */

/**
 * GET /api/portal/results?studentId=
 * student: own (studentId must equal their linked student id).
 * parent:  must be a linked child.
 */
router.get("/results", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const students = await accessibleStudents(req, tid);
  const byId = new Map(students.map((s) => [s.id, s]));
  let target;
  if (req.user.role === "student") {
    target = byId.get(req.user.studentId);
  } else {
    const want = toNum(req.query.studentId, 0);
    target = byId.get(want) || null;
    if (!target) return err(res, 400, "studentId is required.");
  }
  if (!target) return err(res, 404, { error: "No student record found." });

  const summaries = await db.all(
    `SELECT ts.*, t.name_en AS term_name, t.name_ar AS term_name_ar, t.position AS term_position,
            a.label AS session_label
     FROM term_summaries ts
     JOIN terms t ON t.id = ts.term_id
     JOIN academic_sessions a ON a.id = ts.session_id
     WHERE ts.madrasa_id = ? AND ts.student_id = ?
     ORDER BY a.id DESC, t.position DESC`,
    [tid, target.id]
  );
  ok(res, {
    student: { id: target.id, admissionNo: target.admission_no, name: `${target.first_name} ${target.last_name}`.trim(), nameAr: target.name_ar, classEn: target.class_en, classAr: target.class_ar },
    terms: summaries,
  });
}));

/** Full subject detail for one term (for the portal results page). */
router.get("/results/:termId", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const termId = toNum(req.params.termId, 0);
  const students = await accessibleStudents(req, tid);
  const byId = new Map(students.map((s) => [s.id, s]));
  let target;
  if (req.user.role === "student") target = byId.get(req.user.studentId);
  else target = byId.get(toNum(req.query.studentId, 0));
  if (!target) return err(res, 404, { error: "Not found." });

  const cfg = await grading.getGradingConfig(tid);
  const rows = await db.all(
    `SELECT r.*, su.name_en, su.name_ar FROM results r
     JOIN subjects su ON su.id = r.subject_id
     WHERE r.madrasa_id = ? AND r.student_id = ? AND r.term_id = ?
     ORDER BY su.name_en`,
    [tid, target.id, termId]
  );
  const subjects = rows.map((r) => {
    const pct = grading.pctOf(cfg, r.total);
    const g = grading.gradeForPct(cfg, pct);
    return {
      nameEn: r.name_en, nameAr: r.name_ar,
      ca: Number(r.ca), exam: Number(r.exam), total: Number(r.total),
      pct: Math.round(pct * 10) / 10, grade: g.grade, remark: g.remark, remarkAr: g.remark_ar,
      pass: pct >= cfg.passMark,
    };
  });
  ok(res, { studentId: target.id, termId, subjects });
}));

/* ------------------------------ report card ---------------------------- */

/**
 * GET /api/portal/report-card?termId=&studentId=  -> printable HTML
 * (studentId required for parents; must be a linked child)
 */
router.get("/report-card", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const termId = toNum(req.query.termId, 0);
  if (!termId) return err(res, 400, "termId is required.");
  const students = await accessibleStudents(req, tid);
  const byId = new Map(students.map((s) => [s.id, s]));
  let target;
  if (req.user.role === "student") target = byId.get(req.user.studentId);
  else target = byId.get(toNum(req.query.studentId, 0));
  if (!target) return err(res, 404, { error: "Report card not found." });

  const data = await grading.reportCardData(tid, target.id, termId);
  if (!data) return err(res, 404, { error: "Report card not found. Results may not be computed yet." });
  res.type("html").send(renderReportCard(data));
}));

/* ------------------------------ announcements -------------------------- */

router.get("/announcements", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const aud = req.user.role === "student" ? "students" : "parents";
  const rows = await db.all(
    "SELECT id, title, body, audience, created_at FROM announcements WHERE madrasa_id = ? AND is_active = 1 AND (audience = 'all' OR audience = ?) ORDER BY created_at DESC, id DESC LIMIT 100",
    [tid, aud]
  );
  ok(res, { announcements: rows });
}));

module.exports = router;
