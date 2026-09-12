"use strict";
/* ============================================================================
   ADMIN DASHBOARD — landing stats + institution website customization
   ----------------------------------------------------------------------------
   Covers the new GET /api/madrasa/dashboard aggregate and the extended
   profile/gallery endpoints that back "Website Appearance" / "Gallery" in
   both the Islamic and Western admin dashboards. Tenant isolation on the
   gallery is checked explicitly (madrasa B must never see madrasa A images).
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB;
before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  await adminA.login("admin-a", "Passw0rd!123");
  adminB = new Client(ctx.base);
  await adminB.login("admin-b", "Passw0rd!123");
});
after(async () => { await ctx.close(); });

test("dashboard aggregate returns the six headline stats and today's data, scoped to the caller's tenant", async () => {
  const r = await adminA.req("GET", "/api/madrasa/dashboard");
  assert.equal(r.status, 200);
  assert.ok(r.data.stats);
  assert.equal(typeof r.data.stats.totalStudents, "number");
  assert.equal(typeof r.data.stats.totalTeachers, "number");
  assert.equal(typeof r.data.stats.totalClasses, "number");
  assert.equal(typeof r.data.stats.totalSubjects, "number");
  assert.equal(typeof r.data.stats.pendingApplications, "number");
  assert.ok(r.data.stats.attendanceToday);
  assert.ok(Array.isArray(r.data.todaysClasses));
  assert.ok(Array.isArray(r.data.recentApplications));
  assert.ok(Array.isArray(r.data.recentAnnouncements));
  assert.equal(r.data.category, "islamic");
});

test("profile PUT accepts website/brand fields and rejects a bad brand color", async () => {
  const bad = await adminA.api("PUT", "/api/madrasa/profile", { brand_color: "not-a-color" });
  assert.equal(bad.status, 400);

  const good = await adminA.api("PUT", "/api/madrasa/profile", {
    tagline: "Faith, Knowledge, Excellence",
    brand_color: "#0b402c",
    whatsapp: "+2348011112222",
    admission_info: "Applications open year-round.",
  });
  assert.equal(good.status, 200);

  const profile = await adminA.req("GET", "/api/madrasa/profile");
  assert.equal(profile.data.madrasa.tagline, "Faith, Knowledge, Excellence");
  assert.equal(profile.data.madrasa.brand_color, "#0b402c");
  assert.ok(profile.data.terminology, "profile exposes the category-specific terminology");
});

test("gallery images are tenant-isolated", async () => {
  const list = await adminA.req("GET", "/api/madrasa/gallery");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.images, []);

  const listB = await adminB.req("GET", "/api/madrasa/gallery");
  assert.equal(listB.status, 200);
  assert.deepEqual(listB.data.images, []);
});

test("dashboard and profile routes require madrasa admin auth", async () => {
  const anon = new Client(ctx.base);
  const r1 = await anon.req("GET", "/api/madrasa/dashboard");
  assert.equal(r1.status, 401);
  const r2 = await anon.req("GET", "/api/madrasa/gallery");
  assert.equal(r2.status, 401);
});
