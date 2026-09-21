"use strict";
/* ============================================================================
   MODULE PERMISSION ENFORCEMENT — every gated module refuses a revoked holder

   Before this suite, whole modules were protected only by ROLE (an "is this a
   madrasa_admin?" check). Granular permissions existed and could be revoked in
   the admin UI, but many routers never consulted them: revoking
   `payroll.view` from an administrator still left the payroll API wide open to
   them. The permission screen therefore promised an isolation it did not
   deliver, which is the worst kind of security control — one an operator
   trusts.

   The contract asserted here is narrow and behavioural:

       revoke permission P from a user  =>  the endpoints guarded by P return
       403 for that user, while an untouched control endpoint still returns 200.

   The control request matters. Without it a bug that broke the user's session
   entirely (or 403'd every route) would satisfy the first assertion and the
   test would pass while the application was broken.

   These are deliberately driven through the real HTTP API against the real
   permission-override table, not by unit-testing the middleware, because the
   defect being guarded against was routers forgetting to CALL the middleware.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let admin;      // does the revoking
let victimId;   // a SECOND administrator in the same tenant, whose access we cut
let victim;

before(async () => {
  ctx = await setup();

  // The API refuses self-edits of permissions (an administrator must not be
  // able to lock themselves out or quietly re-grant themselves), so the subject
  // of these tests has to be a different account in the same institution.
  const bcrypt = require("bcryptjs");
  victimId = Number((await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, "admin-a2", bcrypt.hashSync(PASSWORD, 10), "madrasa_admin", "Admin A2"]
  )).lastInsertRowid);

  admin = new Client(ctx.base);
  assert.equal((await admin.login("admin-a", PASSWORD)).status, 200);
  victim = new Client(ctx.base);
  assert.equal((await victim.login("admin-a2", PASSWORD)).status, 200);
});

after(async () => { await ctx.close(); });

/** Revokes `perms` from the second administrator, runs fn, then restores them. */
async function withRevoked(perms, fn) {
  const set = await admin.api("PUT", `/api/admin/permissions/users/${victimId}`, { revoked: perms });
  assert.equal(set.status, 200, `could not revoke ${perms.join(", ")}: ${JSON.stringify(set.data)}`);
  try {
    // Permissions are resolved per request, so the override must bite on the
    // session that is ALREADY open — an operator who revokes access should not
    // have to wait for the user to sign in again.
    await fn(victim);
  } finally {
    await admin.api("PUT", `/api/admin/permissions/users/${victimId}`, { revoked: [] });
  }
}

/* Each case: the permission, one endpoint it must now guard, and a control
   endpoint that must KEEP working so we know the account is still usable. */
const CASES = [
  { perm: "classes.view",        guarded: "/api/classes",                       control: "/api/students" },
  { perm: "lessons.view",        guarded: "/api/academic/lessons",              control: "/api/classes" },
  { perm: "assignments.view",    guarded: "/api/academic/assignments",          control: "/api/classes" },
  { perm: "exams.view",          guarded: "/api/academic/exams",                control: "/api/classes" },
  { perm: "payroll.view",        guarded: "/api/payroll/structures",            control: "/api/students" },
  { perm: "payslips.view",       guarded: "/api/payroll/payslips",              control: "/api/students" },
  { perm: "staff_leave.view",    guarded: "/api/leave",                         control: "/api/students" },
  { perm: "expenses.view",       guarded: "/api/expenses",                      control: "/api/students" },
  { perm: "library.view",        guarded: "/api/library/books",                 control: "/api/students" },
  { perm: "documents.view",      guarded: "/api/documents/certificates",        control: "/api/students" },
  { perm: "communication.view",  guarded: "/api/communication/history",         control: "/api/students" },
  { perm: "admissions.view",     guarded: "/api/admissions",                    control: "/api/students" },
  { perm: "fees.view",           guarded: "/api/fees/items",                    control: "/api/students" },
  { perm: "website.view",        guarded: "/api/madrasa/institution/website",   control: "/api/students" },
  { perm: "institution.settings", guarded: "/api/madrasa/settings",             control: "/api/students" },
  { perm: "users.manage",        guarded: "/api/users",                         control: "/api/students" },
  { perm: "students.export",     guarded: "/api/exports/students.csv",          control: "/api/students" },
];

for (const { perm, guarded, control } of CASES) {
  test(`revoking ${perm} blocks ${guarded} without disabling the account`, async () => {
    // Baseline: the endpoint is reachable while the permission is held, so a
    // 403 below is caused by the revoke and not by an unrelated failure.
    const before = await victim.req("GET", guarded);
    assert.equal(before.status, 200, `${guarded} should be reachable while ${perm} is held`);

    await withRevoked([perm], async (victim) => {
      const blocked = await victim.req("GET", guarded);
      assert.equal(blocked.status, 403,
        `${guarded} must return 403 once ${perm} is revoked, got ${blocked.status}`);

      const stillWorks = await victim.req("GET", control);
      assert.equal(stillWorks.status, 200,
        `revoking ${perm} must not disturb ${control} (got ${stillWorks.status})`);
    });

    // And the access comes back when the permission is restored.
    assert.equal((await victim.req("GET", guarded)).status, 200,
      `${guarded} must be reachable again after ${perm} is restored`);
  });
}

test("a write endpoint is gated by its own permission, not merely the read one", async () => {
  // Read and write permissions are distinct; revoking the writer must not be
  // satisfiable by still holding the reader.
  await withRevoked(["classes.create"], async (victim) => {
    const w = await victim.api("POST", "/api/classes", { name_en: "Blocked Class", name_ar: "ممنوع" });
    assert.equal(w.status, 403, "creating a class requires classes.create");
    assert.equal((await victim.req("GET", "/api/classes")).status, 200,
      "classes.view is untouched, so the list still loads");
  });
});

test("publishing a website is gated separately from editing it", async () => {
  // website.edit lets an administrator draft the site; website.publish is what
  // makes it visible to the world. Collapsing the two would let an editor
  // publish, which is the distinction the permission exists to draw.
  await withRevoked(["website.publish"], async (victim) => {
    const pub = await victim.api("PUT", "/api/madrasa/institution/", { section: "website", website_published: 1 });
    assert.equal(pub.status, 403, "flipping website_published requires website.publish");

    const edit = await victim.api("PUT", "/api/madrasa/institution/", { section: "website", seo_title: "Draft title" });
    assert.equal(edit.status, 200, "ordinary website edits still work without website.publish");
  });
});
