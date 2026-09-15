"use strict";
/* ============================================================================
   REGISTRATION APPROVAL — Islamic & Western institution onboarding
   ----------------------------------------------------------------------------
   A public registration is Pending until a super admin approves it. Approval
   must:
     • create a live, active madaris row tagged with the right category
       ('islamic' | 'western') so the correct admin dashboard is served;
     • create the madrasa_admin login with the password the applicant chose;
     • seed a starter session/terms/subject catalogue so the new dashboard is
       not empty on first login;
     • never happen twice, and never leak one tenant's data across categories.
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

test("Islamic institution registers, is approved, and its admin lands in the islamic category", async () => {
  const anon = new Client(ctx.base);
  const submit = await anon.req("POST", "/api/public/register-madrasa", {
    madrasa: {
      name: "Noor Ul-Huda Madrasa", institutionType: "Madrasa",
      state: "Ogun", city: "Ijebu-Ode", address: "10 Test Ave", phone: "+2348011112222",
    },
    administrator: {
      fullName: "Ustadh Bello", position: "Proprietor", email: "bello@example.com",
      phone: "+2348011112223", password: "IslamicPass123!",
    },
    termsAccepted: true,
  });
  assert.equal(submit.status, 200);
  const regId = submit.data.registration.registrationId;
  assert.equal(submit.data.registration.category, "islamic");

  const list = await sa.api("GET", "/api/platform/registrations?status=Pending");
  assert.equal(list.status, 200);
  const found = list.data.registrations.find((r) => r.registrationId === regId);
  assert.ok(found, "the pending registration is listed for review");
  assert.equal(found.category, "islamic");

  const approve = await sa.api("POST", `/api/platform/registrations/${found.id}/approve`, {});
  assert.equal(approve.status, 200);
  assert.equal(approve.data.category, "islamic");
  assert.ok(approve.data.madrasaId > 0);

  // Approving twice must fail cleanly.
  const again = await sa.api("POST", `/api/platform/registrations/${found.id}/approve`, {});
  assert.equal(again.status, 400);

  // The new admin can log in with the password chosen at registration.
  const newAdmin = new Client(ctx.base);
  const login = await newAdmin.login(approve.data.username, "IslamicPass123!");
  assert.equal(login.status, 200);
  assert.equal(login.data.role, "madrasa_admin");

  const m = await sa.req("GET", `/api/platform/madaris/${approve.data.madrasaId}`);
  assert.equal(m.status, 200);
  assert.equal(m.data.madrasa.category, "islamic");
  assert.equal(m.data.madrasa.status, "active");
  assert.equal(m.data.madrasa.brand_color, "#200A3D", "approval persists the Islamic category's default brand colour");

  // Starter subjects follow the Islamic catalogue.
  const subj = await newAdmin.req("GET", "/api/subjects");
  assert.equal(subj.status, 200);
  const names = subj.data.subjects.map((s) => s.name_en);
  assert.ok(names.includes("Qur'an"));
  assert.ok(names.includes("Tajweed"));
});

test("Western academy registers under /register-academy and is approved into the western category", async () => {
  const anon = new Client(ctx.base);
  const submit = await anon.req("POST", "/api/public/register-academy", {
    category: "western",
    madrasa: {
      name: "Bright Future Academy", institutionType: "Nursery & Primary School",
      state: "Lagos", city: "Ikeja", address: "5 Academy Road", phone: "+2348022223333",
    },
    administrator: {
      fullName: "Mrs. Adaobi", position: "Principal", email: "adaobi@example.com",
      phone: "+2348022223334", password: "WesternPass123!",
    },
    termsAccepted: true,
  });
  assert.equal(submit.status, 200);
  assert.equal(submit.data.registration.category, "western");
  const regId = submit.data.registration.registrationId;

  const list = await sa.api("GET", "/api/platform/registrations?status=Pending");
  const found = list.data.registrations.find((r) => r.registrationId === regId);
  assert.ok(found);
  assert.equal(found.category, "western");

  const approve = await sa.api("POST", `/api/platform/registrations/${found.id}/approve`, {});
  assert.equal(approve.status, 200);
  assert.equal(approve.data.category, "western");

  const newAdmin = new Client(ctx.base);
  const login = await newAdmin.login(approve.data.username, "WesternPass123!");
  assert.equal(login.status, 200);

  const subj = await newAdmin.req("GET", "/api/subjects");
  const names = subj.data.subjects.map((s) => s.name_en);
  assert.ok(names.includes("Mathematics"));
  assert.ok(names.includes("Computer Science"));
  assert.ok(!names.includes("Qur'an"), "western academy must not inherit the Islamic subject catalogue");
});

test("a registration can be rejected instead of approved, and cannot then be approved", async () => {
  const anon = new Client(ctx.base);
  const submit = await anon.req("POST", "/api/public/register-madrasa", {
    madrasa: { name: "Reject Me Academy", state: "Oyo", city: "Ibadan", address: "1 Nowhere St", phone: "+2348033334444" },
    administrator: { fullName: "Test Person", position: "Director", email: "reject@example.com", phone: "+2348033334445", password: "RejectPass123!" },
    termsAccepted: true,
  });
  const list = await sa.api("GET", "/api/platform/registrations?status=Pending");
  const found = list.data.registrations.find((r) => r.registrationId === submit.data.registration.registrationId);

  const reject = await sa.api("POST", `/api/platform/registrations/${found.id}/reject`, { note: "Duplicate submission" });
  assert.equal(reject.status, 200);

  const approveAfterReject = await sa.api("POST", `/api/platform/registrations/${found.id}/approve`, {});
  assert.equal(approveAfterReject.status, 400);
});

test("registrations endpoints are super-admin only", async () => {
  const anon = new Client(ctx.base);
  const r = await anon.req("GET", "/api/platform/registrations");
  assert.equal(r.status, 401);
});
