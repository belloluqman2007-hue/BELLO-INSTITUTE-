"use strict";
/* ============================================================================
   CANONICAL INSTITUTION WEBSITES
   --------------------------------------------------------------------------
   These tests exercise two tenants through the new /schools/:slug website
   projection. They are intentionally explicit about cross-tenant content:
   a public website is not a directory card and must never be assembled from
   platform-wide published records.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx, adminA, adminB, visitor;
before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base); await adminA.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  visitor = new Client(ctx.base);
});
after(async () => { if (ctx) await ctx.close(); });

test("/schools/:slug returns only its resolved tenant and remains independent of the directory", async () => {
  await adminA.api("PUT", "/api/madrasa/institution", {
    section: "profile", name_en: "Ameenullah School", motto_en: "Knowledge with character",
    short_description: "Ameenullah's independent public website.",
  });
  await adminB.api("PUT", "/api/madrasa/institution", {
    section: "profile", name_en: "Test Academy", motto_en: "Learning for tomorrow",
    short_description: "Test Academy's independent public website.",
  });

  const programA = await adminA.api("POST", "/api/madrasa/institution/programs", {
    title: "Ameenullah Qur'an Studies", description: "Tajweed and Hifz.", education_track: "islamic", is_published: true,
  });
  const programB = await adminB.api("POST", "/api/madrasa/institution/programs", {
    title: "Test Academy Robotics", description: "Engineering club.", education_track: "western", is_published: true,
  });
  assert.equal(programA.status, 200); assert.equal(programB.status, 200);

  const eventA = await adminA.api("POST", "/api/madrasa/institution/events", {
    title: "Ameenullah Open Day", event_date: "2026-10-01", location: "Ameenullah Hall", is_published: true,
  });
  const eventB = await adminB.api("POST", "/api/madrasa/institution/events", {
    title: "Test Academy Science Fair", event_date: "2026-10-05", is_published: true,
  });
  assert.equal(eventA.status, 200); assert.equal(eventB.status, 200);

  // The canonical website does not disappear simply because a school opts out
  // of the *platform directory*.
  await adminA.api("PUT", "/api/madrasa/institution", { section: "website", public_listing: false });
  const a = await visitor.req("GET", "/api/public/schools/testa");
  const b = await visitor.req("GET", "/api/public/schools/testb");
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.data.madrasa.nameEn, "Ameenullah School");
  assert.equal(b.data.madrasa.nameEn, "Test Academy");
  assert.equal(a.data.website.path, "/schools/testa");
  assert.match(a.data.website.url, /\/schools\/testa$/);
  assert.ok(a.data.programs.some((item) => item.title === "Ameenullah Qur'an Studies"));
  assert.ok(!a.data.programs.some((item) => item.title === "Test Academy Robotics"));
  assert.ok(a.data.events.some((item) => item.title === "Ameenullah Open Day"));
  assert.ok(!a.data.events.some((item) => item.title === "Test Academy Science Fair"));
  assert.ok(b.data.programs.some((item) => item.title === "Test Academy Robotics"));
  assert.ok(!b.data.programs.some((item) => item.title === "Ameenullah Qur'an Studies"));
  assert.equal(a.data.admissions.applicationPath, "/api/public/madaris/testa/apply");
  assert.equal(b.data.admissions.applicationPath, "/api/public/madaris/testb/apply");

  // Re-enable the directory for compatibility checks in other public routes.
  await adminA.api("PUT", "/api/madrasa/institution", { section: "website", public_listing: true });
});

test("published public teacher projections never contain private HR or contact fields", async () => {
  const teachers = await adminA.api("GET", "/api/madrasa/institution/public-teachers");
  assert.equal(teachers.status, 200);
  const teacher = teachers.data.teachers.find((row) => row.id === ctx.users.teacherA);
  assert.ok(teacher, "a tenant's existing teacher receives a private-by-default profile");
  assert.equal(teacher.isPublic, false);

  assert.equal((await adminA.api("PATCH", `/api/madrasa/institution/public-teachers/${teacher.id}`, {
    is_public: true, public_bio: "A specialist in Qur'an studies and child-centred learning.",
  })).status, 200);
  assert.equal((await adminB.api("PATCH", `/api/madrasa/institution/public-teachers/${teacher.id}`, { is_public: true })).status, 404,
    "another institution cannot publish this teacher by guessing an id");

  const site = await visitor.req("GET", "/api/public/schools/testa");
  assert.equal(site.status, 200);
  const publicTeacher = site.data.teachers.find((row) => row.name === "Teacher A");
  assert.ok(publicTeacher);
  assert.equal(publicTeacher.bio, "A specialist in Qur'an studies and child-centred learning.");
  const serialized = JSON.stringify(publicTeacher);
  for (const field of ["phone", "email", "residential_address", "salary", "emergency", "document"]) {
    assert.ok(!serialized.includes(field), `${field} is not part of a public teacher record`);
  }
  const other = await visitor.req("GET", "/api/public/schools/testb");
  assert.ok(!other.data.teachers.some((row) => row.name === "Teacher A"));
});

test("custom domain mapping, contact messages and website errors are all tenant-specific", async () => {
  const domain = await adminA.api("PUT", "/api/madrasa/institution", { section: "website", custom_domain: "www.ameenullahschool.com" });
  assert.equal(domain.status, 200);
  assert.equal(domain.data.madrasa.custom_domain, "ameenullahschool.com");
  const duplicate = await adminB.api("PUT", "/api/madrasa/institution", { section: "website", custom_domain: "ameenullahschool.com" });
  assert.equal(duplicate.status, 400, "a custom domain cannot be attached to two institutions");

  const mapped = await visitor.req("GET", "/api/public/schools/domain/current?domain=www.ameenullahschool.com");
  assert.equal(mapped.status, 200);
  assert.equal(mapped.data.madrasa.nameEn, "Ameenullah School");
  assert.equal(mapped.data.website.url, "https://ameenullahschool.com");

  const message = await visitor.req("POST", "/api/public/schools/testa/contact", {
    name: "Prospective Parent", email: "parent@example.test", phone: "+2348012345678", subject: "Visit", message: "May we visit the school?",
  });
  assert.equal(message.status, 200);
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM public_contact_messages WHERE madrasa_id = ?", [ctx.madrasaA])).n, 1);
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM public_contact_messages WHERE madrasa_id = ?", [ctx.madrasaB])).n, 0);

  assert.equal((await visitor.req("GET", "/api/public/schools/no-such-institution")).status, 404);
  assert.equal((await visitor.req("GET", "/schools/testa")).status, 200, "canonical route serves the public-site application shell");
  assert.equal((await visitor.req("GET", "/schools/no-such-institution")).status, 404,
    "an unknown canonical institution URL is an HTTP 404, never the platform or another tenant");
});
