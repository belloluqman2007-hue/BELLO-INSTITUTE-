"use strict";
/* ============================================================================
   TENANT ISOLATION TESTS — the core security guarantee
   "A user from Madrasa A must never be able to access Madrasa B data by
    changing URL parameters, IDs, API requests, query params or form data."
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB, teacherA, parentA, parentB, studentA1;
const U = "Passw0rd!123";

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  parentA = new Client(ctx.base);
  parentB = new Client(ctx.base);
  studentA1 = new Client(ctx.base);
  const r1 = await adminA.login("admin-a", U); assert.equal(r1.status, 200, "adminA login");
  const r2 = await adminB.login("admin-b", U); assert.equal(r2.status, 200, "adminB login");
  const r3 = await teacherA.login("teacher-a", U); assert.equal(r3.status, 200, "teacherA login");
  const r4 = await parentA.login("parent-a", U); assert.equal(r4.status, 200, "parentA login");
  const r5 = await parentB.login("parent-b", U); assert.equal(r5.status, 200, "parentB login");
  const r6 = await studentA1.login("student-a1", U); assert.equal(r6.status, 200, "studentA1 login");
});
after(async () => { await ctx.close(); });

/* ------------------------- admin A vs madrasa B -------------------------- */
test("admin A cannot read madrasa B's students by id", async () => {
  const r = await adminA.req("GET", `/api/students/${ctx.studentB1}`);
  assert.equal(r.status, 404);
});

test("admin A cannot update madrasa B's student", async () => {
  const r = await adminA.api("PATCH", `/api/students/${ctx.studentB1}`, { first_name: "HACKED" });
  assert.equal(r.status, 404);
  const row = await ctx.db.get("SELECT first_name FROM students WHERE id = ?", [ctx.studentB1]);
  assert.equal(row.first_name, "Charlie");
});

test("admin A cannot change madrasa B's student status", async () => {
  const r = await adminA.api("PATCH", `/api/students/${ctx.studentB1}/status`, { status: "suspended" });
  assert.equal(r.status, 404);
});

test("admin A cannot read madrasa B's classes", async () => {
  const r = await adminA.api("GET", `/api/classes/${ctx.classB1}/x`); // no such sub-route; use students-by-class instead
  const r2 = await adminA.req("GET", `/api/students?classId=${ctx.classB1}`);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.students.length, 0, "A sees no B-class students via classId query param");
});

test("admin A cannot compute results for madrasa B's class", async () => {
  const termB = await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? AND position = 1", [ctx.madrasaB]);
  const r = await adminA.api("POST", "/api/results/compute", { classId: ctx.classB1, termId: termB.id });
  assert.equal(r.status, 404);
});

test("admin A cannot read madrasa B's report card", async () => {
  const termB = await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? AND position = 1", [ctx.madrasaB]);
  const r = await adminA.req("GET", `/api/results/report-card/${ctx.studentB1}/${termB.id}`);
  assert.equal(r.status, 404);
});

test("admin A cannot touch madrasa B's announcements", async () => {
  const annB = await ctx.db.get("SELECT id FROM announcements WHERE madrasa_id = ?", [ctx.madrasaB]);
  const r = await adminA.api("DELETE", `/api/announcements/${annB.id}`);
  assert.equal(r.status, 404);
});

test("admin A cannot modify madrasa B's grading config", async () => {
  // Grading PUT is scoped by the caller's tenant — verify A's PUT only wrote A's row
  await adminA.api("PUT", "/api/grading", { ca_max: 40, exam_max: 60, pass_mark: 50 });
  const b = await ctx.db.get("SELECT pass_mark FROM grading_config WHERE madrasa_id = ?", [ctx.madrasaB]);
  assert.equal(b, null, "B has no grading config touched by A");
});

test("admin A cannot create a student in madrasa B's class (forged class id rejected)", async () => {
  const r = await adminA.api("POST", "/api/students", { first_name: "Evil", madrasa_id: ctx.madrasaB, class_id: ctx.classB1 });
  assert.equal(r.status, 400, "forged cross-tenant class id must be rejected");
  assert.equal(await ctx.db.get("SELECT id FROM students WHERE first_name = 'Evil'"), null);
});

test("forged madrasa_id in form data is ignored (student lands in caller's madrasa)", async () => {
  const r = await adminA.api("POST", "/api/students", { first_name: "Forged", madrasa_id: ctx.madrasaB });
  assert.equal(r.status, 200);
  const created = await ctx.db.get("SELECT * FROM students WHERE first_name = 'Forged'");
  assert.equal(created.madrasa_id, ctx.madrasaA, "student created in A despite forged madrasa_id");
  await ctx.db.run("DELETE FROM students WHERE id = ?", [created.id]);
});

/* ------------------------- teacher scoping ------------------------------- */
test("teacher A can see students of assigned class only", async () => {
  const r = await teacherA.req("GET", `/api/students?classId=${ctx.classA1}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.students.length, 2);
});

test("teacher A cannot list students of unassigned class A2", async () => {
  const r = await teacherA.req("GET", `/api/students?classId=${ctx.classA2}`);
  assert.equal(r.data.students.length, 0);
});

test("teacher A can save results for assigned class+subject", async () => {
  const r = await teacherA.api("PUT", "/api/results", {
    classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA1,
    entries: [{ studentId: ctx.studentA2, ca: 10, exam: 20 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated, 1);
});

test("teacher A cannot save results for unassigned subject (English) in same class", async () => {
  const r = await teacherA.api("PUT", "/api/results", {
    classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA2,
    entries: [{ studentId: ctx.studentA2, ca: 1, exam: 1 }],
  });
  assert.equal(r.status, 404);
});

test("teacher A cannot save results in madrasa B's class", async () => {
  const termB = await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? AND position = 1", [ctx.madrasaB]);
  const r = await teacherA.api("PUT", "/api/results", {
    classId: ctx.classB1, termId: termB.id, subjectId: ctx.subjB1,
    entries: [{ studentId: ctx.studentB1, ca: 1, exam: 1 }],
  });
  assert.equal(r.status, 404);
});

test("teacher A cannot mark attendance for unassigned class A2", async () => {
  const r = await teacherA.api("POST", "/api/attendance/mark", {
    classId: ctx.classA2, date: "2026-09-08",
    statuses: { [ctx.studentA1]: "present" },
  });
  assert.equal(r.status, 404);
});

/* ------------------------- parent scoping -------------------------------- */
test("parent A sees only linked children", async () => {
  const r = await parentA.req("GET", "/api/portal/me");
  assert.equal(r.status, 200);
  const ids = r.data.children.map((c) => c.id).sort();
  assert.deepEqual(ids, [ctx.studentA1, ctx.studentA2].sort());
});

test("parent A cannot view madrasa B's student (not linked, other tenant)", async () => {
  const r = await parentA.req("GET", `/api/portal/results?studentId=${ctx.studentB1}`);
  assert.equal(r.status, 400);
});

test("parent B (other madrasa) cannot view madrasa A's student", async () => {
  const r = await parentB.req("GET", `/api/portal/results?studentId=${ctx.studentA1}`);
  assert.equal(r.status, 400);
});

test("parent A can view report card of a linked child", async () => {
  // compute first so a summary exists
  await adminA.api("POST", "/api/results/compute", { classId: ctx.classA1, termId: ctx.termA1 });
  const r = await parentA.req("GET", `/api/portal/report-card?termId=${ctx.termA1}&studentId=${ctx.studentA1}`);
  assert.equal(r.status, 200);
  const html = await r.res.text();
  assert.match(html, /REPORT CARD|بطاقة النتائج/);
});

/* ------------------------- student scoping ------------------------------- */
test("student A1 sees own profile", async () => {
  const r = await studentA1.req("GET", "/api/portal/me");
  assert.equal(r.status, 200);
  assert.equal(r.data.self.admission_no, "TTA0001");
});

test("student cannot list students", async () => {
  const r = await studentA1.req("GET", "/api/students");
  assert.equal(r.status, 403);
});

test("student cannot read another student's record by id", async () => {
  const r = await studentA1.req("GET", `/api/students/${ctx.studentA2}`);
  assert.ok([403, 404].includes(r.status), `expected 403/404, got ${r.status}`);
});

test("student cannot modify results", async () => {
  const r = await studentA1.api("PUT", "/api/results", {
    classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA1,
    entries: [{ studentId: ctx.studentA1, ca: 40, exam: 60 }],
  });
  assert.equal(r.status, 403);
});

/* ------------------------- role boundaries ------------------------------- */
test("madrasa admin cannot access platform (super admin) routes", async () => {
  const r = await adminA.req("GET", "/api/platform/madaris");
  assert.equal(r.status, 403);
});

test("super admin can access both madaris", async () => {
  const sa = new Client(ctx.base);
  const r = await sa.login("testadmin", "TestAdmin123!");
  assert.equal(r.status, 200);
  const r2 = await sa.req("GET", "/api/platform/madaris");
  assert.equal(r2.status, 200);
  assert.equal(r2.data.madaris.length, 2);
});

/* ------------------- filters naming a foreign record --------------------- */
/* A report filtered by an id belonging to ANOTHER institution must answer
   "not found", exactly as the student-filtered report already did. Answering
   200 with an empty result set made a foreign id indistinguishable from a
   teacher who simply has no attendance marked yet, which both leaks the shape
   of the neighbouring tenant and hides a genuine mistake from the operator. */
test("teacher attendance report rejects a teacher id from another madrasa", async () => {
  const foreign = await adminA.req("GET", `/api/attendance/teacher/${ctx.users.adminB}/report`);
  assert.equal(foreign.status, 404,
    `a foreign teacher id must be 404, got ${foreign.status}`);

  // The same endpoint still answers for a teacher who DOES belong to the
  // caller's institution, so the guard rejects the right thing.
  const own = await adminA.req("GET", `/api/attendance/teacher/${ctx.users.teacherA}/report`);
  assert.equal(own.status, 200, "an in-tenant teacher id still reports normally");
});

test("student-filtered attendance report already rejects a foreign student id", async () => {
  const r = await adminA.req("GET",
    `/api/attendance/report?from=2026-01-01&to=2026-12-31&studentId=${ctx.studentB1}`);
  assert.equal(r.status, 404, `a foreign student id must be 404, got ${r.status}`);
});
