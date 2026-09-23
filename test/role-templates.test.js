"use strict";
/* ============================================================================
   STAFF ROLE TEMPLATES — tests
   ----------------------------------------------------------------------------
   Recommended bundles (Accountant, Librarian, Admissions Officer, Academic
   Officer, HR Officer, Receptionist) applied to STAFF (teacher-role)
   accounts through the existing granular permission system. No new roles are
   created — the 5 core roles remain the only account types.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();

let ctx;
let admin, adminB;
let staffId;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base); await admin.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  // A fresh staff account (teacher role) to shape with templates.
  staffId = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, "staff-librarian", bcrypt.hashSync(PASSWORD, 10), "teacher", "Bilal Librarian"]
  )).lastInsertRowid;
});
test.after(async () => { await ctx.close(); });

async function effectivePermissions(id) {
  const r = await admin.api("GET", "/api/admin/permissions/users");
  const row = (r.data.users || []).find((u) => Number(u.id) === Number(id));
  return row ? row.effective : null;
}

test("the six recommended role templates are available through the API", async () => {
  const r = await admin.api("GET", "/api/admin/permissions/templates");
  assert.equal(r.status, 200);
  const keys = (r.data.templates || []).map((t) => t.key);
  assert.deepEqual(keys.sort(),
    ["academic_officer", "accountant", "admissions_officer", "hr_officer", "librarian", "receptionist"].sort());
  for (const t of r.data.templates) {
    assert.ok(t.label && t.description && Array.isArray(t.permissions) && t.permissions.length,
      `${t.key} is fully described`);
  }
});

test("applying a template replaces the account's permission profile", async () => {
  const before = await effectivePermissions(staffId);
  assert.ok(before.includes("students.export"), "a default teacher can export students");

  const apply = await admin.api("POST", `/api/admin/permissions/users/${staffId}/template`, { template: "librarian" });
  assert.equal(apply.status, 200, JSON.stringify(apply.data));

  const after = await effectivePermissions(staffId);
  for (const p of ["library.view", "library.manage", "library.issue", "library.return", "dashboard.view"]) {
    assert.ok(after.includes(p), `librarian keeps ${p}`);
  }
  for (const p of ["students.export", "results.enter", "assignments.create"]) {
    assert.ok(!after.includes(p), `librarian loses the teacher default ${p}`);
  }

  // And the effect is real on the API, not just the list: the librarian can
  // manage books but can no longer enter results.
  const staff = new Client(ctx.base);
  await staff.login("staff-librarian", PASSWORD);
  assert.equal((await staff.api("GET", "/api/library/books")).status, 200, "library access works");
  assert.equal((await staff.api("GET", "/api/results/roster?classId=1&termId=1&subjectId=1")).status, 403,
    "the librarian cannot open the results gradebook");
});

test("templates are audited", async () => {
  const apply = await admin.api("POST", `/api/admin/permissions/users/${staffId}/template`, { template: "accountant" });
  assert.equal(apply.status, 200);
  const audit = await ctx.db.get(
    "SELECT COUNT(*) AS n FROM activity_log WHERE action = 'permissions.template' AND entity = 'user'"
  );
  assert.ok(Number(audit.n) >= 1, "the template application is recorded in the audit log");
});

test("template guards: administrators, self-edits, unknown templates, cross-tenant", async () => {
  assert.equal((await admin.api("POST", `/api/admin/permissions/users/${ctx.users.adminA}/template`, { template: "librarian" })).status, 400,
    "templates apply to staff accounts only, not administrators");
  assert.equal((await admin.api("POST", `/api/admin/permissions/users/${adminSelf()}/template`, { template: "librarian" })).status, 400,
    "an administrator cannot template themselves");
  assert.equal((await admin.api("POST", `/api/admin/permissions/users/${staffId}/template`, { template: "wizard" })).status, 400,
    "unknown templates are rejected");
  assert.equal((await adminB.api("POST", `/api/admin/permissions/users/${staffId}/template`, { template: "librarian" })).status, 404,
    "another tenant's administrator cannot touch this account");

  const staff = new Client(ctx.base);
  await staff.login("staff-librarian", PASSWORD);
  assert.equal((await staff.api("GET", "/api/admin/permissions/templates")).status, 403,
    "the templates API needs roles.manage");
});

function adminSelf() { return ctx.users.adminA; }

test("an administrator can still fine-tune a templated account afterwards", async () => {
  const apply = await admin.api("POST", `/api/admin/permissions/users/${staffId}/template`, { template: "receptionist" });
  assert.equal(apply.status, 200);
  const tune = await admin.api("PUT", `/api/admin/permissions/users/${staffId}`, { granted: ["library.view"] });
  assert.equal(tune.status, 200, "the normal override endpoint still works on a templated account");
  const after = await effectivePermissions(staffId);
  assert.ok(after.includes("library.view"), "the manual grant sticks on top of the template");
});
