"use strict";
/* ============================================================================
   ANALYTICS TESTS — dashboard aggregates (tenant + platform)
   ----------------------------------------------------------------------------
   Covers:
     • the arithmetic of every headline number (attendance, fees, results)
     • tenant isolation: a madrasa admin can never see another tenant's data,
       and a client-supplied madrasaId is ignored
     • role gating on both endpoints
     • range clamping and the pure helpers behind the time series
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB, teacherA, studentA, parentA, superAdmin;

/* --------------------------- test fixture data --------------------------- */

function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

before(async () => {
  ctx = await setup();
  const db = ctx.db;

  // --- attendance: replace the helper rows with a known, counted set --------
  // studentA1: 8 present / 2 absent  (80%)
  // studentA2: 5 present / 5 absent  (50%  -> below the 75% floor)
  await db.run("DELETE FROM attendance WHERE madrasa_id = ?", [ctx.madrasaA]);
  const attPlan = [
    [ctx.studentA1, ["p", "p", "a", "p", "p", "p", "a", "p", "p", "p"]],
    [ctx.studentA2, ["p", "a", "p", "a", "p", "a", "p", "a", "p", "a"]],
  ];
  for (const [sid, marks] of attPlan) {
    for (let i = 0; i < marks.length; i++) {
      await db.run(
        "INSERT INTO attendance (madrasa_id, student_id, class_id, term_id, day, status) VALUES (?,?,?,?,?,?)",
        [ctx.madrasaA, sid, ctx.classA1, ctx.termA1, daysAgo(i), marks[i] === "p" ? "present" : "absent"]
      );
    }
  }

  // --- fees: 6500 billed per student, 2 students on the roll = 13000 --------
  await db.run("DELETE FROM fee_payments WHERE madrasa_id = ?", [ctx.madrasaA]);
  await db.run("DELETE FROM fee_items WHERE madrasa_id = ?", [ctx.madrasaA]);
  const fee1 = (await db.run(
    "INSERT INTO fee_items (madrasa_id, term_id, name_en, amount_ngn) VALUES (?,?,?,?)",
    [ctx.madrasaA, ctx.termA1, "Tuition", 5000]
  )).lastInsertRowid;
  const fee2 = (await db.run(
    "INSERT INTO fee_items (madrasa_id, term_id, name_en, amount_ngn) VALUES (?,?,?,?)",
    [ctx.madrasaA, ctx.termA1, "Books", 1500]
  )).lastInsertRowid;
  // A1 settles in full; A2 pays 2000. Deliberately in different months so the
  // monthly collection series has more than one bucket.
  await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaA, ctx.studentA1, fee1, 5000, daysAgo(3), "cash"]
  );
  await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaA, ctx.studentA1, fee2, 1500, daysAgo(3), "cash"]
  );
  await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaA, ctx.studentA2, fee1, 2000, daysAgo(40), "bank"]
  );

  // --- results: drag studentA2 below the pass mark so both watch-list reasons
  //     (low grades + low attendance) are exercised ---------------------------
  await db.run(
    "UPDATE results SET ca = 10, exam = 10, total = 20 WHERE madrasa_id = ? AND student_id = ? AND term_id = ?",
    [ctx.madrasaA, ctx.studentA2, ctx.termA1]
  );
  // Publish summaries through the real grading engine (as an admin would).
  const grading = require("../server/services/grading");
  await grading.computeClassTerm(ctx.madrasaA, ctx.classA1, ctx.termA1, ctx.users.adminA);

  // --- clients -------------------------------------------------------------
  adminA = new Client(ctx.base); await adminA.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  teacherA = new Client(ctx.base); await teacherA.login("teacher-a", PASSWORD);
  studentA = new Client(ctx.base); await studentA.login("student-a1", PASSWORD);
  parentA = new Client(ctx.base); await parentA.login("parent-a", PASSWORD);
  superAdmin = new Client(ctx.base); await superAdmin.login("testadmin", SA_PASSWORD);
});

after(async () => { await ctx.close(); });

const get = (client, q = "") => client.api("GET", "/api/madrasa/analytics" + q);

/* =============================== tenant ================================== */

test("tenant analytics: headline totals count only this madrasa", async () => {
  const r = await get(adminA);
  assert.equal(r.status, 200);
  const a = r.data.analytics;
  assert.equal(r.data.madrasaId, ctx.madrasaA);
  assert.equal(a.totals.students, 2, "madrasa A has 2 students on the roll");
  assert.equal(a.totals.classes, 2);
  assert.equal(a.totals.subjects, 2);
  assert.equal(a.totals.teachers, 1);
  assert.equal(a.totals.parents, 1, "only the parent account belonging to A");
});

test("tenant analytics: attendance rate and daily series are computed correctly", async () => {
  const a = (await get(adminA)).data.analytics;
  assert.equal(a.attendance.marked, 20);
  assert.equal(a.attendance.present, 13);
  assert.equal(a.attendance.absent, 7);
  assert.equal(a.attendance.excused, 0);
  assert.equal(a.attendance.rate, 65, "13/20 = 65%");

  // One bucket per day of the window; the 10 seeded days carry data.
  assert.equal(a.attendance.daily.length, 30, "default window is 30 days");
  const withData = a.attendance.daily.filter((d) => d.marked > 0);
  assert.equal(withData.length, 10);
  assert.ok(withData.every((d) => d.value >= 0 && d.value <= 100));
  // Every seeded day is exactly one of the two students -> 0%, 50% or 100%.
  assert.ok(withData.every((d) => [0, 50, 100].includes(d.value)), "single-student days are 0/50/100%");
});

test("tenant analytics: fees billed/outstanding match the /fees/balance semantics", async () => {
  const a = (await get(adminA)).data.analytics;
  assert.equal(a.fees.collected, 8500);
  assert.equal(a.fees.payments, 3);
  assert.equal(a.fees.billedPerStudent, 6500);
  assert.equal(a.fees.billedTotal, 13000, "6500 x 2 students on the roll");
  assert.equal(a.fees.outstanding, 4500);
  assert.equal(a.fees.studentsInDebt, 1, "only student A2 still owes");
  assert.equal(a.fees.collectionRate, 65.4);
  const methods = Object.fromEntries(a.fees.byMethod.map((m) => [m.key, m.value]));
  assert.equal(methods.cash, 6500);
  assert.equal(methods.bank, 2000);
});

test("tenant analytics: fee balance agrees with GET /api/fees/balance", async () => {
  const a = (await get(adminA)).data.analytics;
  const bal = await adminA.api("GET", `/api/fees/balance?termId=${ctx.termA1}`);
  assert.equal(bal.status, 200);
  const billed = bal.data.billed;
  assert.equal(a.fees.billedPerStudent, billed, "same per-student billing figure");
  const totalOutstanding = bal.data.students.reduce((s, x) => s + x.balance, 0);
  assert.equal(a.fees.debtTotal, totalOutstanding);
  assert.equal(a.fees.studentsInDebt, bal.data.students.filter((x) => !x.settled).length);
});

test("tenant analytics: grade distribution and class averages come from summaries", async () => {
  const a = (await get(adminA)).data.analytics;
  const grades = Object.fromEntries(a.results.gradeDistribution.map((g) => [g.grade, g.value]));
  assert.equal(a.results.summaries, 2);
  assert.equal(grades.A, 1, "studentA1 averages 87.5");
  assert.equal(grades.F, 1, "studentA2 was dragged to 20");
  assert.equal(grades.B, 0);
  assert.equal(a.results.average, 53.8, "(87.5 + 20) / 2");
  assert.equal(a.results.passRate, 50, "1 of 2 clears the 50% pass mark");
  assert.equal(a.results.classRanking.length, 1);
  assert.equal(a.results.classRanking[0].label, "Class A1");
  assert.equal(a.results.classRanking[0].students, 2);
  assert.equal(a.results.classRanking[0].value, 53.8);
});

test("tenant analytics: watch list flags low grades and low attendance together", async () => {
  const a = (await get(adminA)).data.analytics;
  assert.equal(a.watchList.length, 1, "only studentA2 is in trouble");
  const w = a.watchList[0];
  assert.equal(w.id, ctx.studentA2);
  assert.equal(w.average, 20);
  assert.equal(w.attendanceRate, 50);
  assert.deepEqual(w.reasons.sort(), ["low_attendance", "low_grades"]);
  assert.equal(a.grading.passMark, 50);
});

test("tenant analytics: enrolment series is gap-filled over the whole window", async () => {
  const a = (await get(adminA)).data.analytics;
  assert.equal(a.enrolment.trend.length, 12);
  const total = a.enrolment.trend.reduce((s, x) => s + x.value, 0);
  // The helpers inserted both students at setup time (this month).
  assert.equal(total, 2, "both A students land in the current month bucket");
  assert.equal(a.enrolment.trend[11].value, 2);
  assert.equal(a.enrolment.byClass.length, 2);
  const byClass = Object.fromEntries(a.enrolment.byClass.map((c) => [c.label, c.value]));
  assert.equal(byClass["Class A1"], 2);
  assert.equal(byClass["Class A2"], 0, "an empty class still appears as a zero bar");
  const gender = Object.fromEntries(a.enrolment.byGender.map((g) => [g.key, g.value]));
  assert.equal(gender.male, 1);
  assert.equal(gender.female, 1);
});

test("tenant analytics: an unknown termId from the client is ignored", async () => {
  // termId 999 does not exist; madrasa B's term must not be reachable either.
  const termB = (await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? LIMIT 1", [ctx.madrasaB])).id;
  const r = await get(adminA, `?termId=${termB}`);
  assert.equal(r.status, 200);
  const a = r.data.analytics;
  assert.notEqual(a.results.termId, termB, "another tenant's term is never used");
  const own = (await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? AND position = 1", [ctx.madrasaA])).id;
  assert.equal(a.results.termId, own, "falls back to this madrasa's current term");
});

/* =========================== tenant isolation ============================ */

test("isolation: madrasa A's analytics never contain madrasa B's records", async () => {
  const a = (await get(adminA)).data.analytics;
  const bStudents = (await ctx.db.get("SELECT COUNT(*) AS n FROM students WHERE madrasa_id = ?", [ctx.madrasaB])).n;
  assert.equal(bStudents, 1, "fixture sanity: B really has a student");
  assert.equal(a.totals.students, 2, "B's student is not counted");
  const labels = a.enrolment.byClass.map((c) => c.label);
  assert.ok(labels.includes("Class A1") && !labels.includes("Class B1"));
  assert.equal(a.fees.collected, 8500);
});

test("isolation: a client-supplied madrasaId is ignored for tenant users", async () => {
  const r = await get(adminA, `?madrasaId=${ctx.madrasaB}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.madrasaId, ctx.madrasaA, "still scoped to the caller's own madrasa");
  assert.equal(r.data.analytics.totals.students, 2);
});

test("isolation: madrasa B's admin sees only B", async () => {
  const a = (await get(adminB)).data.analytics;
  assert.equal(a.totals.students, 1);
  assert.equal(a.fees.collected, 0);
  assert.equal(a.results.summaries, 0);
});

test("isolation: super admin may inspect a specific madrasa, but must name one", async () => {
  const b = await get(superAdmin, `?madrasaId=${ctx.madrasaB}`);
  assert.equal(b.status, 200);
  assert.equal(b.data.madrasaId, ctx.madrasaB);
  assert.equal(b.data.analytics.totals.students, 1);

  const a = await get(superAdmin, `?madrasaId=${ctx.madrasaA}`);
  assert.equal(a.data.analytics.totals.students, 2);

  const none = await get(superAdmin);
  assert.equal(none.status, 400, "super admin without madrasaId is a bad request");
});

/* ============================== role gating ============================== */

test("roles: teacher, student and parent cannot read tenant analytics", async () => {
  assert.equal((await get(teacherA)).status, 403);
  assert.equal((await get(studentA)).status, 403);
  assert.equal((await get(parentA)).status, 403);
});

test("roles: anonymous requests are rejected", async () => {
  const anon = new Client(ctx.base);
  const r = await anon.api("GET", "/api/madrasa/analytics");
  assert.equal(r.status, 401);
});

/* ============================ platform scope ============================= */

test("platform analytics: super admin sees every tenant", async () => {
  const r = await superAdmin.api("GET", "/api/platform/analytics?months=12");
  assert.equal(r.status, 200);
  const a = r.data.analytics;
  assert.equal(a.totals.madaris, 2);
  assert.equal(a.totals.students, 3, "2 in A + 1 in B");
  assert.equal(a.totals.feesCollected, 8500);
  assert.equal(a.madrasaTrend.length, 12);
  assert.equal(a.topMadaris.length, 2);
  const top = a.topMadaris[0];
  assert.equal(top.students, 2, "sorted by student count");
  const plans = Object.fromEntries(a.byPlan.map((p) => [p.code, p.madaris]));
  assert.equal(plans.free, 2, "both fixture madaris are on the free plan");
});

test("platform analytics: a madrasa admin cannot read platform aggregates", async () => {
  assert.equal((await adminA.api("GET", "/api/platform/analytics")).status, 403);
  assert.equal((await teacherA.api("GET", "/api/platform/analytics")).status, 403);
});

/* ================================ ranges ================================= */

test("ranges: months and attendanceDays are clamped to safe bounds", async () => {
  const big = (await get(adminA, "?months=999&attendanceDays=999")).data.analytics;
  assert.equal(big.window.months, 36);
  assert.equal(big.window.attendanceDays, 90);
  assert.equal(big.enrolment.trend.length, 36);
  assert.equal(big.attendance.daily.length, 90);

  const small = (await get(adminA, "?months=0&attendanceDays=1")).data.analytics;
  assert.equal(small.window.months, 3);
  assert.equal(small.window.attendanceDays, 7);

  const junk = (await get(adminA, "?months=abc&attendanceDays=")).data.analytics;
  assert.equal(junk.window.months, 12, "non-numeric input falls back to the default");
  assert.equal(junk.window.attendanceDays, 30);
});

test("ranges: a wider attendance window never loses the seeded days", async () => {
  const a = (await get(adminA, "?attendanceDays=90")).data.analytics;
  assert.equal(a.attendance.marked, 20);
  assert.equal(a.attendance.rate, 65);
  assert.equal(a.fees.trend.filter((x) => x.value > 0).length, 2, "two distinct payment months");
});

/* ============================== pure helpers ============================= */

test("helpers: month keys, series filling and percentage math", () => {
  const { monthKeys, dayKeys, fillSeries, pct, round, monthExpr, dayExpr } = require("../server/services/analytics")._internals;

  assert.equal(monthKeys(3, new Date(2026, 0, 15)).join(","), "2025-11,2025-12,2026-01", "rolls over the year boundary");
  assert.equal(monthKeys(1, new Date(2026, 8, 9)).join(","), "2026-09");
  assert.equal(dayKeys(3, new Date(2026, 0, 2)).join(","), "2025-12-31,2026-01-01,2026-01-02");

  const filled = fillSeries(["2026-07", "2026-08", "2026-09"], [{ m: "2026-09", n: 4 }]);
  assert.deepEqual(filled, [
    { label: "2026-07", value: 0 },
    { label: "2026-08", value: 0 },
    { label: "2026-09", value: 4 },
  ]);

  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(5, 0), 0, "no divide-by-zero");
  assert.equal(pct(0, 0), 0);
  assert.equal(round("12.345", 1), 12.3, "MySQL DECIMAL strings are coerced");
  assert.equal(round(null, 1), 0);

  // The date-bucketing expressions are the only dialect-specific SQL here; the
  // MySQL branch cannot be exercised against SQLite, so pin the exact strings
  // it must emit (a typo would otherwise only surface in production).
  assert.equal(monthExpr("created_at", "sqlite"), "strftime('%Y-%m', created_at)");
  assert.equal(monthExpr("created_at", "mysql"), "DATE_FORMAT(created_at, '%Y-%m')");
  assert.equal(dayExpr("day", "sqlite"), "CAST(day AS TEXT)");
  assert.equal(dayExpr("day", "mysql"), "DATE_FORMAT(day, '%Y-%m-%d')");
});
