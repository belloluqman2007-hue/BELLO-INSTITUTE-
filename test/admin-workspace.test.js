"use strict";
/* Complete admin workspace contracts: the UI only exposes data-backed actions. */
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { initEnv, setup, Client } = require("./helpers");
initEnv();

let ctx; let adminA; let adminB;
before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base); await adminA.login("admin-a", "Passw0rd!123");
  adminB = new Client(ctx.base); await adminB.login("admin-b", "Passw0rd!123");
});
after(async () => ctx.close());

test("admin workspace returns a complete gradebook roster, including pupils without a mark", async () => {
  const r = await adminA.api("GET", `/api/results/roster?classId=${ctx.classA1}&termId=${ctx.termA1}&subjectId=${ctx.subjA1}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.students.length, 2);
  assert.ok(r.data.students.every((s) => s.student_id));
  assert.equal(r.data.config.caMax, 40);
  const isolated = await adminB.api("GET", `/api/results/roster?classId=${ctx.classA1}&termId=${ctx.termA1}&subjectId=${ctx.subjA1}`);
  assert.equal(isolated.status, 404);
});

test("teacher attendance is a dedicated, tenant-isolated ledger", async () => {
  const day = "2026-09-14";
  const beforeMarks = await adminA.api("GET", `/api/attendance/teachers?date=${day}`);
  assert.equal(beforeMarks.status, 200);
  assert.equal(beforeMarks.data.teachers.length, 1);
  const mark = await adminA.api("POST", "/api/attendance/teachers/mark", { date: day, statuses: { [ctx.users.teacherA]: "present" } });
  assert.equal(mark.status, 200);
  assert.equal(mark.data.saved, 1);
  const afterMarks = await adminA.api("GET", `/api/attendance/teachers?date=${day}`);
  assert.equal(afterMarks.data.teachers[0].status, "present");
  const otherTenant = await adminB.api("GET", `/api/attendance/teachers?date=${day}`);
  assert.equal(otherTenant.status, 200);
  assert.equal(otherTenant.data.teachers.length, 0);
});

test("teacher applications are reviewed before they become staff accounts", async () => {
  const created = await adminA.api("POST", "/api/teachers/applications", { full_name: "Candidate One", email: "candidate@example.test", phone: "+2348012345678", message: "Experienced teacher" });
  assert.equal(created.status, 200);
  const list = await adminA.api("GET", "/api/teachers/applications");
  assert.equal(list.status, 200);
  const app = list.data.applications.find((row) => row.id === created.data.id);
  assert.equal(app.status, "pending");
  const approved = await adminA.api("POST", `/api/teachers/applications/${app.id}/approve`, { username: "candidate-one", password: "CandidatePass123!", assignments: [{ class_id: ctx.classA1, subject_id: ctx.subjA1 }] });
  assert.equal(approved.status, 200);
  const teacherLogin = new Client(ctx.base);
  const login = await teacherLogin.login("candidate-one", "CandidatePass123!");
  assert.equal(login.status, 200);
  assert.equal(login.data.role, "teacher");
  const bList = await adminB.api("GET", "/api/teachers/applications");
  assert.equal(bList.status, 200);
  assert.equal(bList.data.applications.length, 0);
});

test("website content preferences are saved for the tenant and safely projected to its public page", async () => {
  const saved = await adminA.api("PUT", "/api/madrasa/settings", { website_homepage_title: "Welcome to Test Madrasa A", website_homepage_content: "Accurate family-facing introduction." });
  assert.equal(saved.status, 200);
  const privateSettings = await adminA.api("GET", "/api/madrasa/settings");
  assert.equal(privateSettings.status, 200);
  assert.equal(privateSettings.data.settings.website_homepage_title, "Welcome to Test Madrasa A");
  await adminA.api("PUT", "/api/madrasa/public-site", { public_listing: true, public_admissions: true });
  const publicPage = await new Client(ctx.base).req("GET", "/api/public/madaris/testa");
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.data.pages.website_homepage_content, "Accurate family-facing introduction.");
  assert.equal(publicPage.data.madrasa.sharePath, "/s/testa");
  assert.equal(publicPage.data.madrasa.category, "islamic");
});

test("administrator account contact details can be updated without granting broader identity changes", async () => {
  const account = await adminA.api("GET", "/api/auth/account");
  assert.equal(account.status, 200);
  const changed = await adminA.api("PUT", "/api/auth/account", { full_name: "Administrator A", email: "admina@example.test", phone: "+2348099999999", role: "super_admin", madrasa_id: ctx.madrasaB });
  assert.equal(changed.status, 200);
  const readBack = await adminA.api("GET", "/api/auth/account");
  assert.equal(readBack.data.account.full_name, "Administrator A");
  assert.equal(readBack.data.account.role, "madrasa_admin");
});

test("lessons and assignments are kept as separate classroom work streams", async () => {
  const lesson = await adminA.api("POST", "/api/homework", { title: "Tajwid revision", class_id: ctx.classA1, subject_id: ctx.subjA1, kind: "lesson" });
  const assignment = await adminA.api("POST", "/api/homework", { title: "Memorise verses", class_id: ctx.classA1, subject_id: ctx.subjA1, kind: "assignment" });
  assert.equal(lesson.status, 200);
  assert.equal(assignment.status, 200);
  const lessons = await adminA.api("GET", "/api/homework?kind=lesson");
  const assignments = await adminA.api("GET", "/api/homework?kind=assignment");
  assert.ok(lessons.data.homework.some((row) => row.title === "Tajwid revision" && row.kind === "lesson"));
  assert.ok(!lessons.data.homework.some((row) => row.title === "Memorise verses"));
  assert.ok(assignments.data.homework.some((row) => row.title === "Memorise verses" && row.kind === "assignment"));
});

test("the administrator share link renders the institution’s live public page", async () => {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const response = await fetch(ctx.base + "/s/testa");
  const html = await response.text();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Not implemented: window\.scrollTo/i.test(String(e.message))) errors.push(String(e.message));
  });
  const dom = new JSDOM(html, {
    url: ctx.base + "/s/testa",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (input, init) => fetch(new URL(String(input), ctx.base), init);
    },
  });
  // The page renders after its own fetches resolve. A fixed sleep made this
  // test flaky on a loaded machine, so poll for the rendered result instead
  // and only then assert — the assertions themselves are unchanged.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = /Welcome to Test Madrasa A/.test(dom.window.document.body.textContent)
      && dom.window.document.getElementById("publicApplicationForm");
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(dom.window.document.body.textContent, /Welcome to Test Madrasa A/);
  assert.ok(dom.window.document.getElementById("publicApplicationForm"), "public admission form uses the live class list");
  assert.deepEqual(errors, []);
  dom.window.close();
});
