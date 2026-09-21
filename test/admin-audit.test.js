"use strict";
/* ============================================================================
   AUDIT LOG + GLOBAL SEARCH + NEEDS ATTENTION

   Three cross-cutting admin capabilities that must all respect institution
   isolation and the caller's permissions. The audit tests also assert the
   negative guarantee that matters most: credentials are never written to the
   log, not even when they were present in the request that caused the entry.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB, teacherA;

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", PASSWORD)).status, 200);
  assert.equal((await adminB.login("admin-b", PASSWORD)).status, 200);
  assert.equal((await teacherA.login("teacher-a", PASSWORD)).status, 200);
});

after(async () => { await ctx.close(); });

/* --------------------------------- audit --------------------------------- */

test("signing in is recorded in the audit log", async () => {
  const r = await adminA.req("GET", "/api/admin/audit?module=auth");
  assert.equal(r.status, 200);
  const logins = r.data.entries.filter((e) => e.action === "login");
  assert.ok(logins.length >= 1, "the sign-in was recorded");
  // Entries are newest-first and all three accounts signed in during setup,
  // so look for the administrator's own entry rather than assuming an order.
  const adminLogin = logins.find((e) => e.username === "admin-a");
  assert.ok(adminLogin, "the administrator's sign-in is present");
  assert.equal(adminLogin.user_role, "madrasa_admin", "the role is recorded alongside the user");
  assert.ok(logins.every((e) => Number(e.madrasa_id) === Number(ctx.madrasaA)), "only this institution's sign-ins");
});

test("a student change records the previous and the new value", async () => {
  const created = await adminA.api("POST", "/api/students", {
    first_name: "Audit", last_name: "Subject", class_id: ctx.classA1,
  });
  assert.equal(created.status, 200);

  const changed = await adminA.api("PATCH", `/api/students/${created.data.id}`, { first_name: "Renamed" });
  assert.equal(changed.status, 200);

  const r = await adminA.req("GET", "/api/admin/audit?module=students&action=student.update");
  assert.equal(r.status, 200);
  const entry = r.data.entries.find((e) => String(e.entity_id) === String(created.data.id));
  assert.ok(entry, "the update was audited");
  const before = JSON.parse(entry.before_value);
  const after = JSON.parse(entry.after_value);
  assert.equal(before.first_name, "Audit", "the previous value is preserved");
  assert.equal(after.first_name, "Renamed", "the new value is preserved");
});

test("the audit log never stores passwords or hashes", async () => {
  // Cause an action whose underlying record genuinely contains a password
  // hash, then prove the hash did not reach the log.
  await adminA.api("POST", "/api/auth/change-password", {
    currentPassword: PASSWORD, newPassword: "BrandNewPassw0rd!",
  });
  // restore, so the rest of the suite can still authenticate
  await adminA.api("POST", "/api/auth/change-password", {
    currentPassword: "BrandNewPassw0rd!", newPassword: PASSWORD,
  });

  const r = await adminA.req("GET", "/api/admin/audit?limit=200");
  assert.equal(r.status, 200);
  const blob = JSON.stringify(r.data.entries);
  assert.ok(!/\$2[aby]\$/.test(blob), "no bcrypt hash appears anywhere in the audit log");
  assert.ok(!blob.includes(PASSWORD), "no plaintext password appears in the audit log");
  assert.ok(!/password_hash/i.test(blob), "no password_hash field is logged");
});

test("the redactor drops credential fields at any depth", () => {
  const audit = require("../server/services/audit");
  const out = audit.redact({
    username: "safe",
    password: "secret",
    password_hash: "$2b$10$abc",
    nested: { api_key: "k", token: "t", keep: "yes" },
  });
  assert.equal(out.username, "safe");
  assert.ok(!("password" in out));
  assert.ok(!("password_hash" in out));
  assert.ok(!("api_key" in out.nested));
  assert.ok(!("token" in out.nested));
  assert.equal(out.nested.keep, "yes", "non-sensitive fields survive");
});

test("the audit log is filtered, searchable and paginated", async () => {
  const page = await adminA.req("GET", "/api/admin/audit?limit=2&page=1");
  assert.equal(page.status, 200);
  assert.ok(page.data.entries.length <= 2, "the page size is respected");
  assert.ok(page.data.total >= page.data.entries.length);
  assert.ok(page.data.pages >= 1);

  const filtered = await adminA.req("GET", "/api/admin/audit?module=students");
  assert.equal(filtered.status, 200);
  assert.ok(filtered.data.entries.every((e) => e.module === "students"), "the module filter holds");

  const facets = await adminA.req("GET", "/api/admin/audit/facets");
  assert.equal(facets.status, 200);
  assert.ok(Array.isArray(facets.data.modules));
});

test("one institution never sees another institution's audit entries", async () => {
  // A has by now generated student activity; B must see none of it.
  const b = await adminB.req("GET", "/api/admin/audit?limit=200");
  assert.equal(b.status, 200);
  assert.ok(
    b.data.entries.every((e) => Number(e.madrasa_id) === Number(ctx.madrasaB)),
    "every entry belongs to the caller's own institution"
  );
  const bStudents = b.data.entries.filter((e) => e.module === "students");
  assert.equal(bStudents.length, 0, "B sees none of A's student activity");
});

test("a teacher cannot read the audit log", async () => {
  const r = await teacherA.req("GET", "/api/admin/audit");
  assert.equal(r.status, 403);
});

/* ----------------------------- global search ----------------------------- */

test("global search finds records in the caller's own institution", async () => {
  const r = await adminA.req("GET", "/api/admin/search?q=Alpha");
  assert.equal(r.status, 200);
  const students = r.data.groups.find((g) => g.key === "students");
  assert.ok(students, "the students group is present");
  assert.ok(students.items.some((i) => /Alpha/.test(i.title)), "the student is found");
});

test("global search never returns another institution's records", async () => {
  // "Charlie Three" belongs to madrasa B.
  const r = await adminA.req("GET", "/api/admin/search?q=Charlie");
  assert.equal(r.status, 200);
  const blob = JSON.stringify(r.data.groups);
  assert.ok(!/Charlie/.test(blob), "A cannot see B's student through search");

  // ...and the reverse.
  const back = await adminB.req("GET", "/api/admin/search?q=Alpha");
  assert.equal(back.status, 200);
  assert.ok(!/Alpha/.test(JSON.stringify(back.data.groups)), "B cannot see A's student");
});

test("global search results respect the caller's permissions", async () => {
  // Strip the teacher's students.view and confirm the group disappears.
  await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: [], revoked: ["students.view"],
  });
  const r = await teacherA.req("GET", "/api/admin/search?q=Alpha");
  assert.equal(r.status, 200);
  assert.ok(!r.data.groups.some((g) => g.key === "students"), "students are hidden without students.view");

  // restore the default
  await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, { granted: [], revoked: [] });
});

test("a one-character query does not run a search", async () => {
  const r = await adminA.req("GET", "/api/admin/search?q=A");
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 0, "short queries return nothing rather than everything");
});

test("an anonymous visitor cannot search", async () => {
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/admin/search?q=Alpha")).status, 401);
});

/* --------------------------- needs attention ----------------------------- */

test("needs attention reports only real, non-zero, actionable items", async () => {
  const r = await adminA.req("GET", "/api/admin/needs-attention");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
  // Nothing with a zero count may ever be listed — that is what makes the
  // panel actionable rather than decorative.
  assert.ok(r.data.items.every((i) => Number(i.count) > 0), "no zero-count rows");
  assert.ok(r.data.items.every((i) => typeof i.route === "string" && i.route.length), "every item is clickable");
});

test("needs attention counts an actual pending admission", async () => {
  const db = require("../server/db");
  await db.run(
    "INSERT INTO admission_requests (madrasa_id,reference,first_name,last_name,status) VALUES (?,?,?,?,'pending')",
    [ctx.madrasaA, "REF-ATTENTION-1", "Pending", "Applicant"]
  );
  const r = await adminA.req("GET", "/api/admin/needs-attention");
  const item = r.data.items.find((i) => i.key === "pending_admissions");
  assert.ok(item, "the pending admission is surfaced");
  assert.ok(item.count >= 1);
  assert.equal(item.route, "admissions/applications", "the item links to the right page");
});

test("needs attention is scoped to the caller's institution", async () => {
  // The pending admission above belongs to A only.
  const b = await adminB.req("GET", "/api/admin/needs-attention");
  assert.equal(b.status, 200);
  const item = (b.data.items || []).find((i) => i.key === "pending_admissions");
  assert.ok(!item, "B does not inherit A's pending admission");
});
