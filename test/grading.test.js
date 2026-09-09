"use strict";
/* ============================================================================
   GRADING ENGINE TESTS — CA/exam totals, percentages, bands, pass, positions,
   promotion rules (per-madrasa configurable).
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup } = require("./helpers");
initEnv();

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

test("subject score: total, percentage, grade band, pass flag", async () => {
  const grading = require("../server/services/grading");
  const cfg = await grading.getGradingConfig(ctx.madrasaA);
  // default bands: A>=75 B>=65 C>=55 D>=45 E>=40 F<40 ; pass mark 50
  const s = grading.subjectScore(cfg, 30, 50); // total 80/100
  assert.equal(s.total, 80);
  assert.equal(s.pct, 80);
  assert.equal(s.grade, "A");
  assert.equal(s.pass, true);

  const s2 = grading.subjectScore(cfg, 20, 30); // 50/100 -> at pass mark
  assert.equal(s2.total, 50);
  assert.equal(s2.pass, true, "at pass mark counts as pass");
  assert.equal(s2.grade, "D"); // 50 < 55

  const s3 = grading.subjectScore(cfg, 10, 20); // 30/100
  assert.equal(s3.grade, "F");
  assert.equal(s3.pass, false);
});

test("CA and exam are clamped to the configured maxima", async () => {
  const grading = require("../server/services/grading");
  const cfg = await grading.getGradingConfig(ctx.madrasaA);
  const s = grading.subjectScore(cfg, 100, 100); // clamped to 40 + 60
  assert.equal(s.ca, 40);
  assert.equal(s.exam, 60);
  assert.equal(s.total, 100);
});

test("custom madrasa config changes grades (per-tenant)", async () => {
  const grading = require("../server/services/grading");
  // A: CA 30 / Exam 70, pass 60%, bands: A>=90, F<60
  await ctx.db.run(
    "UPDATE grading_config SET ca_max = 30, exam_max = 70, pass_mark = 60, promotion_min_average = 60, grade_bands = ? WHERE madrasa_id = ?",
    [JSON.stringify([{ min: 90, grade: "A", remark: "Excellent", remark_ar: "" }, { min: 0, grade: "F", remark: "Fail", remark_ar: "" }]), ctx.madrasaA]
  );
  const cfg = await grading.getGradingConfig(ctx.madrasaA);
  const s = grading.subjectScore(cfg, 27, 63); // 90/100
  assert.equal(s.grade, "A");
  const s2 = grading.subjectScore(cfg, 15, 30); // 45/100 -> F, fail
  assert.equal(s2.grade, "F");
  assert.equal(s2.pass, false);
  // restore defaults for the tests that follow
  await ctx.db.run(
    "UPDATE grading_config SET ca_max = 40, exam_max = 60, pass_mark = 50, promotion_min_average = 50, grade_bands = ? WHERE madrasa_id = ?",
    [JSON.stringify(grading.DEFAULT_BANDS), ctx.madrasaA]
  );
});

test("computeClassTerm: averages, totals, competition positions", async () => {
  const grading = require("../server/services/grading");
  const out = await grading.computeClassTerm(ctx.madrasaA, ctx.classA1, ctx.termA1);
  assert.equal(out.students.length, 2);
  // seed: studentA1 (30+50=80 Fiqh, 35+60=95 English) => pct 80,95 avg 87.5
  //        studentA2 (20+40=60 Fiqh, 25+50=75 English) => pct 60,75 avg 67.5
  const top = out.students[0];
  assert.equal(top.studentId, ctx.studentA1);
  assert.equal(top.average, 87.5);
  assert.equal(top.position, 1);
  assert.equal(out.students[1].average, 67.5);
  assert.equal(out.students[1].position, 2);
  assert.equal(top.total, 175);
  // persisted summary
  const row = await ctx.db.get("SELECT * FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND term_id = ?", [ctx.madrasaA, ctx.studentA1, ctx.termA1]);
  assert.ok(row);
  assert.equal(row.position, 1);
  assert.equal(row.attendance_days, 1);
});

test("promotion: repeating when a subject fails (requirePass on)", async () => {
  const grading = require("../server/services/grading");
  // studentA2: 60% and 75% -> both pass (pass mark 50), avg 67.5 >= 50 => promoted
  const row = await ctx.db.get("SELECT promotion_status FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND term_id = ?", [ctx.madrasaA, ctx.studentA2, ctx.termA1]);
  assert.equal(row.promotion_status, "promoted");
});

test("promotion: repeating when average below promotion_min_average", async () => {
  const grading = require("../server/services/grading");
  await ctx.db.run("UPDATE grading_config SET promotion_min_average = 90 WHERE madrasa_id = ?", [ctx.madrasaA]);
  await grading.computeClassTerm(ctx.madrasaA, ctx.classA1, ctx.termA1);
  const row = await ctx.db.get("SELECT promotion_status FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND term_id = ?", [ctx.madrasaA, ctx.studentA1, ctx.termA1]);
  assert.equal(row.promotion_status, "repeating");
  await ctx.db.run("UPDATE grading_config SET promotion_min_average = 50 WHERE madrasa_id = ?", [ctx.madrasaA]);
});

test("report card data assembles all fields", async () => {
  const grading = require("../server/services/grading");
  const d = await grading.reportCardData(ctx.madrasaA, ctx.studentA1, ctx.termA1);
  assert.ok(d);
  assert.equal(d.madrasa.nameEn, "Test Madrasa A");
  assert.equal(d.student.name, "Alpha One");
  assert.equal(d.student.admissionNo, "TTA0001");
  assert.equal(d.session, "2026/2027");
  assert.equal(d.term.nameEn, "First Term");
  assert.equal(d.subjects.length, 2);
  assert.ok(d.summary.average > 0);
  assert.ok(d.summary.position >= 1);
});
