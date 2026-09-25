"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — report sheet engine
   ----------------------------------------------------------------------------
   This is the single renderer + assembler behind every printable report
   sheet/report card in the platform (staff workspace, bulk class generation,
   student portal, parent portal and the public result checker).

   It does NOT re-implement result mathematics: every total, percentage, grade,
   grade point, average, position and promotion decision comes from the
   existing trusted engine in services/grading.js (which is also the only
   writer of term_summaries). This module layers the presentation concerns on
   top:

     • per-institution report template (layout, columns, sections, colours,
       behaviour categories, signature blocks, watermark, credit line) stored
       in the EXISTING `settings` table — no parallel settings system,
     • result completeness checking (assigned subjects vs entered results),
     • derived report status (draft → … → locked) for the review workflow,
     • attendance breakdown, class performance aggregates, next term dates,
     • behaviour/conduct ratings persisted on the existing term_summaries row,
     • a deterministic, human-facing report reference number,
     • a professional A4 print/PDF-ready HTML document (classic, modern and
       compact layouts; portrait or landscape; LTR or RTL; Arabic preserved).

   Sections the institution switched off are omitted; missing data degrades to
   an empty state — never to invented values.
   ========================================================================== */
const db = require("../db");
const grading = require("./grading");

/* --------------------------- template defaults --------------------------- */

/** Result columns a sheet may show. Keys match the assembler's subject fields. */
const RESULT_COLUMNS = ["ca", "exam", "total", "pct", "grade", "gradePoint", "remark"];

const DEFAULT_COLUMNS = { ca: true, exam: true, total: true, pct: true, grade: true, gradePoint: false, remark: true };

const DEFAULT_BEHAVIOUR_CATEGORIES = [
  { key: "punctuality", label: "Punctuality", labelAr: "الالتزام بالمواعيد" },
  { key: "neatness", label: "Neatness", labelAr: "النظافة" },
  { key: "discipline", label: "Discipline", labelAr: "الانضباط" },
  { key: "participation", label: "Participation", labelAr: "المشاركة" },
  { key: "cooperation", label: "Cooperation", labelAr: "التعاون" },
  { key: "respect", label: "Respect", labelAr: "الاحترام" },
  { key: "conduct", label: "General Conduct", labelAr: "السلوك العام" },
];

const DEFAULT_SIGNATURES = [
  { title: "Class Teacher", titleAr: "مُعلّم الفصل", name: "" },
  { title: "Head of Institution", titleAr: "رئيس المؤسسة", name: "" },
];

const RATING_LABELS = { 5: "Excellent", 4: "Very Good", 3: "Good", 2: "Fair", 1: "Poor" };

const DEFAULT_TEMPLATE = {
  layout: "classic",            // classic | modern | compact
  orientation: "auto",          // auto | portrait | landscape
  brandColor: "",               // "" -> fall back to the institution colour
  columns: DEFAULT_COLUMNS,     // which result columns appear
  caLabel: "CA",
  examLabel: "Exam",
  showPosition: true,
  showAttendance: true,
  showBehaviour: true,
  showComments: true,
  showPromotion: true,
  showClassPerformance: true,   // class size / class average / highest / lowest only
  showStudentDetails: true,     // gender, date of birth, category where present
  showPhoto: true,
  showNextTerm: true,
  showGradeLegend: true,
  showReference: true,
  showWatermark: false,
  watermarkText: "",
  showEdusphereCredit: true,
  behaviourCategories: DEFAULT_BEHAVIOUR_CATEGORIES,
  signatures: DEFAULT_SIGNATURES,
};

const LAYOUTS = ["classic", "modern", "compact"];
const ORIENTATIONS = ["auto", "portrait", "landscape"];

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

function hexColor(value) {
  const s = String(value || "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : "";
}

/** Normalises one signature block from stored/client JSON. */
function normSignature(block) {
  if (!block || typeof block !== "object") return null;
  const title = String(block.title || "").trim().slice(0, 80);
  if (!title) return null;
  return {
    title,
    titleAr: String(block.titleAr || "").trim().slice(0, 80),
    name: String(block.name || "").trim().slice(0, 120),
  };
}

/** Normalises one behaviour category. */
function normCategory(cat) {
  if (!cat || typeof cat !== "object") return null;
  const key = String(cat.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
  const label = String(cat.label || "").trim().slice(0, 80);
  if (!key || !label) return null;
  return { key, label, labelAr: String(cat.labelAr || "").trim().slice(0, 80) };
}

/** Merges a stored/partial template onto the defaults (unknown keys dropped). */
function normaliseTemplate(stored) {
  const t = Object.assign({}, DEFAULT_TEMPLATE, parseJson(stored, {}));
  const columns = Object.assign({}, DEFAULT_COLUMNS, t.columns && typeof t.columns === "object" ? t.columns : {});
  const colOut = {};
  for (const key of RESULT_COLUMNS) colOut[key] = columns[key] !== false; // default visible
  const cats = (Array.isArray(t.behaviourCategories) ? t.behaviourCategories : [])
    .map(normCategory).filter(Boolean).slice(0, 15);
  const sigs = (Array.isArray(t.signatures) ? t.signatures : [])
    .map(normSignature).filter(Boolean).slice(0, 4);
  return {
    layout: LAYOUTS.includes(t.layout) ? t.layout : "classic",
    orientation: ORIENTATIONS.includes(t.orientation) ? t.orientation : "auto",
    brandColor: hexColor(t.brandColor),
    columns: colOut,
    caLabel: String(t.caLabel || "CA").trim().slice(0, 24) || "CA",
    examLabel: String(t.examLabel || "Exam").trim().slice(0, 24) || "Exam",
    showPosition: t.showPosition !== false,
    showAttendance: t.showAttendance !== false,
    showBehaviour: t.showBehaviour !== false,
    showComments: t.showComments !== false,
    showPromotion: t.showPromotion !== false,
    showClassPerformance: t.showClassPerformance !== false,
    showStudentDetails: t.showStudentDetails !== false,
    showPhoto: t.showPhoto !== false,
    showNextTerm: t.showNextTerm !== false,
    showGradeLegend: t.showGradeLegend !== false,
    showReference: t.showReference !== false,
    showWatermark: t.showWatermark === true,
    watermarkText: String(t.watermarkText || "").trim().slice(0, 40),
    showEdusphereCredit: t.showEdusphereCredit !== false,
    behaviourCategories: cats.length ? cats : DEFAULT_BEHAVIOUR_CATEGORIES.slice(),
    signatures: sigs.length ? sigs : DEFAULT_SIGNATURES.slice(),
  };
}

/** Reads (and lazily seeds) the institution's report template. */
async function getReportTemplate(madrasaId) {
  const row = await db.get("SELECT value FROM settings WHERE madrasa_id = ? AND key_name = 'report_template'", [madrasaId]);
  return normaliseTemplate(row ? row.value : null);
}

/** Validates and persists a template patch. Returns the stored template. */
async function saveReportTemplate(madrasaId, patch) {
  const current = await getReportTemplate(madrasaId);
  const merged = normaliseTemplate(JSON.stringify(Object.assign({}, current, patch || {})));
  const existing = await db.get("SELECT id FROM settings WHERE madrasa_id = ? AND key_name = 'report_template'", [madrasaId]);
  if (existing) {
    await db.run("UPDATE settings SET value = ? WHERE id = ?", [JSON.stringify(merged), existing.id]);
  } else {
    try {
      await db.run("INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?)", [madrasaId, "report_template", JSON.stringify(merged)]);
    } catch (e) {
      // Two first-time saves racing on the UNIQUE (madrasa_id, key_name):
      // the loser turns its insert into an update of the winner's row.
      if (!/unique|duplicate/i.test(String(e && e.message))) throw e;
      await db.run("UPDATE settings SET value = ? WHERE madrasa_id = ? AND key_name = 'report_template'", [JSON.stringify(merged), madrasaId]);
    }
  }
  return merged;
}

/* ---------------------------- reference numbers -------------------------- */

function refSlug(value, max = 24) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, max);
}

/**
 * Deterministic, human-facing reference (e.g. EDU-2026/2027-JSS1-TTA0001).
 * Built only from values the student already sees on the sheet, so it never
 * leaks an internal database id.
 */
function buildReportReference(sessionLabel, className, admissionNo) {
  const parts = ["EDU", refSlug(sessionLabel, 20), refSlug(className, 16), refSlug(admissionNo, 20)].filter(Boolean);
  return parts.join("-");
}

/* ------------------------------- helpers --------------------------------- */

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only same-origin upload paths may become <img src> — never an external URL. */
function asset(value) {
  const s = String(value || "");
  return /^\/uploads\/[A-Za-z0-9_./-]+$/.test(s) ? s : "";
}

function fmtDate(value) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return String(n || "");
  const s = ["th", "st", "nd", "rd"];
  const v100 = v % 100;
  return v + (s[(v100 - 20) % 10] || s[v100] || s[0]);
}

/** Attendance totals for one student in one term, from the attendance table. */
async function attendanceBreakdown(madrasaId, studentId, termId) {
  const rows = await db.all(
    `SELECT status, COUNT(*) AS n FROM attendance
      WHERE madrasa_id = ? AND student_id = ? AND term_id = ?
      GROUP BY status`,
    [madrasaId, studentId, termId]
  );
  const out = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.n || 0);
    out.total += n;
    if (["present", "absent", "late", "excused"].includes(row.status)) out[row.status] = n;
  }
  out.percentage = out.total ? Math.round((out.present / out.total) * 1000) / 10 : null;
  return out;
}

/** Batched attendance totals for a whole class in one grouped query. */
async function attendanceBreakdownMap(madrasaId, studentIds, termId) {
  const out = new Map();
  if (!studentIds.length) return out;
  const marks = studentIds.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT student_id, status, COUNT(*) AS n FROM attendance
      WHERE madrasa_id = ? AND term_id = ? AND student_id IN (${marks})
      GROUP BY student_id, status`,
    [madrasaId, termId].concat(studentIds)
  );
  for (const row of rows) {
    const id = Number(row.student_id);
    if (!out.has(id)) out.set(id, { present: 0, absent: 0, late: 0, excused: 0, total: 0 });
    const entry = out.get(id);
    const n = Number(row.n || 0);
    entry.total += n;
    if (["present", "absent", "late", "excused"].includes(row.status)) entry[row.status] = n;
  }
  for (const entry of out.values()) {
    entry.percentage = entry.total ? Math.round((entry.present / entry.total) * 1000) / 10 : null;
  }
  return out;
}

/**
 * Class-level aggregates for the sheet: size, average, best and weakest
 * average. Individual classmates' scores are never included — only these
 * aggregates, so no other student's private marks are revealed.
 */
function classPerformanceFrom(summaries) {
  const rows = summaries.filter((s) => s && s.average !== null && s.average !== undefined);
  if (!rows.length) return null;
  const averages = rows.map((s) => Number(s.average)).filter((n) => Number.isFinite(n));
  if (!averages.length) return null;
  const sum = averages.reduce((a, b) => a + b, 0);
  return {
    size: rows.length,
    average: Math.round((sum / averages.length) * 10) / 10,
    highest: Math.max(...averages),
    lowest: Math.min(...averages),
  };
}

/**
 * The term that follows this one (same session, next position), else the
 * first term of the next session — used for the "next term begins" line.
 */
async function nextTermInfo(madrasaId, term) {
  if (!term) return null;
  if (term.start_date) {
    const inSession = await db.get(
      "SELECT id, name_en, name_ar, start_date, end_date FROM terms WHERE madrasa_id = ? AND session_id = ? AND position = ?",
      [madrasaId, term.session_id, Number(term.position) + 1]
    );
    if (inSession && inSession.start_date) {
      return { nameEn: inSession.name_en, nameAr: inSession.name_ar, begins: fmtDate(inSession.start_date), ends: fmtDate(inSession.end_date) };
    }
  }
  const nextSession = await db.get(
    "SELECT id FROM academic_sessions WHERE madrasa_id = ? AND id > ? ORDER BY id LIMIT 1",
    [madrasaId, term.session_id]
  );
  if (nextSession) {
    const firstTerm = await db.get(
      "SELECT name_en, name_ar, start_date, end_date FROM terms WHERE madrasa_id = ? AND session_id = ? ORDER BY position LIMIT 1",
      [madrasaId, nextSession.id]
    );
    if (firstTerm && firstTerm.start_date) {
      return { nameEn: firstTerm.name_en, nameAr: firstTerm.name_ar, begins: fmtDate(firstTerm.start_date), ends: fmtDate(firstTerm.end_date) };
    }
  }
  return null;
}

/** Subject lifecycle stages for status derivation (mirrors results.js). */
const STAGE_ORDER = ["draft", "returned", "submitted", "under_review", "approved", "published", "locked"];

/**
 * Derives the report's position in the review workflow from its subject
 * results and the summary publication stamp. The weakest stage wins: a report
 * is only as final as its least final subject result.
 */
function deriveReportStatus(subjectStatuses, publishedAt, missingCount) {
  if (!subjectStatuses.length) return "draft";
  let lowest = "locked";
  for (const status of subjectStatuses) {
    const idx = STAGE_ORDER.indexOf(status);
    const cur = idx === -1 ? 0 : idx;
    const low = STAGE_ORDER.indexOf(lowest);
    if (cur < low) lowest = STAGE_ORDER[cur];
  }
  if (publishedAt) {
    // A published summary whose results were later locked stays "locked";
    // anything retracted below approved keeps its computed stage.
    if (lowest === "locked") return "locked";
    return "published";
  }
  if (missingCount > 0 && lowest === "locked") return "approved"; // incomplete cannot be fully final
  return lowest;
}

/* --------------------------- completeness check --------------------------- */

/**
 * Compares the subjects assigned to a class (class_subjects) with the results
 * actually entered for a term, for the whole class at once.
 *
 * Returns { subjects, byStudent: Map<studentId, {missing, pending}> } where
 *   missing  = assigned subjects with NO result row for that student,
 *   pending  = subjects whose result row exists but is not yet approved.
 * Students with no results at all appear with every subject missing.
 */
async function classCompleteness(madrasaId, classId, termId) {
  const subjects = await db.all(
    `SELECT su.id, su.name_en, su.name_ar FROM class_subjects cs
      JOIN subjects su ON su.id = cs.subject_id AND su.madrasa_id = cs.madrasa_id AND su.is_active = 1
     WHERE cs.madrasa_id = ? AND cs.class_id = ?
     ORDER BY su.name_en`,
    [madrasaId, classId]
  );
  const students = await db.all(
    "SELECT id FROM students WHERE madrasa_id = ? AND class_id = ? AND status IN ('active','promoted','suspended') ORDER BY admission_no",
    [madrasaId, classId]
  );
  const results = await db.all(
    "SELECT student_id, subject_id, status FROM results WHERE madrasa_id = ? AND class_id = ? AND term_id = ?",
    [madrasaId, classId, termId]
  );
  const entered = new Map(); // studentId -> Map(subjectId -> status)
  for (const r of results) {
    const sid = Number(r.student_id);
    if (!entered.has(sid)) entered.set(sid, new Map());
    entered.get(sid).set(Number(r.subject_id), r.status || "approved");
  }
  const subjectIds = subjects.map((s) => Number(s.id));
  const byStudent = new Map();
  for (const student of students) {
    const sid = Number(student.id);
    const mine = entered.get(sid) || new Map();
    const missing = [];
    const pending = [];
    for (let i = 0; i < subjects.length; i++) {
      const subjectId = subjectIds[i];
      if (!mine.has(subjectId)) missing.push({ subjectId, nameEn: subjects[i].name_en, nameAr: subjects[i].name_ar });
      else if (!["approved", "published", "locked"].includes(mine.get(subjectId))) {
        pending.push({ subjectId, nameEn: subjects[i].name_en, nameAr: subjects[i].name_ar, status: mine.get(subjectId) });
      }
    }
    byStudent.set(sid, { missing, pending, complete: missing.length === 0 && pending.length === 0 });
  }
  return { subjects, byStudent, studentCount: students.length };
}

/* ------------------------------- assembly -------------------------------- */

/** Parses the behaviour ratings JSON stored on a term_summaries row. */
function parseBehaviour(text, categories) {
  const raw = parseJson(text, {});
  const out = {};
  for (const cat of categories) {
    const v = Number(raw[cat.key]);
    out[cat.key] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  }
  return out;
}

/**
 * Assembles the full printable dataset for one student from preloaded rows.
 * All arithmetic goes through grading.subjectScore / grading.gradeForPct so
 * there is exactly one calculation path in the platform.
 */
function assembleReport(preload, student, summary, resultRows) {
  const cfg = preload.config;
  const subjects = resultRows.map((r) => {
    const sc = grading.subjectScore(cfg, r.ca, r.exam);
    return {
      subjectId: Number(r.subject_id),
      nameEn: r.name_en,
      nameAr: r.name_ar,
      ca: sc.ca,
      exam: sc.exam,
      total: sc.total,
      pct: sc.pct,
      grade: r.grade || sc.grade,
      gradePoint: r.grade_point === null || r.grade_point === undefined ? sc.gradePoint : Number(r.grade_point),
      remark: r.teacher_remark || sc.remark,
      remarkAr: sc.remarkAr,
      status: r.status,
      pass: sc.pass,
    };
  });

  const summaryTotal = summary ? Number(summary.total) : 0;
  const summaryAverage = summary ? Number(summary.average) : 0;
  const overall = grading.gradeForPct(cfg, summaryAverage);
  const completeness = preload.completeness.byStudent.get(Number(student.id)) || { missing: [], pending: [], complete: false };
  const attendance = preload.attendance.get(Number(student.id)) ||
    { present: 0, absent: 0, late: 0, excused: 0, total: 0, percentage: null };

  // When the class term has not been computed yet there is no term_summaries
  // row. Rather than printing misleading zeros, the sheet aggregates the very
  // results it is displaying (position needs the whole class, so it stays
  // blank until the term is computed).
  let aggTotal = summaryTotal;
  let aggAverage = summaryAverage;
  let aggGrade = summary ? summary.overall_grade : overall.grade;
  if (!summary && subjects.length) {
    let sum = 0; let pctSum = 0;
    for (const s of subjects) { sum += s.total; pctSum += s.pct; }
    aggTotal = Math.round(sum * 100) / 100;
    aggAverage = Math.round((pctSum / subjects.length) * 10) / 10;
    aggGrade = grading.gradeForPct(cfg, aggAverage).grade;
  }

  // The workflow stage reflects EVERY subject result of the term, including
  // rows still in draft/returned/review — not only the approved ones shown in
  // the table — so a half-entered report is never presented as final.
  const allStatuses = resultRows.map((r) => r.status || "approved")
    .concat(completeness.pending.map((p) => p.status));

  const position = summary ? Number(summary.position) || null : null;
  const reference = String((summary && summary.report_reference) || "") ||
    buildReportReference(preload.sessionLabel, preload.classRow ? preload.classRow.name_en : "", student.admission_no);

  return {
    template: preload.template,
    madrasa: preload.madrasaInfo,
    student: {
      id: Number(student.id),
      studentCode: student.student_code || student.admission_no,
      name: `${student.first_name} ${student.last_name}`.trim(),
      nameAr: student.name_ar,
      admissionNo: student.admission_no,
      photoPath: student.photo_path || "",
      gender: student.gender || "",
      dateOfBirth: fmtDate(student.date_of_birth),
      section: student.section || "",
      program: student.program || "",
      classId: student.class_id ? Number(student.class_id) : null,
      classEn: preload.classRow ? preload.classRow.name_en : "",
      classAr: preload.classRow ? preload.classRow.name_ar : "",
    },
    session: preload.sessionLabel,
    term: {
      nameEn: preload.term.name_en,
      nameAr: preload.term.name_ar,
      position: preload.term.position,
      startDate: fmtDate(preload.term.start_date),
      endDate: fmtDate(preload.term.end_date),
    },
    subjects,
    config: {
      caMax: cfg.caMax,
      examMax: cfg.examMax,
      passMark: cfg.passMark,
      bands: cfg.bands,
    },
    summary: {
      total: aggTotal,
      subjectCount: summary ? Number(summary.subject_count) : subjects.length,
      average: aggAverage,
      overallGrade: aggGrade,
      overallRemark: overall.remark,
      overallRemarkAr: overall.remarkAr,
      position,
      classSize: preload.performance ? preload.performance.size : null,
      teacherComment: summary ? summary.teacher_comment : "",
      headComment: summary ? summary.head_comment : "",
      promotionStatus: summary ? summary.promotion_status : "pending",
      publishedAt: summary ? summary.published_at : null,
    },
    attendance,
    behaviour: {
      categories: preload.template.behaviourCategories,
      ratings: parseBehaviour(summary ? summary.behaviour_ratings : null, preload.template.behaviourCategories),
    },
    classPerformance: preload.performance,
    nextTerm: preload.nextTerm,
    completeness: {
      complete: completeness.complete,
      missingSubjects: completeness.missing,
      pendingSubjects: completeness.pending,
    },
    status: deriveReportStatus(
      allStatuses,
      summary ? summary.published_at : null,
      completeness.missing.length
    ),
    reference,
  };
}

/**
 * Loads everything a class term's report sheets share (one query each), so
 * building a whole class never degenerates into per-student template/config/
 * class-level lookups.
 */
async function preloadClassTerm(madrasaId, classId, termId) {
  const term = await db.get("SELECT * FROM terms WHERE id = ? AND madrasa_id = ?", [termId, madrasaId]);
  if (!term) return null;
  const classRow = classId ? await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [classId, madrasaId]) : null;
  if (classId && !classRow) return null;
  const session = await db.get("SELECT * FROM academic_sessions WHERE id = ?", [term.session_id]);
  const [madrasa, config, template] = await Promise.all([
    db.get("SELECT * FROM madaris WHERE id = ?", [madrasaId]),
    grading.getGradingConfig(madrasaId),
    getReportTemplate(madrasaId),
  ]);
  const summaries = classId
    ? await db.all("SELECT * FROM term_summaries WHERE madrasa_id = ? AND class_id = ? AND term_id = ?", [madrasaId, classId, termId])
    : await db.all("SELECT * FROM term_summaries WHERE madrasa_id = ? AND term_id = ?", [madrasaId, termId]);
  const completeness = classId
    ? await classCompleteness(madrasaId, classId, termId)
    : { subjects: [], byStudent: new Map(), studentCount: 0 };
  const summaryStudentIds = summaries.map((s) => Number(s.student_id));
  const attendance = await attendanceBreakdownMap(madrasaId, summaryStudentIds, termId);
  return {
    term,
    classRow,
    sessionLabel: session ? session.label : "",
    madrasaInfo: {
      nameEn: madrasa.name_en,
      nameAr: madrasa.name_ar,
      logoPath: madrasa.logo_path,
      mottoEn: madrasa.motto_en,
      mottoAr: madrasa.motto_ar,
      address: madrasa.address,
      city: madrasa.city,
      stateName: madrasa.state_name,
      phone: madrasa.phone,
      email: madrasa.email,
      website: madrasa.website,
    },
    config,
    template,
    summaries,
    summariesByStudent: new Map(summaries.map((s) => [Number(s.student_id), s])),
    attendance,
    performance: classPerformanceFrom(summaries),
    nextTerm: await nextTermInfo(madrasaId, term),
    completeness,
  };
}

/** Full printable dataset for ONE student + term. */
async function buildReportSheet(madrasaId, studentId, termId) {
  const student = await db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [studentId, madrasaId]);
  if (!student) return null;
  const preload = await preloadClassTerm(madrasaId, student.class_id, termId);
  if (!preload) return null;
  const resultRows = await db.all(
    `SELECT r.subject_id, r.ca, r.exam, r.total, r.grade, r.grade_point, r.teacher_remark, r.status,
            su.name_en, su.name_ar
     FROM results r JOIN subjects su ON su.id = r.subject_id
     WHERE r.madrasa_id = ? AND r.student_id = ? AND r.term_id = ?
       AND r.status IN ('approved','published','locked')
     ORDER BY su.name_en`,
    [madrasaId, studentId, termId]
  );
  const data = assembleReport(preload, student, preload.summariesByStudent.get(Number(studentId)) || null, resultRows);
  await backfillReference(madrasaId, studentId, termId, data.reference);
  return data;
}

/** Persists the reference number on first use (idempotent, best-effort). */
async function backfillReference(madrasaId, studentId, termId, reference) {
  if (!reference) return;
  try {
    await db.run(
      "UPDATE term_summaries SET report_reference = ? WHERE madrasa_id = ? AND student_id = ? AND term_id = ? AND (report_reference IS NULL OR report_reference = '')",
      [reference, madrasaId, studentId, termId]
    );
  } catch (e) { /* cosmetic field — never fail a report over it */ }
}

/**
 * Datasets for every student in a class with a term summary, in position
 * order. Batched: shared lookups run once, per-student data comes from three
 * grouped queries, and each student's section is assembled in memory.
 */
async function buildClassReportSheets(madrasaId, classId, termId) {
  const preload = await preloadClassTerm(madrasaId, classId, termId);
  if (!preload) return null;
  const ordered = preload.summaries.slice().sort((a, b) => (Number(a.position) || 1e9) - (Number(b.position) || 1e9) || Number(a.student_id) - Number(b.student_id));
  if (!ordered.length) return [];
  const studentIds = ordered.map((s) => Number(s.student_id));
  const marks = studentIds.map(() => "?").join(",");
  const students = await db.all(
    `SELECT * FROM students WHERE madrasa_id = ? AND id IN (${marks})`,
    [madrasaId].concat(studentIds)
  );
  const studentsById = new Map(students.map((s) => [Number(s.id), s]));
  const resultRows = await db.all(
    `SELECT r.student_id, r.subject_id, r.ca, r.exam, r.total, r.grade, r.grade_point, r.teacher_remark, r.status,
            su.name_en, su.name_ar
     FROM results r JOIN subjects su ON su.id = r.subject_id
     WHERE r.madrasa_id = ? AND r.class_id = ? AND r.term_id = ?
       AND r.status IN ('approved','published','locked')
     ORDER BY r.student_id, su.name_en`,
    [madrasaId, classId, termId]
  );
  const resultsByStudent = new Map();
  for (const r of resultRows) {
    const sid = Number(r.student_id);
    if (!resultsByStudent.has(sid)) resultsByStudent.set(sid, []);
    resultsByStudent.get(sid).push(r);
  }
  const out = [];
  for (const summary of ordered) {
    const student = studentsById.get(Number(summary.student_id));
    if (!student) continue;
    const rows = resultsByStudent.get(Number(summary.student_id)) || [];
    if (!rows.length) continue;
    const data = assembleReport(preload, student, summary, rows);
    await backfillReference(madrasaId, summary.student_id, termId, data.reference);
    out.push(data);
  }
  return out;
}

/* -------------------------------- rendering ------------------------------- */

/** How many result columns the sheet will actually show. */
function visibleColumnCount(template) {
  return RESULT_COLUMNS.filter((key) => template.columns[key]).length;
}

/** Auto orientation: wide subject tables print landscape. */
function resolveOrientation(template, subjectCount) {
  if (template.orientation !== "auto") return template.orientation;
  return subjectCount > 11 || visibleColumnCount(template) >= 7 ? "landscape" : "portrait";
}

function brandColorOf(data) {
  return hexColor(data.template.brandColor) || hexColor(data.madrasa && data.madrasa.brandColor) || "#14532d";
}

/** Colour helpers so banded headers stay readable on any brand colour. */
function shade(hex, amount) {
  const m = /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : "#14532d";
  const num = parseInt(m.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Fills any field the assembler normally provides so the renderer also
 * accepts a plain grading.reportCardData payload (back-compat callers) and
 * degrades gracefully instead of crashing on missing optional data.
 */
function normalizeRenderInput(data) {
  const template = data.template || normaliseTemplate(null);
  const summary = data.summary || {};
  const d = Object.assign({}, data);
  d.template = template;
  d.madrasa = Object.assign({ nameEn: "", nameAr: "", logoPath: "", mottoEn: "", mottoAr: "", address: "", city: "", stateName: "", phone: "", email: "", website: "" }, data.madrasa || {});
  d.student = Object.assign({ photoPath: "", nameAr: "", gender: "", dateOfBirth: "", section: "", program: "", studentCode: "", classEn: "", classAr: "", admissionNo: "", name: "" }, data.student || {});
  d.term = Object.assign({ nameEn: "", nameAr: "" }, data.term || {});
  d.subjects = Array.isArray(data.subjects) ? data.subjects : [];
  d.config = Object.assign({ caMax: 40, examMax: 60, passMark: 50, bands: grading.DEFAULT_BANDS.slice() }, data.config || {});
  d.summary = Object.assign({
    total: 0, subjectCount: d.subjects.length, average: 0, overallGrade: "", overallRemark: "",
    overallRemarkAr: "", position: null, classSize: null, teacherComment: "", headComment: "",
    promotionStatus: "pending", publishedAt: null,
  }, summary);
  d.attendance = data.attendance || {
    present: Number(summary.attendanceDays || 0),
    absent: 0, late: 0, excused: 0,
    total: Number(summary.attendanceTotal || 0),
    percentage: summary.attendancePercentage === undefined || summary.attendancePercentage === null ? null : Number(summary.attendancePercentage),
  };
  d.behaviour = data.behaviour || { categories: template.behaviourCategories, ratings: {} };
  d.classPerformance = data.classPerformance || null;
  d.nextTerm = data.nextTerm || null;
  d.completeness = data.completeness || { complete: true, missingSubjects: [], pendingSubjects: [] };
  d.status = data.status || deriveReportStatus(d.subjects.map((s) => s.status || "approved"), d.summary.publishedAt, 0);
  d.reference = data.reference || "";
  d.session = data.session || "";
  return d;
}

const PROMOTION_TEXT = {
  promoted: { en: "Promoted", ar: "نُقل إلى الصف الأعلى" },
  repeating: { en: "Repeating", ar: "يعيد السنة" },
  graduated: { en: "Graduated", ar: "تخرّج" },
  pending: { en: "Pending", ar: "قيد القرار" },
  promoted_trial: { en: "Promoted on Trial", ar: "نُقل تحت التجربة" },
  withdrawn: { en: "Withdrawn", ar: "منسحب" },
  completed: { en: "Completed", ar: "أكمل البرنامج" },
};

/**
 * Renders the professional A4 report sheet. The document is print/PDF ready:
 * the browser's print dialog (or "Save as PDF") produces the final file with
 * branding, tables, page breaks and Arabic text preserved — the same pipeline
 * the platform's ID cards and certificates already use.
 *
 * opts.portal        render inside the student/parent portal (published only)
 * opts.publicCopy    render for the public result checker (adds verified line)
 * opts.statusNote    extra line for the non-printing toolbar
 */
function renderReportSheetHTML(data, opts = {}) {
  data = normalizeRenderInput(data);
  const t = data.template;
  const ar = String(data.student.nameAr || "");
  const rtl = ar.length > 0;
  const L = (en, arabic) => (rtl && arabic ? arabic : en);
  const orientation = resolveOrientation(t, data.subjects.length);
  const brand = brandColorOf(data);
  const brandDark = shade(brand, -24);
  const brandSoft = shade(brand, 116);
  const compact = t.layout === "compact";
  const modern = t.layout === "modern";

  const cols = t.columns;
  const colCount = visibleColumnCount(t);

  const subjectRows = data.subjects.map((s) => {
    const name = rtl ? (s.nameAr || s.nameEn) : (s.nameEn || s.nameAr);
    const remark = rtl ? (s.remarkAr || s.remark) : (s.remark || s.remarkAr);
    const cells = [];
    if (cols.ca) cells.push(`<td class="num">${esc(s.ca)}</td>`);
    if (cols.exam) cells.push(`<td class="num">${esc(s.exam)}</td>`);
    if (cols.total) cells.push(`<td class="num"><b>${esc(s.total)}</b></td>`);
    if (cols.pct) cells.push(`<td class="num">${esc(s.pct)}%</td>`);
    if (cols.grade) cells.push(`<td class="grade">${esc(s.grade)}</td>`);
    if (cols.gradePoint) cells.push(`<td class="num">${esc(s.gradePoint)}</td>`);
    if (cols.remark) cells.push(`<td class="remark">${esc(remark || "—")}</td>`);
    return `<tr><td class="subj">${esc(name)}</td>${cells.join("")}</tr>`;
  }).join("");

  const subjectHeader = (() => {
    const heads = [];
    if (cols.ca) heads.push(`<th>${esc(L(`${t.caLabel} (${data.config.caMax})`, `${t.caLabel}`))}</th>`);
    if (cols.exam) heads.push(`<th>${esc(L(`${t.examLabel} (${data.config.examMax})`, `${t.examLabel}`))}</th>`);
    if (cols.total) heads.push(`<th>${esc(L("Total", "المجموع"))}</th>`);
    if (cols.pct) heads.push(`<th>%</th>`);
    if (cols.grade) heads.push(`<th>${esc(L("Grade", "الدرجة"))}</th>`);
    if (cols.gradePoint) heads.push(`<th>${esc(L("Point", "النقاط"))}</th>`);
    if (cols.remark) heads.push(`<th>${esc(L("Remark", "ملاحظة"))}</th>`);
    return `<tr><th class="subj">${esc(L("Subject", "المادة"))}</th>${heads.join("")}</tr>`;
  })();

  /* ---------------- student information grid ---------------- */
  const infoCells = [];
  const addInfo = (label, value) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    infoCells.push(`<div class="cell"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`);
  };
  addInfo(L("Student name", "اسم الطالب"), rtl ? (data.student.nameAr || data.student.name) : data.student.name);
  addInfo(L("Admission no.", "رقم التسجيل"), data.student.admissionNo);
  addInfo(L("Student ID", "الرقم التعريفي"), data.student.studentCode);
  addInfo(L("Class", "الفصل"), rtl ? (data.student.classAr || data.student.classEn) : (data.student.classEn || data.student.classAr));
  if (t.showStudentDetails) {
    if (data.student.section) addInfo(L("Section", "القسم"), data.student.section);
    if (data.student.program) addInfo(L("Program", "البرنامج"), data.student.program);
    if (data.student.gender) addInfo(L("Gender", "الجنس"), data.student.gender === "M" ? L("Male", "ذكر") : data.student.gender === "F" ? L("Female", "أنثى") : data.student.gender);
    if (data.student.dateOfBirth) addInfo(L("Date of birth", "تاريخ الميلاد"), data.student.dateOfBirth);
  }
  addInfo(L("Academic session", "العام الدراسي"), data.session);
  addInfo(L("Term", "الفترة"), rtl ? (data.term.nameAr || data.term.nameEn) : (data.term.nameEn || data.term.nameAr));
  if (t.showReference) addInfo(L("Report no.", "رقم التقرير"), data.reference);

  const photo = t.showPhoto && asset(data.student.photoPath)
    ? `<img class="photo" src="${esc(asset(data.student.photoPath))}" alt="${esc(data.student.name)}">`
    : "";

  /* ---------------- overall performance ---------------- */
  const perf = [];
  if (data.summary.subjectCount) {
    perf.push([L("Subjects offered", "عدد المواد"), data.summary.subjectCount]);
    if (t.columns.total) perf.push([L("Total marks", "مجموع الدرجات"), data.summary.total]);
    perf.push([L("Average score", "المعدل"), `${data.summary.average}%`]);
    perf.push([L("Overall grade", "الدرجة العامة"), data.summary.overallGrade || "—"]);
  }
  if (t.showPosition && data.summary.position && data.classPerformance && data.classPerformance.size) {
    perf.push([L("Position", "الترتيب"), `${ordinal(data.summary.position)} ${L("of", "من")} ${data.classPerformance.size}`]);
  }
  if (t.showClassPerformance && data.classPerformance) {
    perf.push([L("Class size", "عدد الطلاب"), data.classPerformance.size]);
    perf.push([L("Class average", "معدل الفصل"), `${data.classPerformance.average}%`]);
  }
  const perfRows = perf.map(([k, v]) => `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");

  /* ---------------- attendance ---------------- */
  const att = data.attendance;
  const attendanceSection = t.showAttendance
    ? `<section class="block">
        <h2>${esc(L("Attendance", "الحضور"))}</h2>
        ${att.total ? `<div class="att">${[
      [L("Days recorded", "أيام مسجلة"), att.total],
      [L("Present", "حاضر"), att.present],
      [L("Absent", "غائب"), att.absent],
      [L("Late", "متأخر"), att.late],
      [L("Attendance %", "نسبة الحضور"), att.percentage === null ? "—" : `${att.percentage}%`],
    ].map(([k, v]) => `<div class="cell"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}</div>`
      : `<p class="empty">${esc(L("No attendance records for this term.", "لا توجد سجلات حضور لهذه الفترة."))}</p>`}
      </section>`
    : "";

  /* ---------------- behaviour / conduct ---------------- */
  const ratedCategories = t.showBehaviour
    ? data.behaviour.categories.filter((c) => data.behaviour.ratings[c.key] !== null)
    : [];
  const behaviourSection = t.showBehaviour && t.behaviourCategories.length
    ? `<section class="block">
        <h2>${esc(L("Behaviour / Conduct", "السلوك والمواظبة"))}</h2>
        ${ratedCategories.length ? `<div class="behaviour">${ratedCategories.map((c) => {
          const rating = data.behaviour.ratings[c.key];
          return `<div class="cell"><span class="k">${esc(rtl && c.labelAr ? c.labelAr : c.label)}</span><span class="v">${esc(`${rating}/5 — ${RATING_LABELS[rating] || ""}`)}</span></div>`;
        }).join("")}</div>`
          : `<p class="empty">${esc(L("No conduct ratings recorded for this term.", "لا توجد تقييمات سلوك لهذه الفترة."))}</p>`}
      </section>`
    : "";

  /* ---------------- comments ---------------- */
  const commentsSection = t.showComments
    ? `<section class="block">
        <h2>${esc(L("Comments", "الملاحظات"))}</h2>
        <div class="comment"><span class="k">${esc(L("Class teacher's comment", "تعليق معلم الفصل"))}</span><p>${esc(data.summary.teacherComment || "—")}</p></div>
        <div class="comment"><span class="k">${esc(L("Head of institution's comment", "تعليق رئيس المؤسسة"))}</span><p>${esc(data.summary.headComment || "—")}</p></div>
      </section>`
    : "";

  /* ---------------- promotion + next term ---------------- */
  const promo = PROMOTION_TEXT[data.summary.promotionStatus] || { en: data.summary.promotionStatus, ar: "" };
  const promoSection = t.showPromotion
    ? `<section class="block promotion"><h2>${esc(L("Promotion status", "قرار الترقية"))}</h2>
        <div class="promo-badge">${esc(L(promo.en, promo.ar || promo.en))}</div>
        ${t.showNextTerm && data.nextTerm && data.nextTerm.begins
        ? `<p class="next-term">${esc(L("Next term begins", "تبدأ الفترة القادمة"))}: <b>${esc(data.nextTerm.begins)}</b>${data.nextTerm.ends ? ` — ${esc(L("ends", "تنتهي"))} <b>${esc(data.nextTerm.ends)}</b>` : ""}</p>`
        : ""}
      </section>`
    : "";

  /* ---------------- signatures ---------------- */
  const signatures = t.signatures.map((sig) => {
    const title = rtl && sig.titleAr ? sig.titleAr : sig.title;
    return `<div class="sig"><div class="line"></div><div class="who">${esc(title)}</div>${sig.name ? `<div class="name">${esc(sig.name)}</div>` : ""}</div>`;
  }).join("");

  /* ---------------- grading legend ---------------- */
  const legend = t.showGradeLegend && data.config.bands.length
    ? `<p class="legend">${esc(L("Grading scale", "سلم الدرجات"))}: ${data.config.bands
      .slice().sort((a, b) => Number(b.min) - Number(a.min))
      .map((b) => `${esc(b.grade)} ${Number(b.min)}+${b.remark ? ` (${esc(rtl && b.remark_ar ? b.remark_ar : b.remark)})` : ""}`)
      .join(" · ")}</p>`
    : "";

  /* ---------------- completeness notice ---------------- */
  const incomplete = !data.completeness.complete;
  const incompleteNotice = incomplete
    ? `<div class="notice">${esc(L("This report is incomplete — some required results are missing or not yet approved.", "هذا التقرير غير مكتمل — بعض النتائج مفقودة أو لم تُعتمد بعد."))}
        ${data.completeness.missingSubjects.length ? `<br>${esc(L("Missing", "مفقود"))}: ${esc(data.completeness.missingSubjects.map((s) => rtl && s.nameAr ? s.nameAr : s.nameEn).join(", "))}` : ""}
        ${data.completeness.pendingSubjects.length ? `<br>${esc(L("Awaiting approval", "بانتظار الاعتماد"))}: ${esc(data.completeness.pendingSubjects.map((s) => rtl && s.nameAr ? s.nameAr : s.nameEn).join(", "))}` : ""}
      </div>`
    : "";

  const watermark = t.showWatermark && t.watermarkText
    ? `<div class="watermark">${esc(t.watermarkText)}</div>`
    : "";

  // Logical sides so the RTL sheet mirrors correctly.
  const side = rtl ? "left" : "right";
  const other = rtl ? "right" : "left";

  const draftMark = !opts.portal && !opts.publicCopy && ["draft", "returned", "submitted", "under_review"].includes(data.status)
    ? `<div class="draft-mark">${esc(L("WORKING COPY — NOT FINAL", "نسخة عمل — غير نهائية"))}</div>`
    : "";

  const logo = asset(data.madrasa.logoPath)
    ? `<img class="logo" src="${esc(asset(data.madrasa.logoPath))}" alt="">`
    : `<div class="logo logo-fallback" aria-hidden="true">${esc((data.madrasa.nameEn || "?").trim().charAt(0).toUpperCase())}</div>`;

  const contactBits = [
    data.madrasa.address,
    data.madrasa.city,
    data.madrasa.stateName,
    data.madrasa.phone ? `${L("Tel", "هاتف")}: ${data.madrasa.phone}` : "",
    data.madrasa.email,
    data.madrasa.website,
  ].filter((x) => x && String(x).trim());
  const contactLine = contactBits.map(esc).join(" · ");

  const credit = t.showEdusphereCredit
    ? `<div class="credit">Powered by EduSphere</div>`
    : "";

  const toolbar = opts.portal || opts.publicCopy
    ? `<div class="noprint toolbar"><button type="button" onclick="window.print()">${esc(L("🖨 Print / Save as PDF", "🖨 طباعة / حفظ PDF"))}</button></div>`
    : `<div class="noprint toolbar">
        <span class="status-pill status-${esc(data.status)}">${esc(data.status.replace("_", " "))}</span>
        ${incomplete ? `<span class="status-pill status-incomplete">${esc(L("Incomplete", "غير مكتمل"))}</span>` : ""}
        ${opts.statusNote ? `<span class="note">${esc(opts.statusNote)}</span>` : ""}
        <button type="button" onclick="window.print()">${esc(L("🖨 Print / Save as PDF", "🖨 طباعة / حفظ PDF"))}</button>
      </div>`;

  return `<!DOCTYPE html>
<html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L("Report Sheet", "بطاقة النتائج"))} — ${esc(data.student.name)}</title>
<style>
  @page { size: A4 ${orientation}; margin: ${compact ? "8mm" : "10mm"}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eef1f4; }
  body { font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif; color: #1f2937; }
  .sheet {
    position: relative; background: #fff; margin: 0 auto 16px;
    width: ${orientation === "landscape" ? "285mm" : "202mm"};
    min-height: ${orientation === "landscape" ? "180mm" : "285mm"};
    padding: ${compact ? "6mm" : "9mm"};
    ${modern ? `border-top: 4mm solid ${brand};` : `border: ${compact ? "1.5px" : "2px"} solid ${brandDark};`}
    overflow: hidden;
  }
  .watermark {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 56px; font-weight: 800; letter-spacing: 6px; color: ${brand}; opacity: .07;
    transform: rotate(-28deg); pointer-events: none; z-index: 0;
  }
  .draft-mark {
    position: absolute; top: 46%; ${side}: 6mm; transform: rotate(${rtl ? "90" : "-90"}deg);
    font-size: 11px; font-weight: 700; letter-spacing: 3px; color: #b91c1c; opacity: .55;
  }
  .inner { position: relative; z-index: 1; }
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; border-bottom: ${modern ? "none" : `2px solid ${brand}`}; }
  .head .logo { width: ${compact ? "58px" : "76px"}; height: ${compact ? "58px" : "76px"}; object-fit: contain; border-radius: 8px; }
  .head .logo-fallback { display: flex; align-items: center; justify-content: center; background: ${brandSoft}; color: ${brandDark}; font-size: 30px; font-weight: 800; }
  .head .id { flex: 1; text-align: center; }
  .head .name { font-size: ${compact ? "17px" : "21px"}; font-weight: 800; color: ${brandDark}; letter-spacing: .5px; }
  .head .name .ar { font-size: ${compact ? "15px" : "18px"}; font-weight: 700; }
  .head .motto { font-size: 12px; font-style: italic; color: #4b5563; margin-top: 2px; }
  .head .contact { font-size: 10.5px; color: #6b7280; margin-top: 3px; }
  .doc-title { text-align: center; margin: ${compact ? "8px" : "12px"} 0 8px; }
  .doc-title .en { font-size: ${compact ? "13px" : "15px"}; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase; color: ${brandDark}; }
  .doc-title .ar { font-size: 13px; font-weight: 700; color: ${brandDark}; }
  .student-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; ${photo ? "margin-inline-end: 96px;" : ""} }
  .student-grid .cell { display: flex; gap: 6px; font-size: ${compact ? "10.5px" : "12px"}; border-bottom: 1px dotted #d1d5db; padding: 3px 0; }
  .student-grid .k { min-width: 108px; font-weight: 700; color: #374151; }
  .photo { float: ${side}; width: 82px; height: 100px; object-fit: cover; border: 1px solid #9ca3af; border-radius: 6px; margin: 6px 0 4px 12px; margin-${side}: 12px; margin-${other}: 0; }
  table.results { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: ${compact ? "10px" : "11.5px"}; }
  table.results th, table.results td { border: 1px solid ${shade(brand, 90)}; padding: ${compact ? "2.5px 5px" : "4px 7px"}; text-align: center; }
  table.results th { background: ${brand}; color: #fff; font-weight: 700; }
  table.results td.subj, table.results th.subj { text-align: start; }
  table.results td.grade { font-weight: 800; }
  table.results tr { break-inside: avoid; page-break-inside: avoid; }
  table.results thead { display: table-header-group; }
  table.results tbody tr:nth-child(even) { background: ${shade(brand, 122)}; }
  .notice { border: 1.5px solid #b45309; background: #fffbeb; color: #92400e; font-size: 11px; padding: 6px 10px; border-radius: 6px; margin-top: 8px; }
  .perf { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .perf .stat { border: 1px solid ${shade(brand, 90)}; background: ${shade(brand, 124)}; border-radius: 6px; padding: 5px 10px; font-size: 11px; display: flex; gap: 6px; }
  .perf .k { font-weight: 700; color: ${brandDark}; }
  .block { margin-top: 12px; }
  .block h2 { font-size: ${compact ? "10.5px" : "12px"}; text-transform: uppercase; letter-spacing: 1.2px; color: ${brandDark}; border-bottom: 1.5px solid ${shade(brand, 90)}; padding-bottom: 3px; margin: 0 0 6px; }
  .att, .behaviour { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 4px 16px; }
  .att .cell, .behaviour .cell { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; border-bottom: 1px dotted #d1d5db; padding: 2.5px 0; }
  .att .k, .behaviour .k { font-weight: 700; color: #374151; }
  .comment { display: flex; gap: 10px; font-size: 11.5px; padding: 5px 0; border-bottom: 1px dashed #d1d5db; }
  .comment .k { min-width: 170px; font-weight: 700; color: ${brandDark}; }
  .comment p { margin: 0; min-height: 18px; }
  .promotion { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .promotion h2 { flex-basis: 100%; }
  .promo-badge { border: 2px solid ${brandDark}; color: ${brandDark}; font-weight: 800; font-size: 13px; letter-spacing: 1px; padding: 6px 16px; border-radius: 999px; }
  .next-term { font-size: 11.5px; margin: 0; }
  .signatures { display: flex; justify-content: space-around; gap: 18px; margin-top: ${compact ? "16px" : "26px"}; }
  .sig { flex: 1; max-width: 240px; text-align: center; font-size: 11px; }
  .sig .line { border-top: 1px solid #374151; margin-bottom: 4px; height: ${compact ? "18px" : "30px"}; }
  .sig .who { font-weight: 700; }
  .sig .name { color: #4b5563; }
  .legend { font-size: 9.5px; color: #6b7280; margin: 10px 0 0; }
  .foot { margin-top: 12px; border-top: 1px solid ${shade(brand, 90)}; padding-top: 6px; text-align: center; font-size: 10px; color: #6b7280; }
  .credit { font-size: 9px; color: #9ca3af; margin-top: 2px; }
  .empty { font-size: 11px; color: #6b7280; margin: 2px 0; font-style: italic; }
  .noprint { position: sticky; top: 0; z-index: 5; background: #111827; color: #fff; padding: 8px 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .noprint button { background: ${brand}; color: #fff; border: 0; padding: 8px 18px; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .status-pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 3px 10px; border-radius: 999px; background: #374151; }
  .status-published, .status-approved, .status-locked { background: #15803d; }
  .status-draft, .status-returned { background: #b45309; }
  .status-submitted, .status-under_review { background: #1d4ed8; }
  .status-incomplete { background: #b91c1c; }
  .noprint .note { font-size: 12px; color: #d1d5db; }
  @media print {
    html, body { background: #fff; }
    .noprint { display: none !important; }
    .sheet { width: auto; min-height: auto; margin: 0; border-top-width: ${modern ? "4mm" : "2px"}; box-shadow: none; }
  }
  @media screen and (max-width: 720px) {
    .sheet { width: 100%; padding: 4mm; }
    .student-grid { margin-inline-end: 0; }
    .photo { float: none; display: block; margin: 6px auto; }
  }
</style>
</head>
<body>
${toolbar}
<div class="sheet layout-${esc(t.layout)}">
  ${watermark}
  ${draftMark}
  <div class="inner">
    <header class="head">
      ${logo}
      <div class="id">
        <div class="name">${esc(data.madrasa.nameEn)}${data.madrasa.nameAr ? ` <span class="ar" dir="rtl">· ${esc(data.madrasa.nameAr)}</span>` : ""}</div>
        ${data.madrasa.mottoEn || data.madrasa.mottoAr ? `<div class="motto">${esc(rtl && data.madrasa.mottoAr ? data.madrasa.mottoAr : (data.madrasa.mottoEn || data.madrasa.mottoAr))}</div>` : ""}
        ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}
      </div>
      <div style="width:${compact ? "58px" : "76px"}" aria-hidden="true"></div>
    </header>    <div class="doc-title">
      <div class="en">${esc(L("Termly Report Sheet", "التقرير الفصلي"))}</div>
      ${data.madrasa.nameAr ? `<div class="ar" dir="rtl">بطاقة النتائج المدرسية</div>` : ""}
    </div>
    ${photo}
    <div class="student-grid">${infoCells.join("")}</div>
    <table class="results">
      <thead>${subjectHeader}</thead>
      <tbody>${subjectRows || `<tr><td class="subj" colspan="${colCount + 1}">${esc(L("No approved subject results for this term yet.", "لا توجد نتائج معتمدة لهذه الفترة بعد."))}</td></tr>`}</tbody>
    </table>
    ${incompleteNotice}
    ${perfRows ? `<div class="perf">${perfRows}</div>` : ""}
    ${legend}
    ${attendanceSection}
    ${behaviourSection}
    ${commentsSection}
    ${promoSection}
    <div class="signatures">${signatures}</div>
    <footer class="foot">
      <div>${esc(data.madrasa.nameEn)}${contactLine ? ` · ${contactLine}` : ""}</div>
      <div>${esc(L("Session", "العام"))}: ${esc(data.session)} — ${esc(rtl ? (data.term.nameAr || data.term.nameEn) : data.term.nameEn)}${data.summary.publishedAt ? ` · ${esc(L("Issued", "صدر"))}: ${esc(fmtDate(data.summary.publishedAt))}` : ""}</div>
      ${t.showReference ? `<div>${esc(L("Report no.", "رقم التقرير"))}: ${esc(data.reference)}</div>` : ""}
      ${credit}
    </footer>
  </div>
</div>
${opts.publicCopy ? `<div style="text-align:center;font-size:11px;color:#6b7280;padding:6px 0 12px">Published online copy — verified ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</div>` : ""}
</body>
</html>`;
}

/** One document containing every sheet, one per printed page. */
function renderBulkReportSheets(sheets, opts = {}) {
  if (!sheets.length) return "";
  const documents = sheets.map((sheet) => renderReportSheetHTML(sheet, Object.assign({}, opts, { statusNote: undefined })));
  const style = (documents[0].match(/<style>[\s\S]*?<\/style>/) || ["<style></style>"])[0]
    .replace("</style>", "\n  .bulk-page { break-after: page; page-break-after: always; }\n  .bulk-page:last-child { break-after: auto; page-break-after: auto; }\n</style>");
  // Each sheet keeps its own direction: an Arabic-named student's sheet is
  // extracted with dir="rtl" so the combined document lays out correctly.
  const bodies = sheets.map((sheet, i) => {
    const doc = documents[i];
    const start = doc.indexOf('<div class="sheet');
    const end = doc.lastIndexOf("</body>");
    const dir = String(sheet.student && sheet.student.nameAr || "") ? "rtl" : "ltr";
    return `<section class="bulk-page" dir="${dir}">${doc.slice(start, end)}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report sheets — batch</title>${style}</head>
<body><div class="noprint toolbar"><button type="button" onclick="window.print()">🖨 Print / Save all as PDF</button><span class="note">${sheets.length} report sheet(s)</span></div>
${bodies}
</body></html>`;
}

/* --------------------------- template preview ---------------------------- */

/**
 * A realistic sample sheet so an administrator can see a template before
 * saving it. No institution's real student data is used, so a preview can
 * never leak another tenant's records.
 */
function sampleReportSheet(template, config) {
  const cfg = config || {
    caMax: 40, examMax: 60, passMark: 50,
    bands: grading.DEFAULT_BANDS.slice(),
  };
  const t = normaliseTemplate(JSON.stringify(template));
  const subjNames = [
    ["Mathematics", "الرياضيات"], ["English Language", "اللغة الإنجليزية"], ["Basic Science", "العلوم"],
    ["Social Studies", "الدراسات الاجتماعية"], ["Islamic Studies", "الدراسات الإسلامية"], ["Arabic", "اللغة العربية"],
  ];
  const subjects = subjNames.map(([en, ar], i) => {
    const sc = grading.subjectScore(cfg, 30 + i, 45 + (i % 3) * 4);
    return { subjectId: i + 1, nameEn: en, nameAr: ar, ca: sc.ca, exam: sc.exam, total: sc.total, pct: sc.pct, grade: sc.grade, gradePoint: sc.gradePoint, remark: sc.remark, remarkAr: sc.remarkAr, status: "approved", pass: sc.pass };
  });
  const average = Math.round((subjects.reduce((sum, s) => sum + s.pct, 0) / subjects.length) * 10) / 10;
  const overall = grading.gradeForPct(cfg, average);
  const ratings = {};
  for (const cat of t.behaviourCategories) ratings[cat.key] = 5 - (Object.keys(ratings).length % 3);
  return {
    template: t,
    madrasa: {
      nameEn: "Sample International Academy", nameAr: "أكاديمية النموذج الدولية", logoPath: "",
      mottoEn: "Knowledge · Character · Service", mottoAr: "العلم · الخلق · الخدمة",
      address: "1 Sample Avenue", city: "Ijebu-Ode", stateName: "Ogun", phone: "+234 800 000 0000",
      email: "info@example.edu", website: "www.example.edu",
    },
    student: {
      id: 0, studentCode: "SAMPLE-0001", name: "Aisha Adebayo Example", nameAr: "عائشة أديبايو — نموذج",
      admissionNo: "SAMPLE-0001", photoPath: "", gender: "F", dateOfBirth: "2013-06-15",
      section: "A", program: "General", classId: null, classEn: "Primary 5", classAr: "الابتدائية ٥",
    },
    session: "2026/2027",
    term: { nameEn: "First Term", nameAr: "الفترة الأولى", position: 1, startDate: "2026-09-01", endDate: "2026-12-18" },
    subjects,
    config: cfg,
    summary: {
      total: subjects.reduce((sum, s) => sum + s.total, 0), subjectCount: subjects.length,
      average, overallGrade: overall.grade, overallRemark: overall.remark, overallRemarkAr: overall.remarkAr,
      position: 3, classSize: 28, teacherComment: "A consistently hard-working and courteous learner. Keep it up.",
      headComment: "An excellent term's work. Promoted with merit.",
      promotionStatus: "promoted", publishedAt: new Date().toISOString().slice(0, 10),
    },
    attendance: { present: 92, absent: 3, late: 2, excused: 1, total: 98, percentage: 94 },
    behaviour: { categories: t.behaviourCategories, ratings },
    classPerformance: { size: 28, average: 71.4, highest: 96, lowest: 42 },
    nextTerm: { nameEn: "Second Term", nameAr: "الفترة الثانية", begins: "2027-01-08", ends: "2027-04-02" },
    completeness: { complete: true, missingSubjects: [], pendingSubjects: [] },
    status: "published",
    reference: "EDU-2026/2027-PRIMARY5-SAMPLE0001",
  };
}

module.exports = {
  DEFAULT_TEMPLATE,
  RESULT_COLUMNS,
  getReportTemplate,
  saveReportTemplate,
  normaliseTemplate,
  buildReportReference,
  buildReportSheet,
  buildClassReportSheets,
  classCompleteness,
  classPerformanceFrom,
  attendanceBreakdown,
  nextTermInfo,
  deriveReportStatus,
  renderReportSheetHTML,
  renderBulkReportSheets,
  sampleReportSheet,
};
