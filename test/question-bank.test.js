"use strict";
/* ============================================================================
   QUESTION BANK — tests
   ----------------------------------------------------------------------------
   The reusable question store that complements the existing exams module:
   CRUD, subject/class scoping, permission gates (questionbank.view /
   questionbank.manage), teacher ownership of their own questions, and tenant
   isolation.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();

let ctx;
let admin, teacher, adminB;
let teacherBId;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base); await admin.login("admin-a", PASSWORD);
  teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
});
test.after(async () => { await ctx.close(); });

test("questions are created, listed, filtered and archived", async () => {
  const create = await admin.api("POST", "/api/academic/questions", {
    question_text: "How many ayat are in Surah Al-Fatiha?",
    question_type: "short_answer", correct_answer: "7", marks: 2,
    subject_id: ctx.subjA1, class_id: ctx.classA1, difficulty: "easy", tags: "quran,basics",
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const id = create.data.id;

  const list = await admin.api("GET", "/api/academic/questions");
  assert.equal(list.status, 200);
  const row = (list.data.questions || []).find((q) => q.id === id);
  assert.ok(row, "the question is listed");
  assert.equal(row.subject_name, "Fiqh");
  assert.equal(row.marks, 2);

  const bySubject = await admin.api("GET", `/api/academic/questions?subjectId=${ctx.subjA1}`);
  assert.ok((bySubject.data.questions || []).some((q) => q.id === id), "subject filter works");
  const bySearch = await admin.api("GET", "/api/academic/questions?q=al-fatiha");
  assert.ok((bySearch.data.questions || []).some((q) => q.id === id), "text search works");

  const patch = await admin.api("PATCH", `/api/academic/questions/${id}`, { marks: 5, difficulty: "hard" });
  assert.equal(patch.status, 200);
  const after = await admin.api("GET", "/api/academic/questions");
  assert.equal((after.data.questions || []).find((q) => q.id === id).marks, 5, "edits stick");

  const archive = await admin.api("DELETE", `/api/academic/questions/${id}`);
  assert.equal(archive.status, 200);
  const archivedList = await admin.api("GET", "/api/academic/questions");
  assert.ok(!(archivedList.data.questions || []).some((q) => q.id === id), "archived questions leave the default list");
});

test("question bank access follows the granular permissions", async () => {
  // A teacher holds questionbank.view by default: reading works, writing is refused.
  assert.equal((await teacher.api("GET", "/api/academic/questions")).status, 200, "teachers may read the bank");
  const write = await teacher.api("POST", "/api/academic/questions", { question_text: "Teacher question?", marks: 1 });
  assert.equal(write.status, 403, "teachers may not create questions without questionbank.manage");

  // Grant questionbank.manage → the teacher can now write, but only edit their own.
  const grant = await admin.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, { granted: ["questionbank.manage"] });
  assert.equal(grant.status, 200);
  try {
    const teacherQ = await teacher.api("POST", "/api/academic/questions", { question_text: "Name the five pillars.", marks: 5, subject_id: ctx.subjA1 });
    assert.equal(teacherQ.status, 200, "with the grant, the teacher can create");
    const adminQ = await admin.api("POST", "/api/academic/questions", { question_text: "Administrator question.", marks: 1 });
    assert.equal(adminQ.status, 200);
    assert.equal((await teacher.api("PATCH", `/api/academic/questions/${adminQ.data.id}`, { marks: 2 })).status, 403,
      "a teacher cannot edit someone else's question");
    assert.equal((await teacher.api("PATCH", `/api/academic/questions/${teacherQ.data.id}`, { marks: 3 })).status, 200,
      "a teacher can edit their own question");
    assert.equal((await teacher.api("DELETE", `/api/academic/questions/${adminQ.data.id}`)).status, 403);
    await admin.api("DELETE", `/api/academic/questions/${adminQ.data.id}`);
    await admin.api("DELETE", `/api/academic/questions/${teacherQ.data.id}`);
  } finally {
    await admin.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, { granted: [] });
  }
});

test("question bank writes are isolated per tenant", async () => {
  const mine = await admin.api("POST", "/api/academic/questions", { question_text: "A-only question?", marks: 1 });
  assert.equal(mine.status, 200);
  const listB = await adminB.api("GET", "/api/academic/questions");
  assert.ok(!(listB.data.questions || []).some((q) => q.id === mine.data.id), "B never sees A's questions");
  assert.equal((await adminB.api("PATCH", `/api/academic/questions/${mine.data.id}`, { question_text: "steal" })).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/academic/questions/${mine.data.id}`)).status, 404);
  // A cross-tenant subject id is rejected outright on create.
  assert.equal((await adminB.api("POST", "/api/academic/questions", { question_text: "B question", marks: 1, subject_id: ctx.subjA1 })).status, 400,
    "B cannot attach A's subject to a question");
  await admin.api("DELETE", `/api/academic/questions/${mine.data.id}`);
});

test("validation rejects malformed questions", async () => {
  const before = await ctx.db.get("SELECT COUNT(*) AS n FROM question_bank WHERE madrasa_id = ?", [ctx.madrasaA]);
  assert.equal((await admin.api("POST", "/api/academic/questions", { marks: 1 })).status, 400, "text required");
  assert.equal((await admin.api("POST", "/api/academic/questions", { question_text: "x", marks: 0 })).status, 400, "marks must be positive");
  assert.equal((await admin.api("POST", "/api/academic/questions", { question_text: "x", marks: 1000 })).status, 400, "marks capped");
  assert.equal((await admin.api("POST", "/api/academic/questions", { question_text: "x", marks: 1, class_id: 999999 })).status, 400, "unknown class");
  const after = await ctx.db.get("SELECT COUNT(*) AS n FROM question_bank WHERE madrasa_id = ?", [ctx.madrasaA]);
  assert.equal(Number(after.n), Number(before.n), "invalid requests write nothing");
});
