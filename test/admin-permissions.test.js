"use strict";
/* ============================================================================
   GRANULAR PERMISSIONS — server-side enforcement

   The point of these tests is that a permission is a SERVER guarantee. Hiding
   a button in the browser proves nothing, so every case below calls the API
   directly and asserts the status code.

   Covered:
     • role defaults reproduce the pre-existing access exactly
     • a revoke actually blocks the action (403), not just the button
     • a grant actually enables it
     • permission overrides cannot cross a tenant boundary
     • an administrator cannot edit their own permissions
     • only roles.manage may reach the permission administration at all
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

/* ------------------------------ role defaults ---------------------------- */

test("an administrator holds the full permission set by default", async () => {
  const r = await adminA.req("GET", "/api/admin/permissions");
  assert.equal(r.status, 200);
  for (const p of ["students.create", "results.publish", "payments.verify", "roles.manage", "audit.view"]) {
    assert.ok(r.data.permissions.includes(p), `administrator should hold ${p}`);
  }
});

test("a teacher holds entry permissions but never approval or publishing", async () => {
  const r = await teacherA.req("GET", "/api/admin/permissions");
  assert.equal(r.status, 200);
  const held = r.data.permissions;
  assert.ok(held.includes("results.enter"), "a teacher may enter results");
  assert.ok(held.includes("results.submit"), "a teacher may submit results");
  assert.ok(!held.includes("results.approve"), "a teacher may NOT approve results");
  assert.ok(!held.includes("results.publish"), "a teacher may NOT publish results");
  assert.ok(!held.includes("roles.manage"), "a teacher may NOT manage roles");
  assert.ok(!held.includes("payments.verify"), "a teacher may NOT verify payments");
});

test("/api/auth/me reports the caller's permissions so the UI can hide actions", async () => {
  const r = await teacherA.req("GET", "/api/auth/me");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.permissions), "me carries a permission list");
  assert.ok(r.data.permissions.includes("results.enter"));
});

/* --------------------------- administration guard ------------------------ */

test("a teacher cannot read or write the permission administration", async () => {
  assert.equal((await teacherA.req("GET", "/api/admin/permissions/users")).status, 403);
  assert.equal((await teacherA.req("GET", "/api/admin/permissions/catalogue")).status, 403);
  const w = await teacherA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, { granted: ["roles.manage"] });
  assert.equal(w.status, 403, "a teacher cannot grant themselves anything");
});

test("an anonymous visitor cannot reach the permission API at all", async () => {
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/admin/permissions/users")).status, 401);
});

/* ------------------------------ revoke works ----------------------------- */

test("revoking students.create actually blocks student creation on the server", async () => {
  // The administrator can create a student to begin with.
  const before = await adminA.api("POST", "/api/students", {
    first_name: "Permission", last_name: "Probe", class_id: ctx.classA1,
  });
  assert.equal(before.status, 200, "baseline: the administrator may create students");

  // Revoke the capability from the TEACHER (who never had it) and grant it,
  // then revoke again — proving both directions are enforced.
  const grant = await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: ["students.create"], revoked: [],
  });
  assert.equal(grant.status, 200);

  const allowed = await teacherA.api("POST", "/api/students", {
    first_name: "Granted", last_name: "Probe", class_id: ctx.classA1,
  });
  assert.equal(allowed.status, 200, "a granted teacher may now create a student");

  const revoke = await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: [], revoked: ["students.create"],
  });
  assert.equal(revoke.status, 200);

  const blocked = await teacherA.api("POST", "/api/students", {
    first_name: "Revoked", last_name: "Probe", class_id: ctx.classA1,
  });
  assert.equal(blocked.status, 403, "the revoke is enforced by the server");
  assert.equal(blocked.data.requiredPermission, "students.create");
});

test("revoking a default permission from an administrator is enforced", async () => {
  // Give madrasa A a second administrator to experiment on, so we never lock
  // out the one the rest of the suite depends on.
  const bcrypt = require("bcryptjs");
  const db = require("../server/db");
  const id = (await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, "admin-a2", bcrypt.hashSync(PASSWORD, 10), "madrasa_admin", "Admin A2"]
  )).lastInsertRowid;

  const second = new Client(ctx.base);
  assert.equal((await second.login("admin-a2", PASSWORD)).status, 200);
  assert.equal((await second.req("GET", "/api/admin/audit")).status, 200, "baseline: audit is visible");

  const r = await adminA.api("PUT", `/api/admin/permissions/users/${id}`, { granted: [], revoked: ["audit.view"] });
  assert.equal(r.status, 200);

  const blocked = await second.req("GET", "/api/admin/audit");
  assert.equal(blocked.status, 403, "the revoked administrator loses the audit log");
});

/* ------------------------------ safety rails ----------------------------- */

test("an administrator cannot edit their own permissions", async () => {
  const me = await adminA.req("GET", "/api/auth/me");
  const r = await adminA.api("PUT", `/api/admin/permissions/users/${me.data.user.id}`, { granted: [], revoked: [] });
  assert.equal(r.status, 400, "self-editing is refused");
  assert.match(r.data.error, /your own permissions/i);
});

test("an unknown permission string is ignored rather than stored", async () => {
  const r = await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: ["students.view", "not.a.real.permission", "DROP TABLE users"], revoked: [],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.granted, ["students.view"], "only catalogue permissions survive");
});

test("a revoke wins over a simultaneous grant of the same permission", async () => {
  const r = await adminA.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: ["students.delete"], revoked: ["students.delete"],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.granted, [], "the grant is dropped");
  assert.deepEqual(r.data.revoked, ["students.delete"], "the revoke stands");
});

/* ---------------------------- tenant isolation --------------------------- */

test("an administrator cannot change permissions for another institution's user", async () => {
  // admin B tries to act on a user belonging to madrasa A.
  const r = await adminB.api("PUT", `/api/admin/permissions/users/${ctx.users.teacherA}`, {
    granted: ["roles.manage"], revoked: [],
  });
  assert.equal(r.status, 404, "the cross-tenant user is simply not found");

  // ...and the target's permissions are untouched.
  const held = await teacherA.req("GET", "/api/admin/permissions");
  assert.ok(!held.data.permissions.includes("roles.manage"), "no cross-tenant escalation happened");
});

test("the permission user list only shows the caller's own institution", async () => {
  const a = await adminA.req("GET", "/api/admin/permissions/users");
  const b = await adminB.req("GET", "/api/admin/permissions/users");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const aNames = a.data.users.map((u) => u.username);
  const bNames = b.data.users.map((u) => u.username);
  assert.ok(aNames.includes("admin-a"), "A sees its own administrator");
  assert.ok(!bNames.includes("admin-a"), "B never sees A's administrator");
  assert.ok(!bNames.includes("teacher-a"), "B never sees A's teacher");
});

test("a student or parent account holds no admin permissions at all", async () => {
  const student = new Client(ctx.base);
  assert.equal((await student.login("student-a1", PASSWORD)).status, 200);
  const me = await student.req("GET", "/api/auth/me");
  assert.deepEqual(me.data.permissions, [], "a student holds no admin permissions");
  assert.equal((await student.req("GET", "/api/admin/permissions/users")).status, 403);
});
