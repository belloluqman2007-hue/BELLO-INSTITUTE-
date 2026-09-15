"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — analytics service (dashboard aggregates)
   ----------------------------------------------------------------------------
   Read-only aggregate queries behind the dashboards: enrolment trends,
   attendance, fee collection and academic performance.

   TENANT SAFETY
   This module never reads a tenant id from a request. Every tenant query takes
   an explicit madrasaId that the ROUTE layer resolved from the authenticated
   user (see middleware/tenant.js), and every statement below filters by
   madrasa_id. Platform-wide aggregates are deliberately separate
   (platformAnalytics) and are mounted behind requireSuperAdmin only.

   DIALECT NOTES (sqlite dev / mysql production)
     • Month/day bucketing differs per driver, so the SQL expression comes from
       monthExpr()/dayExpr() after db.dialect().
     • MySQL returns DECIMAL columns as strings, so every numeric read goes
       through num().
     • MySQL returns DATE/TIMESTAMP as JS Date objects, so date columns are
       always projected through dayExpr() rather than selected raw.
   ========================================================================== */
const db = require("../db");
const grading = require("./grading");
const { toNum } = require("../util");

/** Statuses that count as "on the roll" (mirrors students.js / fees.js). */
const ACTIVE_STATUSES = "('active','promoted','suspended')";

/* ------------------------------ helpers -------------------------------- */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, dp = 1) {
  const f = 10 ** dp;
  return Math.round(num(v) * f) / f;
}

/** Percent of part/whole, rounded to 1dp; 0 when there is nothing to divide. */
function pct(part, whole) {
  const w = num(whole);
  if (w <= 0) return 0;
  return round((num(part) / w) * 100, 1);
}

/** 'YYYY-MM-DD' (all dates in this app are plain calendar dates). */
function isoDate(d) {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function daysAgo(n, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** ['2025-10', …, '2026-09'] — the last `count` month keys, ending this month. */
function monthKeys(count, end = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  return out;
}

/** ['2026-09-01', …, '2026-09-09'] — the last `count` day keys, ending today. */
function dayKeys(count, end = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(daysAgo(i, end));
  return out;
}

/** SQL expression bucketing a date/timestamp column into 'YYYY-MM'. */
function monthExpr(column, dialect) {
  return dialect === "mysql"
    ? `DATE_FORMAT(${column}, '%Y-%m')`
    : `strftime('%Y-%m', ${column})`;
}

/** SQL expression projecting a date column as a plain 'YYYY-MM-DD' string. */
function dayExpr(column, dialect) {
  return dialect === "mysql"
    ? `DATE_FORMAT(${column}, '%Y-%m-%d')`
    : `CAST(${column} AS TEXT)`;
}

/** Turns a grouped time series into a gap-filled [{label, value}] list. */
function fillSeries(labels, rows, key = "m", pick = (r) => num(r.n)) {
  const map = new Map(rows.map((r) => [String(r[key]).slice(0, 10), r]));
  return labels.map((label) => {
    const r = map.get(label);
    return { label, value: r ? pick(r) : 0 };
  });
}

/**
 * Clamps a query-string integer into [min, max]. Anything absent, blank or
 * non-numeric yields the fallback — an empty `?months=` means "not supplied",
 * which must not be read as zero and silently clamped to the minimum.
 */
function clampInt(v, min, max, fallback) {
  if (v === null || v === undefined || String(v).trim() === "") return fallback;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* --------------------------- term resolution --------------------------- */

/**
 * The term to report on, in priority order:
 *   1. the term of the CURRENT session that covers today — earliest position
 *      wins, so overlapping (mis-entered) terms still resolve deterministically;
 *   2. otherwise the term that ended most recently (between-terms holiday);
 *   3. otherwise the current session's first term (session not started yet);
 *   4. otherwise the newest session's first term (no session flagged current).
 */
async function currentTerm(madrasaId, today) {
  const base = `SELECT t.id, t.position, t.name_en, t.name_ar, t.session_id, s.label AS session_label
                  FROM terms t
                  JOIN academic_sessions s ON s.id = t.session_id AND s.madrasa_id = t.madrasa_id
                 WHERE t.madrasa_id = ? AND s.is_current = 1`;

  const covering = await db.get(
    base + ` AND (t.start_date IS NULL OR t.start_date <= ?)
                AND (t.end_date IS NULL OR t.end_date >= ?)
            ORDER BY t.position ASC LIMIT 1`,
    [madrasaId, today, today]
  );
  if (covering) return covering;

  const ended = await db.get(
    base + " AND t.end_date < ? ORDER BY t.end_date DESC, t.position DESC LIMIT 1",
    [madrasaId, today]
  );
  if (ended) return ended;

  const firstOfSession = await db.get(base + " ORDER BY t.position ASC LIMIT 1", [madrasaId]);
  if (firstOfSession) return firstOfSession;

  return db.get(
    `SELECT t.id, t.position, t.name_en, t.name_ar, t.session_id, s.label AS session_label
       FROM terms t
       JOIN academic_sessions s ON s.id = t.session_id AND s.madrasa_id = t.madrasa_id
      WHERE t.madrasa_id = ?
      ORDER BY s.is_current DESC, s.id DESC, t.position ASC LIMIT 1`,
    [madrasaId]
  );
}

/* ====================================================================== */
/*  TENANT ANALYTICS — one madrasa                                        */
/* ====================================================================== */

/**
 * @param {number} madrasaId  resolved by the route from the session user
 * @param {object} opts       { months, attendanceDays, termId }
 */
async function tenantAnalytics(madrasaId, opts = {}) {
  const tid = Number(madrasaId);
  if (!Number.isInteger(tid) || tid <= 0) {
    throw new Error("tenantAnalytics requires a positive madrasaId");
  }

  const months = clampInt(opts.months, 3, 36, 12);
  const attendanceDays = clampInt(opts.attendanceDays, 7, 90, 30);
  const dialect = await db.dialect();
  const today = isoDate(new Date());
  const since = daysAgo(attendanceDays - 1);
  const monthStart = today.slice(0, 8) + "01";
  const monthLabels = monthKeys(months);
  const dayLabels = dayKeys(attendanceDays);

  const cfg = await grading.getGradingConfig(tid);

  /* Resolve the reported term. A caller-supplied termId must belong to THIS
     madrasa, otherwise it is ignored (never trust a client-supplied id). */
  let term = null;
  const requested = toNum(opts.termId, 0);
  if (requested) {
    term = await db.get("SELECT id, position, name_en, name_ar, session_id FROM terms WHERE id = ? AND madrasa_id = ?", [requested, tid]);
  }
  if (!term) term = await currentTerm(tid, today);
  const termId = term ? Number(term.id) : 0;

  /* ---------------------------- headline totals ----------------------- */
  const totals = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND status IN ${ACTIVE_STATUSES}) AS students,
       (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND status = 'active')            AS active_students,
       (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND status = 'graduated')         AS graduated,
       (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND status = 'withdrawn')         AS withdrawn,
       (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND class_id IS NULL AND status IN ${ACTIVE_STATUSES}) AS unassigned,
       (SELECT COUNT(*) FROM users WHERE madrasa_id = ? AND role = 'teacher' AND is_active = 1) AS teachers,
       (SELECT COUNT(*) FROM users WHERE madrasa_id = ? AND role = 'parent'  AND is_active = 1) AS parents,
       (SELECT COUNT(*) FROM classes  WHERE madrasa_id = ?) AS classes,
       (SELECT COUNT(*) FROM subjects WHERE madrasa_id = ?) AS subjects`,
    [tid, tid, tid, tid, tid, tid, tid, tid, tid]
  );
  const studentCount = num(totals && totals.students);

  /* ---------------------------- enrolment ----------------------------- */
  const [enrolTrendRows, byClassRows, genderRows, births] = await Promise.all([
    db.all(
      `SELECT ${monthExpr("created_at", dialect)} AS m, COUNT(*) AS n
         FROM students WHERE madrasa_id = ?
        GROUP BY ${monthExpr("created_at", dialect)}`,
      [tid]
    ),
    db.all(
      `SELECT c.id, c.name_en, c.name_ar, c.sort_order, COUNT(s.id) AS n
         FROM classes c
         LEFT JOIN students s
           ON s.class_id = c.id AND s.madrasa_id = c.madrasa_id AND s.status IN ${ACTIVE_STATUSES}
        WHERE c.madrasa_id = ?
        GROUP BY c.id, c.name_en, c.name_ar, c.sort_order
        ORDER BY c.sort_order, c.id`,
      [tid]
    ),
    db.all(
      `SELECT gender, COUNT(*) AS n FROM students
        WHERE madrasa_id = ? AND status IN ${ACTIVE_STATUSES}
        GROUP BY gender`,
      [tid]
    ),
    db.all(
      `SELECT date_of_birth AS dob FROM students
        WHERE madrasa_id = ? AND status IN ${ACTIVE_STATUSES} AND date_of_birth IS NOT NULL`,
      [tid]
    ),
  ]);

  const genderMap = new Map();
  for (const g of genderRows) {
    const key = String(g.gender || "").toUpperCase();
    genderMap.set(key === "M" ? "male" : key === "F" ? "female" : "other", num(g.n));
  }
  const byGender = ["male", "female", "other"]
    .map((k) => ({ key: k, value: genderMap.get(k) || 0 }))
    .filter((x) => x.value > 0);

  const ageBands = [
    { key: "u6", min: 0, max: 5, value: 0 },
    { key: "6_8", min: 6, max: 8, value: 0 },
    { key: "9_11", min: 9, max: 11, value: 0 },
    { key: "12_14", min: 12, max: 14, value: 0 },
    { key: "15_17", min: 15, max: 17, value: 0 },
    { key: "18p", min: 18, max: 999, value: 0 },
  ];
  for (const row of births) {
    const raw = row.dob;
    if (!raw) continue;
    const d = raw instanceof Date ? raw : new Date(String(raw).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) continue;
    let age = new Date().getFullYear() - d.getFullYear();
    const m = new Date().getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) age -= 1;
    const band = ageBands.find((b) => age >= b.min && age <= b.max);
    if (band) band.value += 1;
  }

  /* ---------------------------- attendance ---------------------------- */
  const [attStatusRows, attDailyRows] = await Promise.all([
    db.all(
      "SELECT status, COUNT(*) AS n FROM attendance WHERE madrasa_id = ? AND day >= ? AND day <= ? GROUP BY status",
      [tid, since, today]
    ),
    db.all(
      `SELECT ${dayExpr("day", dialect)} AS d,
              COUNT(*) AS n,
              SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
         FROM attendance WHERE madrasa_id = ? AND day >= ? AND day <= ?
        GROUP BY ${dayExpr("day", dialect)}`,
      [tid, since, today]
    ),
  ]);

  const attCounts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of attStatusRows) {
    const k = String(r.status || "").toLowerCase();
    if (k in attCounts) attCounts[k] = num(r.n);
  }
  const attMarked = attCounts.present + attCounts.absent + attCounts.late + attCounts.excused;

  const dailyMap = new Map(attDailyRows.map((r) => [String(r.d).slice(0, 10), r]));
  const attendanceDaily = dayLabels.map((label) => {
    const r = dailyMap.get(label);
    const marked = r ? num(r.n) : 0;
    return {
      label,
      marked,
      value: marked > 0 ? pct(r.attended, marked) : null, // null = nothing recorded
    };
  });

  /* ------------------------------- fees -------------------------------- */
  const [feeTotals, feeMonth, feeTrendRows, feeMethodRows, billedRow, paidByStudent] = await Promise.all([
    db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount_ngn),0) AS amount FROM fee_payments WHERE madrasa_id = ?", [tid]),
    db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount_ngn),0) AS amount FROM fee_payments WHERE madrasa_id = ? AND payment_date >= ?", [tid, monthStart]),
    db.all(
      `SELECT ${monthExpr("payment_date", dialect)} AS m, COUNT(*) AS n, COALESCE(SUM(amount_ngn),0) AS amount
         FROM fee_payments WHERE madrasa_id = ?
        GROUP BY ${monthExpr("payment_date", dialect)}`,
      [tid]
    ),
    db.all(
      `SELECT method, COUNT(*) AS n, COALESCE(SUM(amount_ngn),0) AS amount
         FROM fee_payments WHERE madrasa_id = ?
        GROUP BY method ORDER BY amount DESC`,
      [tid]
    ),
    db.get("SELECT COALESCE(SUM(amount_ngn),0) AS billed FROM fee_items WHERE madrasa_id = ? AND term_id = ?", [tid, termId]),
    db.all(
      `SELECT fp.student_id, SUM(fp.amount_ngn) AS paid
         FROM fee_payments fp
         JOIN fee_items fi ON fi.id = fp.fee_item_id AND fi.madrasa_id = fp.madrasa_id
        WHERE fp.madrasa_id = ? AND fi.term_id = ?
        GROUP BY fp.student_id`,
      [tid, termId]
    ),
  ]);

  // Billed/outstanding semantics mirror GET /api/fees/balance exactly:
  // the term's fee items are billed to every student on the roll, and only
  // payments allocated to an item in this same term are credited.
  const billedPerStudent = num(billedRow && billedRow.billed);
  const billedTotal = billedPerStudent * studentCount;
  const collected = num(feeTotals && feeTotals.amount);
  const paidMap = new Map(paidByStudent.map((r) => [Number(r.student_id), num(r.paid)]));
  let studentsInDebt = 0;
  let debtTotal = 0;
  if (billedPerStudent > 0) {
    const roll = await db.all(
      `SELECT id FROM students WHERE madrasa_id = ? AND status IN ${ACTIVE_STATUSES}`,
      [tid]
    );
    for (const s of roll) {
      const gap = billedPerStudent - (paidMap.get(Number(s.id)) || 0);
      if (gap > 0) { studentsInDebt += 1; debtTotal += gap; }
    }
  }

  const feesByMethod = feeMethodRows.map((r) => ({
    key: String(r.method || "cash"),
    value: round(num(r.amount), 2),
    payments: num(r.n),
  }));

  /* --------------------------- performance ----------------------------- */
  const [gradeRows, classAvgRows, termAvgRows, summaryTotals] = await Promise.all([
    db.all(
      "SELECT overall_grade AS g, COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND term_id = ? GROUP BY overall_grade",
      [tid, termId]
    ),
    db.all(
      `SELECT c.id, c.name_en, c.name_ar, COUNT(ts.id) AS n, AVG(ts.average) AS avg
         FROM term_summaries ts
         JOIN classes c ON c.id = ts.class_id AND c.madrasa_id = ts.madrasa_id
        WHERE ts.madrasa_id = ? AND ts.term_id = ?
        GROUP BY c.id, c.name_en, c.name_ar
        HAVING COUNT(ts.id) > 0
        ORDER BY avg DESC`,
      [tid, termId]
    ),
    db.all(
      `SELECT t.id, t.position, t.name_en, t.name_ar, s.label AS session_label, s.id AS session_id,
              COUNT(ts.id) AS n, AVG(ts.average) AS avg
         FROM terms t
         JOIN academic_sessions s ON s.id = t.session_id
         LEFT JOIN term_summaries ts ON ts.term_id = t.id AND ts.madrasa_id = t.madrasa_id
        WHERE t.madrasa_id = ?
        GROUP BY t.id, t.position, t.name_en, t.name_ar, s.label, s.id
        ORDER BY s.id, t.position`,
      [tid]
    ),
    db.get(
      `SELECT COUNT(*) AS n,
              AVG(average) AS avg,
              SUM(CASE WHEN average >= ? THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN promotion_status = 'promoted' THEN 1 ELSE 0 END) AS promoted
         FROM term_summaries WHERE madrasa_id = ? AND term_id = ?`,
      [cfg.passMark, tid, termId]
    ),
  ]);

  const gradeOrder = cfg.bands.map((b) => String(b.grade));
  const gradeMap = new Map();
  for (const r of gradeRows) {
    const g = String(r.g || "").trim();
    if (!g) continue;
    gradeMap.set(g, (gradeMap.get(g) || 0) + num(r.n));
  }
  // Always show every configured band so the chart shape is stable; keep any
  // unexpected grade found in the data appended at the end.
  const gradeDistribution = [
    ...gradeOrder.map((g) => ({ grade: g, value: gradeMap.get(g) || 0 })),
    ...Array.from(gradeMap.keys()).filter((g) => !gradeOrder.includes(g)).map((g) => ({ grade: g, value: gradeMap.get(g) })),
  ];

  const classRanking = classAvgRows.map((r) => ({
    id: Number(r.id),
    label: r.name_en,
    labelAr: r.name_ar,
    students: num(r.n),
    value: round(r.avg, 1),
  }));

  const termTrend = termAvgRows.map((r) => ({
    termId: Number(r.id),
    label: `${r.session_label ? r.session_label + " · " : ""}${r.name_en}`,
    labelAr: r.name_ar,
    students: num(r.n),
    value: num(r.n) > 0 ? round(r.avg, 1) : null,
  }));

  const summaryCount = num(summaryTotals && summaryTotals.n);

  /* ----------------------------- watch list ---------------------------- */
  // Students needing attention: below the pass mark, and/or poor attendance in
  // the reporting window. Attendance is only judged when enough days exist.
  const perStudentAtt = await db.all(
    `SELECT student_id, COUNT(*) AS marked,
            SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
       FROM attendance WHERE madrasa_id = ? AND day >= ? AND day <= ?
      GROUP BY student_id`,
    [tid, since, today]
  );
  const attByStudent = new Map(perStudentAtt.map((r) => [Number(r.student_id), { marked: num(r.marked), rate: pct(r.attended, r.marked) }]));

  const rollRows = await db.all(
    `SELECT s.id, s.admission_no, s.first_name, s.last_name, s.name_ar,
            c.name_en AS class_en, c.name_ar AS class_ar,
            ts.average AS average
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN term_summaries ts ON ts.student_id = s.id AND ts.madrasa_id = s.madrasa_id AND ts.term_id = ?
      WHERE s.madrasa_id = ? AND s.status IN ${ACTIVE_STATUSES}`,
    [termId, tid]
  );

  const ATT_FLOOR = 75; // % presence below which attendance is flagged
  const MIN_MARKED_DAYS = 5;
  const watchList = rollRows
    .map((s) => {
      const att = attByStudent.get(Number(s.id)) || { marked: 0, rate: 0 };
      const average = s.average == null ? null : round(s.average, 1);
      const reasons = [];
      if (average != null && average < cfg.passMark) reasons.push("low_grades");
      if (att.marked >= MIN_MARKED_DAYS && att.rate < ATT_FLOOR) reasons.push("low_attendance");
      return {
        id: Number(s.id),
        admissionNo: s.admission_no,
        name: `${s.first_name} ${s.last_name}`.trim(),
        nameAr: s.name_ar || "",
        classEn: s.class_en || "",
        classAr: s.class_ar || "",
        average,
        attendanceRate: att.marked >= MIN_MARKED_DAYS ? att.rate : null,
        reasons,
      };
    })
    .filter((s) => s.reasons.length > 0)
    .sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
      const av = a.average == null ? 999 : a.average;
      const bv = b.average == null ? 999 : b.average;
      return av - bv;
    })
    .slice(0, 10);

  /* ------------------------------ assemble ----------------------------- */
  return {
    generatedAt: new Date().toISOString(),
    window: { months, attendanceDays, since, until: today },
    term: term
      ? {
          id: termId,
          position: num(term.position),
          nameEn: term.name_en,
          nameAr: term.name_ar || "",
          sessionLabel: term.session_label || "",
        }
      : null,
    grading: { passMark: cfg.passMark, caMax: cfg.caMax, examMax: cfg.examMax },
    totals: {
      students: studentCount,
      activeStudents: num(totals && totals.active_students),
      graduated: num(totals && totals.graduated),
      withdrawn: num(totals && totals.withdrawn),
      unassigned: num(totals && totals.unassigned),
      teachers: num(totals && totals.teachers),
      parents: num(totals && totals.parents),
      classes: num(totals && totals.classes),
      subjects: num(totals && totals.subjects),
    },
    enrolment: {
      trend: fillSeries(monthLabels, enrolTrendRows),
      byClass: byClassRows.map((r) => ({
        id: Number(r.id),
        label: r.name_en,
        labelAr: r.name_ar || "",
        value: num(r.n),
      })),
      byGender,
      ageBands: ageBands.map((b) => ({ key: b.key, min: b.min, max: b.max, value: b.value })),
    },
    attendance: {
      marked: attMarked,
      present: attCounts.present,
      late: attCounts.late,
      absent: attCounts.absent,
      excused: attCounts.excused,
      rate: pct(attCounts.present + attCounts.late, attMarked),
      daily: attendanceDaily,
    },
    fees: {
      collected: round(collected, 2),
      payments: num(feeTotals && feeTotals.n),
      thisMonth: round(num(feeMonth && feeMonth.amount), 2),
      thisMonthPayments: num(feeMonth && feeMonth.n),
      billedPerStudent: round(billedPerStudent, 2),
      billedTotal: round(billedTotal, 2),
      outstanding: round(Math.max(0, billedTotal - collected), 2),
      studentsInDebt,
      debtTotal: round(debtTotal, 2),
      collectionRate: billedTotal > 0 ? pct(collected, billedTotal) : 0,
      trend: fillSeries(monthLabels, feeTrendRows, "m", (r) => round(num(r.amount), 2)),
      byMethod: feesByMethod,
    },
    results: {
      termId,
      summaries: summaryCount,
      average: summaryCount > 0 ? round(summaryTotals.avg, 1) : null,
      passRate: summaryCount > 0 ? pct(summaryTotals.passed, summaryCount) : null,
      promoted: num(summaryTotals && summaryTotals.promoted),
      gradeDistribution,
      classRanking,
      termTrend,
    },
    watchList,
  };
}

/* ====================================================================== */
/*  PLATFORM ANALYTICS — super admin only (all tenants, no PII)           */
/* ====================================================================== */

async function platformAnalytics(opts = {}) {
  const months = clampInt(opts.months, 3, 36, 12);
  const dialect = await db.dialect();
  const today = isoDate(new Date());
  const since14 = daysAgo(13);
  const since30 = daysAgo(29);
  const monthLabels = monthKeys(months);

  const totals = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM madaris) AS madaris,
       (SELECT COUNT(*) FROM madaris WHERE status = 'active') AS active_madaris,
       (SELECT COUNT(*) FROM madaris WHERE status = 'suspended') AS suspended_madaris,
       (SELECT COUNT(*) FROM students WHERE status IN ${ACTIVE_STATUSES}) AS students,
       (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND is_active = 1) AS teachers,
       (SELECT COUNT(*) FROM users WHERE role = 'parent' AND is_active = 1) AS parents,
       (SELECT COUNT(*) FROM users WHERE role = 'madrasa_admin' AND is_active = 1) AS madrasa_admins,
       (SELECT COUNT(*) FROM users WHERE is_active = 1) AS users,
       (SELECT COALESCE(SUM(amount_ngn),0) FROM fee_payments) AS fees_collected`
  );

  const [madrasaTrendRows, studentTrendRows, topMadaris, planRows, feeTrendRows, activityRows, actionRows, newStudents, recentMadaris] = await Promise.all([
    db.all(
      `SELECT ${monthExpr("created_at", dialect)} AS m, COUNT(*) AS n FROM madaris GROUP BY ${monthExpr("created_at", dialect)}`,
      []
    ),
    db.all(
      `SELECT ${monthExpr("created_at", dialect)} AS m, COUNT(*) AS n FROM students GROUP BY ${monthExpr("created_at", dialect)}`,
      []
    ),
    db.all(
      `SELECT m.id, m.slug, m.name_en, m.name_ar, m.status,
              (SELECT COUNT(*) FROM students s WHERE s.madrasa_id = m.id AND s.status IN ${ACTIVE_STATUSES}) AS students,
              (SELECT COALESCE(SUM(p.amount_ngn),0) FROM fee_payments p WHERE p.madrasa_id = m.id) AS fees
         FROM madaris m
        ORDER BY students DESC, m.id DESC LIMIT 10`
    ),
    db.all(
      `SELECT p.code, p.name, COUNT(m.id) AS madaris,
              (SELECT COUNT(*) FROM students s JOIN madaris mm ON mm.id = s.madrasa_id
                WHERE mm.plan_id = p.id AND s.status IN ${ACTIVE_STATUSES}) AS students
         FROM plans p LEFT JOIN madaris m ON m.plan_id = p.id
        GROUP BY p.code, p.name, p.sort_order
        ORDER BY p.sort_order`
    ),
    db.all(
      `SELECT ${monthExpr("payment_date", dialect)} AS m, COUNT(*) AS n, COALESCE(SUM(amount_ngn),0) AS amount
         FROM fee_payments GROUP BY ${monthExpr("payment_date", dialect)}`
    ),
    db.all(
      `SELECT ${dayExpr("created_at", dialect)} AS d, COUNT(*) AS n
         FROM activity_log WHERE created_at >= ? GROUP BY ${dayExpr("created_at", dialect)}`,
      [since14 + " 00:00:00"]
    ),
    db.all(
      "SELECT action, COUNT(*) AS n FROM activity_log GROUP BY action ORDER BY n DESC LIMIT 8"
    ),
    db.get("SELECT COUNT(*) AS n FROM students WHERE created_at >= ?", [since30 + " 00:00:00"]),
    db.all(
      `SELECT m.id, m.slug, m.name_en, m.name_ar, m.status, m.created_at
         FROM madaris m ORDER BY m.id DESC LIMIT 5`
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    window: { months, since: daysAgo(months * 30), until: today },
    totals: {
      madaris: num(totals && totals.madaris),
      activeMadaris: num(totals && totals.active_madaris),
      suspendedMadaris: num(totals && totals.suspended_madaris),
      students: num(totals && totals.students),
      teachers: num(totals && totals.teachers),
      parents: num(totals && totals.parents),
      madrasaAdmins: num(totals && totals.madrasa_admins),
      users: num(totals && totals.users),
      newStudents30d: num(newStudents && newStudents.n),
      feesCollected: round(num(totals && totals.fees_collected), 2),
    },
    madrasaTrend: fillSeries(monthLabels, madrasaTrendRows),
    studentTrend: fillSeries(monthLabels, studentTrendRows),
    feeTrend: fillSeries(monthLabels, feeTrendRows, "m", (r) => round(num(r.amount), 2)),
    topMadaris: topMadaris.map((m) => ({
      id: Number(m.id),
      slug: m.slug,
      label: m.name_en,
      labelAr: m.name_ar || "",
      status: m.status,
      students: num(m.students),
      fees: round(num(m.fees), 2),
    })),
    byPlan: planRows.map((p) => ({
      code: p.code,
      label: p.name || p.code,
      madaris: num(p.madaris),
      students: num(p.students),
    })),
    activity: {
      daily: fillSeries(dayKeys(14), activityRows, "d"),
      topActions: actionRows.map((a) => ({ action: a.action, value: num(a.n) })),
    },
    recentMadaris: recentMadaris.map((m) => ({
      id: Number(m.id),
      slug: m.slug,
      label: m.name_en,
      labelAr: m.name_ar || "",
      status: m.status,
      createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at || ""),
    })),
  };
}

module.exports = {
  tenantAnalytics,
  platformAnalytics,
  currentTerm,
  // exported for tests
  _internals: { monthKeys, dayKeys, monthExpr, dayExpr, fillSeries, pct, round, isoDate, daysAgo },
};
