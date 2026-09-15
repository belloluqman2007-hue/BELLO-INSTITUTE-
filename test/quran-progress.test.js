"use strict";
/* Qur'an/Hifz is an optional Islamic module on the shared tenant engine. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx, adminA, adminB, teacherA, parentA;
before(async () => {
  ctx = await setup();
  // The B fixture is a Western academy. It still has the same tables and
  // shared admin API, but must never receive the Islamic tracking module.
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
  adminA = new Client(ctx.base); await adminA.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  teacherA = new Client(ctx.base); await teacherA.login("teacher-a", PASSWORD);
  parentA = new Client(ctx.base); await parentA.login("parent-a", PASSWORD);
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic administrators can configure and manage scoped Hifz records", async () => {
  const config = await adminA.api("GET", "/api/quran-progress/config");
  assert.equal(config.status, 200);
  assert.equal(config.data.enabled, true, "Islamic tracking is enabled by default until an administrator opts out");
  assert.equal(config.data.category, "islamic");

  const created = await adminA.api("POST", "/api/quran-progress", {
    student_id: ctx.studentA1,
    progress_date: "2026-09-15",
    surah: "Al-Fatihah",
    juz: "Juz 1",
    ayah_from: 1,
    ayah_to: 7,
    memorization_progress: 80,
    revision_progress: 55,
    recitation_assessment: 5,
    tajweed_assessment: 4,
    performance_status: "excellent",
    teacher_comments: "Strong recitation and careful makharij.",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.ok(created.data.id > 0);

  const list = await adminA.api("GET", `/api/quran-progress?studentId=${ctx.studentA1}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.records.length, 1);
  assert.equal(list.data.records[0].surah, "Al-Fatihah");
  assert.equal(Number(list.data.records[0].memorization_progress), 80);

  const overview = await adminA.api("GET", "/api/quran-progress/overview");
  assert.equal(overview.status, 200);
  assert.deepEqual(overview.data.totals, { records: 1, students: 1, memorizationAverage: 80, revisionAverage: 55 });
  assert.deepEqual(overview.data.byStatus, [{ status: "excellent", count: 1 }]);

  const invalidPartialRange = await adminA.api("PATCH", `/api/quran-progress/${created.data.id}`, { ayah_from: 10 });
  assert.equal(invalidPartialRange.status, 400, "a partial edit cannot invert the saved ayah range");
  const updated = await adminA.api("PATCH", `/api/quran-progress/${created.data.id}`, {
    memorizationProgress: 90, performanceStatus: "good",
  });
  assert.equal(updated.status, 200);
  const afterUpdate = await adminA.api("GET", `/api/quran-progress?studentId=${ctx.studentA1}`);
  assert.equal(Number(afterUpdate.data.records[0].memorization_progress), 90);
  assert.equal(afterUpdate.data.records[0].performance_status, "good");
});

test("teachers can add records only for assigned learners and only edit their own", async () => {
  const mine = await teacherA.api("POST", "/api/quran-progress", {
    studentId: ctx.studentA1, date: "2026-09-15", surah: "Al-Ikhlas", memorizationProgress: 60,
  });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));

  const records = await adminA.api("GET", `/api/quran-progress?studentId=${ctx.studentA1}`);
  const adminRecord = records.data.records.find((row) => Number(row.recorded_by) === ctx.users.adminA);
  const teacherRecord = records.data.records.find((row) => Number(row.recorded_by) === ctx.users.teacherA);
  assert.ok(adminRecord && teacherRecord);
  assert.equal((await teacherA.api("PATCH", `/api/quran-progress/${adminRecord.id}`, { revisionProgress: 80 })).status, 404);
  assert.equal((await teacherA.api("PATCH", `/api/quran-progress/${teacherRecord.id}`, { revisionProgress: 80 })).status, 200);

  const outOfScope = await teacherA.api("POST", "/api/quran-progress", {
    student_id: ctx.studentB1, progress_date: "2026-09-15", surah: "Al-Falaq",
  });
  assert.equal(outOfScope.status, 404, "a teacher cannot reach another tenant's learner");
  assert.equal((await parentA.api("GET", "/api/quran-progress")).status, 403, "families cannot open the staff Hifz register");
});

test("an Islamic administrator can disable tracking while Western academies never receive it", async () => {
  assert.equal((await teacherA.api("PUT", "/api/quran-progress/config", { enabled: false })).status, 403);
  const disabled = await adminA.api("PUT", "/api/quran-progress/config", { enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.enabled, false);
  assert.equal((await adminA.api("GET", "/api/quran-progress")).status, 403);
  const config = await adminA.api("GET", "/api/quran-progress/config");
  assert.equal(config.status, 200);
  assert.equal(config.data.enabled, false);

  const western = await adminB.api("GET", "/api/quran-progress/config");
  assert.equal(western.status, 404);
  assert.match(western.data.error, /not enabled for this academy/i);
});
