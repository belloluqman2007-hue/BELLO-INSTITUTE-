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
  await db.run("UPDATE announcements SET status='published', is_active=1, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE madrasa_id=? AND status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=CURRENT_TIMESTAMP", [tid]);
  const candidates = await db.all(
    "SELECT id, title, body, audience, target_type, target_ids, created_at FROM announcements WHERE madrasa_id = ? AND is_active = 1 AND status = 'published' AND (scheduled_at IS NULL OR scheduled_at <= CURRENT_TIMESTAMP) ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 200",
    [tid]
  );
  const students = await accessibleStudents(req, tid);
  const allowedStudentIds = new Set(students.map((s) => Number(s.id)));
  const allowedClasses = new Set(students.map((s) => Number(s.class_id)).filter(Boolean));
  const visible = candidates.filter((a) => {
    const type = String(a.target_type || a.audience || 'all');
    if (type === 'all' || type === 'institution' || a.audience === 'all' || a.audience === aud) return true;
    if (type === 'students' || type === 'parents') return type === aud;
    let targetIds = []; try { targetIds = JSON.parse(a.target_ids || '[]').map(Number); } catch (_) {}
    if (type === 'individual_users') return targetIds.includes(Number(req.user.id));
    if (type === 'specific_class') return students.some((s) => targetIds.includes(Number(s.class_id)));
    if (type === 'specific_student_group') return false; // group membership is evaluated below when present
    if (type === 'islamic_section' || type === 'western_section') return students.some((s) => String(s.section || '').toLowerCase().includes(type.split('_')[0]) || String(s.education_track || '').toLowerCase() === type.split('_')[0] || s.education_track === 'both');
    return false;
  });
  // Groups are resolved against the existing group-member and parent-link rows;
  // this avoids broadening a private announcement to every portal user.
  for (const a of candidates.filter((x) => x.target_type === 'specific_student_group')) {
    let groupIds = []; try { groupIds = JSON.parse(a.target_ids || '[]').map(Number); } catch (_) {}
    if (!groupIds.length) continue;
    const marks = groupIds.map(() => '?').join(',');
    const rows = await db.all(`SELECT DISTINCT s.id FROM student_group_members gm JOIN students s ON s.id=gm.student_id AND s.madrasa_id=gm.madrasa_id WHERE gm.madrasa_id=? AND gm.group_id IN (${marks})`, [tid].concat(groupIds));
    const childIds = new Set(rows.map((r) => Number(r.id)));
    const allowed = req.user.role === 'student' ? childIds.has(Number(req.user.studentId)) : students.some((s) => childIds.has(Number(s.id)));
    if (allowed && !visible.includes(a)) visible.push(a);
  }
  ok(res, { announcements: visible });
}));

module.exports = router;
