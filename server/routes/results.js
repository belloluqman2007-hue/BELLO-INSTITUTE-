"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Results & report card routes
   ----------------------------------------------------------------------------
   madrasa_admin: enter results for any class/subject/term in their madrasa.
   teacher:       only for (class, subject) pairs assigned to them.
   Both:          compute class term (totals, averages, positions, promotion)
                  and read printable report cards within the tenant.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, toNum, clampNum, logActivity } = require("../util");
const { requireAuth, requireTenant } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments, teacherCanAccess } = require("../middleware/tenant");
const grading = require("../services/grading");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

/** Verifies caller may touch (classId, subjectId, termId); returns the class row or sends an error. */
async function guardAccess(req, res, tid, classId, subjectId, termId) {
  const cls = await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
  if (!cls) { res.status(404).json({ error: "Class not found." }); return null; }
  if (req.user.role === "teacher") {
    if (!subjectId) { res.status(404).json({ error: "Subject not found." }); return null; }
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!teacherCanAccess(scope, classId, subjectId)) {
      res.status(404).json({ error: "Not found." });
      return null;
    }
  }
  const term = await db.get("SELECT * FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]);
  if (!term) { res.status(404).json({ error: "Term not found." }); return null; }
  if (!["madrasa_admin", "teacher", "super_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "Permission denied." });
    return null;
  }
  return cls;
}

/* ------------------------------ gradebook roster ---------------------- */

/**
 * GET /api/results/roster?classId=&termId=&subjectId=
 * Returns every active learner in the class, even before any score exists.
 * This is the authoritative gradebook input list; /class remains available
 * for integrations that only want saved result rows.
 */
router.get("/roster", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const termId = toNum(req.query.termId, 0);
  const subjectId = toNum(req.query.subjectId, 0);
  if (!classId || !termId || !subjectId) return err(res, 400, "classId, termId and subjectId are required.");
  const cls = await guardAccess(req, res, tid, classId, subjectId, termId);
  if (!cls) return;
  const subject = await db.get("SELECT id, name_en, name_ar FROM subjects WHERE id = ? AND madrasa_id = ?", [subjectId, tid]);
  if (!subject) return err(res, 404, "Subject not found.");
  const rows = await db.all(
    `SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, s.name_ar,
            r.id AS result_id, r.ca, r.exam, r.total
       FROM students s
       LEFT JOIN results r ON r.madrasa_id = s.madrasa_id AND r.student_id = s.id
            AND r.term_id = ? AND r.subject_id = ?
      WHERE s.madrasa_id = ? AND s.class_id = ? AND s.status IN ('active','promoted','suspended')
      ORDER BY s.admission_no`,
    [termId, subjectId, tid, classId]
  );
  const cfg = await grading.getGradingConfig(tid);
  ok(res, { class: cls, subject, students: rows.map((r) => Object.assign({}, r, {
    ca: r.ca === null || r.ca === undefined ? "" : Number(r.ca),
    exam: r.exam === null || r.exam === undefined ? "" : Number(r.exam),
    total: r.total === null || r.total === undefined ? "" : Number(r.total),
  })), config: { caMax: cfg.caMax, examMax: cfg.examMax, passMark: cfg.passMark } });
}));

/* ------------------------------ read class results --------------------- */

router.get("/class", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const termId = toNum(req.query.termId, 0);
  const subjectId = req.query.subjectId ? toNum(req.query.subjectId, 0) : null;
  if (!classId || !termId) return err(res, 400, "classId and termId are required.");
  const cls = await guardAccess(req, res, tid, classId, subjectId, termId);
  if (!cls) return;

  let where = "r.madrasa_id = ? AND r.term_id = ? AND r.class_id = ?";
  const params = [tid, termId, classId];
  if (subjectId) { where += " AND r.subject_id = ?"; params.push(subjectId); }
  const rows = await db.all(
    `SELECT r.*, su.name_en AS subject_en, su.name_ar AS subject_ar,
            s.admission_no, s.first_name, s.last_name, s.name_ar
     FROM results r
     JOIN students s ON s.id = r.student_id
     JOIN subjects su ON su.id = r.subject_id
     WHERE ${where}
     ORDER BY s.admission_no`,
    params
  );
  const cfg = await grading.getGradingConfig(tid);
  const students = rows.map((r) => Object.assign({}, r, {
    pct: grading.pctOf(cfg, r.total),
    grade: grading.gradeForPct(cfg, grading.pctOf(cfg, r.total)).grade,
  }));
  ok(res, { students, config: { caMax: cfg.caMax, examMax: cfg.examMax, passMark: cfg.passMark } });
}));

/* ------------------------------ bulk entry ----------------------------- */

/**
 * Body: { classId, termId, subjectId, entries: [{ studentId, ca, exam }] }
 * Upserts each entry. CA/exam are clamped to the madrasa's maxima.
 */
router.put("/", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const classId = toNum(b.classId, 0);
  const termId = toNum(b.termId, 0);
  const subjectId = toNum(b.subjectId, 0);
  const entries = Array.isArray(b.entries) ? b.entries : [];
  if (!classId || !termId || !subjectId || !entries.length) {
    return err(res, 400, "classId, termId, subjectId and entries[] are required.");
  }
  if (entries.length > 500) return err(res, 400, "Too many entries in one request (max 500).");

  const cls = await guardAccess(req, res, tid, classId, subjectId, termId);
  if (!cls) return;
  const subj = await db.get("SELECT id FROM subjects WHERE id = ? AND madrasa_id = ?", [subjectId, tid]);
  if (!subj) return err(res, 404, { error: "Subject not found." });
  const cfg = await grading.getGradingConfig(tid);

  // Students in this class
  const classStudents = new Set(
    (await db.all("SELECT id FROM students WHERE madrasa_id = ? AND class_id = ? AND status IN ('active','promoted','suspended')", [tid, classId])).map((r) => r.id)
  );

  let updated = 0;
  const errors = [];
  for (const e of entries) {
    const studentId = toNum(e.studentId, 0);
    if (!classStudents.has(studentId)) { errors.push(`student ${studentId} not in class`); continue; }
    const ca = clampNum(e.ca, 0, cfg.caMax, 0);
    const exam = clampNum(e.exam, 0, cfg.examMax, 0);
    const total = Math.round((ca + exam) * 100) / 100;
    const existing = await db.get(
      "SELECT id FROM results WHERE madrasa_id = ? AND student_id = ? AND term_id = ? AND subject_id = ?",
      [tid, studentId, termId, subjectId]
    );
    if (existing) {
      await db.run("UPDATE results SET ca = ?, exam = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ca, exam, total, existing.id]);
    } else {
      await db.run(
        "INSERT INTO results (madrasa_id, student_id, class_id, session_id, term_id, subject_id, ca, exam, total) VALUES (?,?,?,?,?,?,?,?,?)",
        [tid, studentId, classId, (await db.get("SELECT session_id FROM terms WHERE id = ?", [termId])).session_id, termId, subjectId, ca, exam, total]
      );
    }
    updated++;
  }
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "results.entry", entity: "results", meta: { class_id: classId, term_id: termId, subject_id: subjectId, updated }, ip: req.ip });
  ok(res, { ok: true, updated, errors });
}));

/* ------------------------------ compute term --------------------------- */

router.post("/compute", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const classId = toNum(b.classId, 0);
  const termId = toNum(b.termId, 0);
  if (!classId || !termId) return err(res, 400, "classId and termId are required.");
  const cls = await guardAccess(req, res, tid, classId, null, termId);
  if (!cls) return;
  const out = await grading.computeClassTerm(tid, classId, termId, req.user.id);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "results.compute", entity: "class_term", meta: { class_id: classId, term_id: termId }, ip: req.ip });
  ok(res, out);
}));

/* ------------------------------ class term summary --------------------- */

router.get("/summary", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  const termId = toNum(req.query.termId, 0);
  if (!classId || !termId) return err(res, 400, "classId and termId are required.");
  const rows = await db.all(
    `SELECT ts.*, s.admission_no, s.first_name, s.last_name, s.name_ar, s.photo_path
     FROM term_summaries ts JOIN students s ON s.id = ts.student_id
     WHERE ts.madrasa_id = ? AND ts.class_id = ? AND ts.term_id = ?
     ORDER BY ts.position`,
    [tid, classId, termId]
  );
  ok(res, { students: rows });
}));

/* ------------------------------ comments & publishing ------------------ */

router.put("/summary/:studentId", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const studentId = toNum(req.params.studentId, 0);
  const termId = toNum(b.termId, 0);
  if (!studentId || !termId) return err(res, 400, "termId is required.");
  const row = await db.get(
    "SELECT * FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND term_id = ?",
    [tid, studentId, termId]
  );
  if (!row) return res.status(404).json({ error: "Summary not found — run compute first." });
  const sets = [];
  const vals = [];
  if (b.teacher_comment !== undefined) { sets.push("teacher_comment = ?"); vals.push(String(b.teacher_comment).slice(0, 2000)); }
  if (b.head_comment !== undefined) { sets.push("head_comment = ?"); vals.push(String(b.head_comment).slice(0, 2000)); }
  if (b.attendance_days !== undefined) { sets.push("attendance_days = ?"); vals.push(clampNum(b.attendance_days, 0, 365, 0)); }
  if (b.promotion_status !== undefined && ["promoted", "repeating", "graduated", "pending"].includes(b.promotion_status)) {
    sets.push("promotion_status = ?"); vals.push(b.promotion_status);
  }
  if (b.publish === true) sets.push("published_at = CURRENT_TIMESTAMP");
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(row.id);
  await db.run(`UPDATE term_summaries SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "results.summary", entity: "term_summary", entityId: String(row.id), ip: req.ip });
  ok(res, { ok: true });
}));

/**
 * PUT|POST /results/summaries/publish   { classId, termId, publish = true }
 *
 * Publishes (or retracts) the whole class for a term in one action. Publishing
 * recomputes the summaries, stamps published_at, and is what makes results
 * visible to the student/parent portals and to the public result checker;
 * retracting clears the stamp so a wrong result can be fixed and republished.
 */
async function publishSummaries(req, res) {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  if (!["madrasa_admin", "super_admin", "support_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Only the madrasa administration may publish results." });
  }
  const b = req.body || {};
  const classId = toNum(b.classId !== undefined ? b.classId : req.query.classId, 0);
  const termId = toNum(b.termId !== undefined ? b.termId : req.query.termId, 0);
  const publish = b.publish !== false;
  if (!classId || !termId) return err(res, 400, "classId and termId are required.");
  const cls = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
  if (!cls) return err(res, 404, "Class not found in your madrasa.");
  const term = await db.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]);
  if (!term) return err(res, 404, "Term not found in your madrasa.");

  let count = 0;
  if (publish) {
    await grading.computeClassTerm(tid, classId, termId, req.user.id);
    await db.run(
      `UPDATE term_summaries SET published_at = CURRENT_TIMESTAMP
       WHERE madrasa_id = ? AND class_id = ? AND term_id = ?`,
      [tid, classId, termId]
    );
    const n = await db.get(
      "SELECT COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND class_id = ? AND term_id = ? AND published_at IS NOT NULL",
      [tid, classId, termId]
    );
    count = n ? Number(n.n) : 0;
    if (!count) return err(res, 400, "No results to publish for this class and term yet.");
  } else {
    await db.run(
      "UPDATE term_summaries SET published_at = NULL WHERE madrasa_id = ? AND class_id = ? AND term_id = ?",
      [tid, classId, termId]
    );
    const n = await db.get(
      "SELECT COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND class_id = ? AND term_id = ?",
      [tid, classId, termId]
    );
    count = n ? Number(n.n) : 0;
  }
  logActivity(db, {
    madrasaId: tid, userId: req.user.id,
    action: publish ? "results.publish" : "results.unpublish",
    entity: "term_summary", entityId: `${classId}:${termId}`, meta: { count }, ip: req.ip,
  });
  ok(res, { ok: true, published: publish, count });
}

const publishHandler = asyncHandler(publishSummaries);
router.put("/summaries/publish", publishHandler);
router.post("/summaries/publish", publishHandler);

/* ------------------------------ report card ---------------------------- */

async function loadReportData(req, res, studentId, termId) {
  const tid = await tenantId(req, res);
  if (tid == null) return null;
  const data = await grading.reportCardData(tid, studentId, termId);
  if (!data) { res.status(404).json({ error: "Report card not found." }); return null; }
  // Teacher may only see report cards for assigned classes
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && !scope.assignedClassIds.includes(Number(data.student.classId || 0))) {
      res.status(404).json({ error: "Not found." });
      return null;
    }
  }
  return data;
}

router.get("/report-card-data/:studentId/:termId", asyncHandler(async (req, res) => {
  const data = await loadReportData(req, res, toNum(req.params.studentId, 0), toNum(req.params.termId, 0));
  if (!data) return;
  ok(res, data);
}));

/** Printable report card HTML (standalone document; print to PDF in browser). */
router.get("/report-card/:studentId/:termId", asyncHandler(async (req, res) => {
  const data = await loadReportData(req, res, toNum(req.params.studentId, 0), toNum(req.params.termId, 0));
  if (!data) return;
  res.type("html").send(renderReportCard(data));
}));

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderReportCard(d) {
  const ar = String(d.student.nameAr || "");
  const useArabicNames = ar.length > 0;
  const rows = d.subjects.map((s) => {
    const name = useArabicNames ? (s.nameAr || s.nameEn) : (s.nameEn || s.nameAr);
    const remark = useArabicNames ? (s.remarkAr || s.remark) : (s.remark || s.remarkAr);
    return `<tr>
      <td class="subj">${esc(name)}</td>
      <td>${esc(s.ca)}</td>
      <td>${esc(s.exam)}</td>
      <td>${esc(s.total)}</td>
      <td>${esc(s.pct)}%</td>
      <td class="grade">${esc(s.grade)}</td>
      <td>${esc(remark)}</td>
    </tr>`;
  }).join("");
  const sum = d.summary;
  const positionText = sum.position ? `Position: ${sum.position}${sum.position === 1 ? "st" : sum.position === 2 ? "nd" : sum.position === 3 ? "rd" : "th"}` : "Position: —";
  const promoText = { promoted: "Promoted", repeating: "Repeating", graduated: "Graduated", pending: "Pending" }[sum.promotionStatus] || sum.promotionStatus;

  return `<!DOCTYPE html>
<html lang="${useArabicNames ? "ar" : "en"}" dir="${useArabicNames ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report Card — ${esc(d.student.name)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #1a2b1f; margin: 0; padding: 16px; background: #fff; }
  .card { max-width: 900px; margin: 0 auto; border: 2px solid #14532d; border-radius: 10px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 16px; padding: 14px 18px; background: #f0f7f1; border-bottom: 2px solid #14532d; }
  .head img.logo { width: 74px; height: 74px; object-fit: contain; border-radius: 6px; }
  .head .m1 { font-size: 20px; font-weight: 700; color: #14532d; }
  .head .m2 { font-size: 14px; color: #374151; }
  .head .m3 { font-size: 12px; color: #6b7280; }
  .title { text-align: center; padding: 10px; font-size: 16px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  table.info { width: 100%; border-collapse: collapse; margin: 8px 18px; font-size: 13px; }
  table.info td { padding: 4px 8px; border: 1px solid #d1d5db; }
  table.info td.k { width: 22%; font-weight: 600; background: #f9fafb; }
  .photo { float: right; width: 92px; height: 112px; object-fit: cover; border: 1px solid #9ca3af; margin: 4px 18px 0 0; border-radius: 6px; }
  table.res { width: calc(100% - 36px); margin: 10px 18px; border-collapse: collapse; font-size: 13px; clear: both; }
  table.res th, table.res td { border: 1px solid #9ca3af; padding: 5px 8px; text-align: center; }
  table.res th { background: #14532d; color: #fff; font-size: 12px; }
  table.res td.subj { text-align: start; font-weight: 600; }
  table.res td.grade { font-weight: 700; }
  .totals { display: flex; gap: 10px; padding: 8px 18px; font-size: 13px; flex-wrap: wrap; }
  .totals div { border: 1px solid #9ca3af; padding: 6px 10px; border-radius: 6px; background: #f9fafb; }
  .comments { margin: 8px 18px; font-size: 13px; }
  .comments .row { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #d1d5db; }
  .comments .k { width: 160px; font-weight: 700; }
  .sign { display: flex; justify-content: space-between; padding: 26px 18px 10px; font-size: 13px; }
  .sign .box { width: 40%; text-align: center; border-top: 1px solid #374151; padding-top: 4px; }
  .foot { text-align: center; font-size: 11px; color: #6b7280; padding: 8px 0 4px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .noprint { padding: 8px; text-align: center; }
  .noprint button { background: #14532d; color: #fff; border: 0; padding: 10px 22px; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
  <div class="card">
    <div class="head">
      ${d.madrasa.logoPath ? `<img class="logo" src="${esc(d.madrasa.logoPath)}" alt="logo">` : ""}
      <div>
        <div class="m1">${esc(useArabicNames ? d.madrasa.nameAr : d.madrasa.nameEn)}</div>
        <div class="m2">${esc(useArabicNames ? d.madrasa.mottoAr : d.madrasa.mottoEn)}</div>
        <div class="m3">${esc(d.madrasa.address)}${d.madrasa.city ? ", " + esc(d.madrasa.city) : ""}${d.madrasa.stateName ? ", " + esc(d.madrasa.stateName) : ""}${d.madrasa.phone ? " • " + esc(d.madrasa.phone) : ""}</div>
      </div>
    </div>
    <div class="title">${esc(useArabicNames ? "بطاقة النتائج" : "TERM REPORT CARD")}</div>
    ${d.student.photoPath ? `<img class="photo" src="${esc(d.student.photoPath)}" alt="">` : ""}
    <table class="info">
      <tr>
        <td class="k">${esc(useArabicNames ? "الطالب" : "Student")}</td><td>${esc(useArabicNames ? d.student.nameAr || d.student.name : d.student.name)}</td>
        <td class="k">${esc(useArabicNames ? "رقم التسجيل" : "Admission No.")}</td><td>${esc(d.student.admissionNo)}</td>
      </tr>
      <tr>
        <td class="k">${esc(useArabicNames ? "الفصل" : "Class")}</td><td>${esc(useArabicNames ? d.student.classAr || d.student.classEn : d.student.classEn || d.student.classAr)}</td>
        <td class="k">${esc(useArabicNames ? "الفترة" : "Term")}</td><td>${esc(useArabicNames ? d.term.nameAr : d.term.nameEn)}</td>
      </tr>
      <tr>
        <td class="k">${esc(useArabicNames ? "الأكاديمية" : "Session")}</td><td>${esc(d.session)}</td>
        <td class="k">${esc(useArabicNames ? "الحضور" : "Attendance")}</td><td>${esc(sum.attendanceDays)} attended / ${esc(sum.attendanceTotal)} recorded (${esc(sum.attendancePercentage)}%)</td>
      </tr>
    </table>
    <table class="res">
      <thead>
        <tr>
          <th>${esc(useArabicNames ? "المادة" : "Subject")}</th>
          <th>CA (${esc(d.config.caMax)})</th>
          <th>Exam (${esc(d.config.examMax)})</th>
          <th>${esc(useArabicNames ? "المجموع" : "Total")}</th>
          <th>%</th>
          <th>${esc(useArabicNames ? "الدرجة" : "Grade")}</th>
          <th>${esc(useArabicNames ? "ملاحظة" : "Remark")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><b>Total:</b> ${esc(sum.total)}</div>
      <div><b>Average:</b> ${esc(sum.average)}%</div>
      <div><b>Overall Grade:</b> ${esc(sum.overallGrade)}</div>
      <div><b>${esc(useArabicNames ? "المركز" : "Position")}:</b> ${esc(positionText)}</div>
      <div><b>${esc(useArabicNames ? "الترقية" : "Promotion")}</b>: ${esc(promoText)}</div>
    </div>
    <div class="comments">
      <div class="row"><div class="k">${esc(useArabicNames ? "تعليق المعلم" : "Teacher Comment")}</div><div>${esc(sum.teacherComment) || "—"}</div></div>
      <div class="row"><div class="k">${esc(useArabicNames ? "تعليق الإدارة" : "Head/Admin Comment")}</div><div>${esc(sum.headComment) || "—"}</div></div>
    </div>
    <div class="sign">
      <div class="box">Class Teacher<br>معلم الفصل</div>
      <div class="box">Head of Madrasa<br>مدير المدرسة</div>
    </div>
    <div class="foot">Generated by Multi-Madrasa Platform • ${esc(d.session)} — ${esc(d.term.nameEn)}</div>
  </div>
</body>
</html>`;
}

module.exports = { router, renderReportCard };
