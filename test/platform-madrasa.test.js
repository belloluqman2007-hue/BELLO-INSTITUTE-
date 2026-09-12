"use strict";
/* ============================================================================
   PLATFORM — MADRASA CREATION TESTS
   ----------------------------------------------------------------------------
   Regression coverage for the "add madrasa" flow:
     • a madrasa + its admin account are created together
     • duplicate / short / invalid admin credentials FAIL instead of silently
       creating a madrasa with no log-in (the old silent-skip bug)
     • an invalid plan id is rejected clearly (the empty-plan-dropdown bug)
     • the madrasa detail endpoint returns real student/teacher counts
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, SA_PASSWORD } = require("./helpers");
initEnv();

let ctx;
let sa;
before(async () => {
  ctx = await setup();
  sa = new Client(ctx.base);
  const r = await sa.login("testadmin", SA_PASSWORD);
  assert.equal(r.status, 200, "super admin login");
});
after(async () => { await ctx.close(); });

test("super admin creates a madrasa WITH its admin account", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "brand-new", name_en: "Brand New Madrasa", name_ar: "المدرسة الجديدة",
    city: "Ijebu-Ode", state_name: "Ogun", plan_id: 1,
    admin_username: "new-admin", admin_password: "NewAdmin1234", admin_full_name: "New Admin",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.adminCreated, true);
  assert.ok(r.data.id > 0, "returns the new madrasa id");

  // The new admin can log in and is scoped to the new madrasa.
  const c = new Client(ctx.base);
  const lr = await c.login("new-admin", "NewAdmin1234");
  assert.equal(lr.status, 200);
  assert.equal(lr.data.role, "madrasa_admin");
  const pr = await c.req("GET", "/api/madrasa/profile");
  assert.equal(pr.status, 200);
  assert.equal(pr.data.madrasa.slug, "brand-new");
});

test("already-taken admin username fails and creates nothing", async () => {
  const beforeList = await sa.req("GET", "/api/platform/madaris");
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "dup-admin", name_en: "Dup Admin", plan_id: 1,
    admin_username: "admin-a", admin_password: "NewAdmin1234",
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /taken/i);
  const afterList = await sa.req("GET", "/api/platform/madaris");
  assert.equal(afterList.data.madaris.length, beforeList.data.madaris.length);
  const m = await ctx.db.get("SELECT id FROM madaris WHERE slug = ?", ["dup-admin"]);
  assert.equal(m, null, "madrasa must NOT be created when the admin account fails");
});

test("short admin password fails and creates nothing", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "short-pass", name_en: "Short Pass", plan_id: 1,
    admin_username: "short-admin", admin_password: "short",
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /password/i);
  const m = await ctx.db.get("SELECT id FROM madaris WHERE slug = ?", ["short-pass"]);
  assert.equal(m, null, "madrasa must NOT be created with an invalid admin password");
});

test("missing username with a password supplied fails clearly", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "half-admin", name_en: "Half Admin", plan_id: 1,
    admin_username: "", admin_password: "NewAdmin1234",
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /username and password/i);
  const m = await ctx.db.get("SELECT id FROM madaris WHERE slug = ?", ["half-admin"]);
  assert.equal(m, null);
});

test("creating without admin details reports adminCreated=false (admin set later)", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "no-admin", name_en: "No Admin Yet", plan_id: 1,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.adminCreated, false);

  const ar = await sa.api("POST", `/api/platform/madaris/${r.data.id}/admin`, {
    username: "later-admin", password: "LaterAdmin1234", full_name: "Later Admin",
  });
  assert.equal(ar.status, 200);
  const c = new Client(ctx.base);
  const lr = await c.login("later-admin", "LaterAdmin1234");
  assert.equal(lr.status, 200);
});

test("invalid plan id is rejected clearly and creates nothing", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "bad-plan", name_en: "Bad Plan", plan_id: null,
    admin_username: "bad-admin", admin_password: "BadminPass123",
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /plan/i);
  const m = await ctx.db.get("SELECT id FROM madaris WHERE slug = ?", ["bad-plan"]);
  assert.equal(m, null, "madrasa must NOT be created with an invalid plan");
});

test("madrasa detail returns real student/teacher counts", async () => {
  const r = await sa.req("GET", `/api/platform/madaris/${ctx.madrasaA}`);
  assert.equal(r.status, 200);
  assert.ok(Number(r.data.madrasa.student_count) >= 2, "student_count for madrasa A");
  assert.ok(Number(r.data.madrasa.teacher_count) >= 1, "teacher_count for madrasa A");
  assert.equal(r.data.madrasa.plan_code, "free");
});

test("super admin creates a Western academy with its category and starter data", async () => {
  const r = await sa.api("POST", "/api/platform/madaris", {
    slug: "northbridge", name_en: "Northbridge Academy", category: "western",
    plan_id: 1, city: "Lekki", state_name: "Lagos",
    admin_username: "north-admin", admin_password: "NorthAdmin1234", admin_full_name: "North Admin",
  });
  assert.equal(r.status, 200);

  const detail = await sa.req("GET", `/api/platform/madaris/${r.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.madrasa.category, "western");
  assert.equal(detail.data.madrasa.institution_type, "Academy");

  // Starter academic session + three terms + the Western subject catalogue.
  const sessions = await ctx.db.all("SELECT id FROM academic_sessions WHERE madrasa_id = ?", [r.data.id]);
  assert.equal(sessions.length, 1, "one starter session seeded");
  const terms = await ctx.db.all("SELECT name_en FROM terms WHERE madrasa_id = ? ORDER BY position", [r.data.id]);
  assert.deepEqual(terms.map((t) => t.name_en), ["First Term", "Second Term", "Third Term"]);
  const subjects = await ctx.db.all("SELECT name_en FROM subjects WHERE madrasa_id = ?", [r.data.id]);
  assert.ok(subjects.some((s) => s.name_en === "Mathematics"), "Western catalogue seeded");
  assert.ok(!subjects.some((s) => s.name_en === "Fiqh"), "no Islamic subjects for a Western academy");

  // The new admin lands in the Western dashboard.
  const c = new Client(ctx.base);
  const lr = await c.login("north-admin", "NorthAdmin1234");
  assert.equal(lr.status, 200);
  assert.equal(lr.data.category, "western");
});

test("activity log joins username and madrasa names", async () => {
  const r = await sa.req("GET", "/api/platform/activity?limit=100");
  assert.equal(r.status, 200);
  const rows = r.data.activity || [];
  assert.ok(rows.length > 0, "activity exists after the tests above");
  for (const row of rows) {
    assert.ok("username" in row, "username column is joined");
    assert.ok("madrasa_slug" in row && "madrasa_name" in row, "madrasa columns are joined");
  }
});
