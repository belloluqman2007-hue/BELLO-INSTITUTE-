"use strict";
/* ============================================================================
   PUBLIC SITE (before login) — visibility switches, result privacy, spam
   traps, publication, and the rule that nothing a tenant did not publish is
   reachable by an anonymous visitor.
   Run: npm test
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

let ctx, sa, adminA, adminB;
before(async () => {
  ctx = await setup();
  sa = new Client(ctx.base);
  await sa.login("testadmin", SA_PASSWORD);
  adminA = new Client(ctx.base); await adminA.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
});
after(async () => { await ctx.close(); });

function anon() { return new Client(ctx.base); }
async function setPublic(client, body) { return client.api("PUT", "/api/madrasa/public-site", body); }
function resultBody(extra) {
  return Object.assign({ madrasaSlug: "testa", admissionNo: "TTA0001", surname: "One" }, extra || {});
}

test("public endpoints need no session", async () => {
  const a = anon();
  const site = await a.req("GET", "/api/public/site");
  assert.equal(site.status, 200);
  assert.ok(Array.isArray(site.data.madaris) && site.data.madaris.length === 2);
  assert.ok(site.data.stats.students >= 2, "the directory shows real totals");

  const one = await a.req("GET", "/api/public/madaris/testa");
  assert.equal(one.status, 200);
  assert.equal(one.data.madrasa.nameEn, "Test Madrasa A");
  assert.equal(one.data.loginUrl, "/login", "the profile links into the portal, it does not embed it");
  const body = JSON.stringify(one.data);
  for (const forbidden of ["password_hash", "api_key", "aiConfig", "plan_id", "fee", "admission_no"]) {
    assert.ok(!body.includes('"' + forbidden + '"'), "public profile must not expose " + forbidden);
  }
  assert.equal((await a.req("GET", "/api/public/madaris/nope")).status, 404);
  const other = await a.req("GET", "/api/public/madaris/testb");
  assert.equal(other.data.madrasa.canCheckResults, false, "tenant B keeps its results private");
  assert.equal(other.data.publishedTermCount, 0);
});

test("a madrasa can hide itself from the directory and its own page", async () => {
  let r = await setPublic(adminA, { public_listing: false });
  assert.equal(r.status, 200);
  const a = anon();
  assert.deepEqual((await a.req("GET", "/api/public/madaris")).data.madaris.map((m) => m.slug), ["testb"]);
  assert.equal((await a.req("GET", "/api/public/madaris/testa")).status, 404, "the profile follows the listing switch");
  r = await setPublic(adminA, { public_listing: true });
  assert.equal(r.status, 200);
  assert.equal((await anon().req("GET", "/api/public/madaris/testa")).status, 200);
});

test("a suspended madrasa disappears from the public site", async () => {
  assert.equal((await sa.api("PATCH", `/api/platform/madaris/${ctx.madrasaB}`, { status: "suspended" })).status, 200);
  const a = anon();
  assert.deepEqual((await a.req("GET", "/api/public/madaris")).data.madaris.map((m) => m.slug), ["testa"]);
  assert.equal((await a.req("GET", "/api/public/madaris/testb")).status, 404);
  await sa.api("PATCH", `/api/platform/madaris/${ctx.madrasaB}`, { status: "active" });
});

test("the platform-wide switch turns the whole public directory off", async () => {
  await sa.api("PUT", "/api/platform/settings", {
    public_directory_enabled: "0", public_site_title: "EduSphere", public_site_tagline: "One platform, many schools",
  });
  const a = anon();
  const site = await a.req("GET", "/api/public/site");
  assert.equal(site.status, 200);
  assert.equal(site.data.directoryEnabled, false);
  assert.equal(site.data.madaris.length, 0);
  assert.equal((await a.req("GET", "/api/public/madaris")).data.madaris.length, 0);
  assert.equal(site.data.site.title, "EduSphere", "the branding is still served");

  const settings = await sa.api("GET", "/api/platform/settings");
  assert.equal(settings.data.settings.public_directory_enabled, false, "booleans come back as booleans");
  await sa.api("PUT", "/api/platform/settings", { public_directory_enabled: "1" });
});

/* ------------------------------ results -------------------------------- */

test("result checking is refused while the madrasa keeps results private", async () => {
  await setPublic(adminA, { public_results: false });
  const r = await anon().req("POST", "/api/public/results/verify", resultBody());
  assert.equal(r.status, 403);
  assert.match(r.data.error, /does not publish/i);
});

test("nothing is visible until the class term is published", async () => {
  await setPublic(adminA, { public_results: true });
  await ctx.db.run("UPDATE term_summaries SET published_at = NULL");
  const r = await anon().req("POST", "/api/public/results/verify", resultBody());
  assert.equal(r.status, 200, "identity matched, so the student is confirmed…");
  assert.equal(r.data.verified, true);
  assert.deepEqual(r.data.terms, [], "…but no marks are released");
  assert.match(r.data.message, /not been published/i);
});

test("publishing a class exposes summaries and expiring report-card links", async () => {
  const pub = await adminA.api("PUT", "/api/results/summaries/publish", { classId: ctx.classA1, termId: ctx.termA1 });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.published, true);
  assert.equal(pub.data.count, 2, "both pupils of the class were published");

  const r = await anon().req("POST", "/api/public/results/verify", resultBody());
  assert.equal(r.status, 200);
  assert.equal(r.data.terms.length, 1);
  const term = r.data.terms[0];
  assert.ok(term.token && term.token.length > 20, "a one-time token is returned");
  assert.ok(Number(term.position) >= 1, "a class position is published");
  assert.match(term.reportUrl, /^\/api\/public\/results\/report\//);

  const card = await anon().req("GET", "/api/public/results/report/" + encodeURIComponent(term.token));
  assert.equal(card.status, 200);
  const html = await card.res.text();
  assert.match(html, /<title>Report Card/);
  assert.match(html, /Alpha One/);

  // Retracting a published term hides it again, tokens and all.
  await adminA.api("PUT", "/api/results/summaries/publish", { classId: ctx.classA1, termId: ctx.termA1, publish: false });
  const gone = await anon().req("POST", "/api/public/results/verify", resultBody());
  assert.deepEqual(gone.data.terms, []);
  const oldCard = await anon().req("GET", "/api/public/results/report/" + encodeURIComponent(term.token));
  assert.equal(oldCard.status, 403, "a link to retracted results stops working");

  await adminA.api("PUT", "/api/results/summaries/publish", { classId: ctx.classA1, termId: ctx.termA1 });
});

test("a teacher may enter marks but may not publish them", async () => {
  const teacher = new Client(ctx.base);
  await teacher.login("teacher-a", PASSWORD);
  const r = await teacher.api("PUT", "/api/results/summaries/publish", { classId: ctx.classA1, termId: ctx.termA1 });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /administration/i);
});

test("wrong credentials give no information, and links cannot be forged", async () => {
  const a = anon();
  const bad = await a.req("POST", "/api/public/results/verify", resultBody({ surname: "Nobody" }));
  assert.equal(bad.status, 404);
  assert.match(bad.data.error, /No matching record/i);

  const good = await a.req("POST", "/api/public/results/verify", resultBody({ dateOfBirth: "2012-01-01" }));
  assert.equal(good.status, 200, "date of birth is accepted instead of the surname");

  assert.equal((await a.req("GET", "/api/public/results/report/AAAA.BBBB")).status, 403, "malformed token");
  const term = (await a.req("POST", "/api/public/results/verify", resultBody())).data.terms[0];
  const tampered = term.token.slice(0, -4) + "aaaa";
  assert.equal((await a.req("GET", "/api/public/results/report/" + encodeURIComponent(tampered))).status, 403);

  const missing = await a.req("POST", "/api/public/results/verify", { madrasaSlug: "testa" });
  assert.equal(missing.status, 400);
});

test("an admission number only unlocks results inside its own madrasa", async () => {
  await setPublic(adminB, { public_results: true });
  const a = anon();
  const r = await a.req("POST", "/api/public/results/verify", { madrasaSlug: "testb", admissionNo: "TTA0001", surname: "One" });
  assert.equal(r.status, 404, "tenant A's number is not a key in tenant B");
  await setPublic(adminB, { public_results: false });
});

/* --------------------------- admission requests ------------------------ */

test("online admission is closed until the school opens it", async () => {
  await setPublic(adminA, { public_admissions: false });
  const r = await anon().req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Want", last_name: "In", parent_name: "Mr In", parent_phone: "+2348012345678",
  });
  assert.equal(r.status, 404);
  assert.match(r.data.error, /not open/i);
});

test("an application is submitted, tracked, then admitted into the register", async () => {
  await setPublic(adminA, { public_admissions: true });
  await adminA.api("PUT", "/api/madrasa/settings", { admission_prefix: "TTA" });
  const a = anon();
  const r = await a.req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Hopeful", last_name: "Candidate", name_ar: "أمل", gender: "F",
    date_of_birth: "2013-05-05", parent_name: "Mrs Candidate", parent_phone: "+2348012345678",
    parent_email: "p@example.test", message: "Please consider her", class_id: ctx.classA1,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ref = r.data.reference;
  assert.match(ref, /^ADM-\d{4}-[0-9A-F]{6}$/);

  const track = await a.req("GET", `/api/public/madaris/testa/apply-status?reference=${ref}&phone=%2B2348012345678`);
  assert.equal(track.status, 200);
  assert.equal(track.data.status, "pending");
  assert.equal(track.data.student, "Hopeful Candidate");
  assert.equal((await a.req("GET", `/api/public/madaris/testa/apply-status?reference=${ref}&phone=0809999`)).status, 404,
    "the phone number is a second factor for tracking");

  const list = await adminA.api("GET", "/api/admissions?status=pending");
  assert.equal(list.status, 200);
  const row = list.data.requests.find((x) => x.reference === ref);
  assert.ok(row, "the school sees the application");
  assert.equal(list.data.byStatus.pending, 1);

  assert.equal((await adminB.api("GET", "/api/admissions?status=pending")).data.requests.length, 0, "other tenant sees nothing");
  assert.equal((await adminB.api("GET", "/api/admissions/" + row.id)).status, 404, "not even by id");

  const approve = await adminA.api("POST", `/api/admissions/${row.id}/approve`, {
    class_id: ctx.classA1, create_student_account: true, create_parent_account: true, password: "Fresh1234!",
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  assert.equal(approve.data.admissionNo, "TTA0003", "the tenant sequence continues");
  assert.ok(approve.data.portalCreated);

  const stu = new Client(ctx.base);
  assert.equal((await stu.login(approve.data.username, "Fresh1234!")).status, 200, "the new pupil can sign in");
  const par = new Client(ctx.base);
  assert.equal((await par.login(approve.data.parentUsername, "Fresh1234!")).status, 200, "the new guardian can sign in");
  const children = await par.api("GET", "/api/portal/me");
  assert.equal(children.data.children.length, 1, "the guardian sees exactly this child");

  // The applicant can now see the outcome, and the school keeps the trail.
  const after = await a.req("GET", `/api/public/madaris/testa/apply-status?reference=${ref}&phone=%2B2348012345678`);
  assert.equal(after.status, 200);
  assert.equal(after.data.status, "approved");
  assert.equal(after.data.admissionNo, "TTA0003");
  const detail = await adminA.api("GET", "/api/admissions/" + row.id);
  assert.equal(detail.data.request.admission_no_assigned, "TTA0003");
  assert.equal(detail.data.student.first_name, "Hopeful");
  assert.equal(detail.data.request.reviewed_by, ctx.users.adminA, "who approved it is recorded");

  const again = await adminA.api("POST", `/api/admissions/${row.id}/approve`, { password: "Fresh1234!" });
  assert.equal(again.status, 400, "an approved application cannot be approved twice");

  // A duplicate application from the same phone is turned away.
  const dupe = await a.req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Hopeful", last_name: "Candidate", parent_name: "Mrs Candidate", parent_phone: "+2348012345678",
  });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.data));
  assert.match(dupe.data.error, /already submitted/i);
  assert.match(dupe.data.error, new RegExp(ref.slice(0, 8), "i"), "the message repeats the existing reference");
});

test("a weak portal password aborts the approval, leaving no half-created pupil", async () => {
  const a = anon();
  const r = await a.req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Second", last_name: "Applicant", parent_name: "Mr X", parent_phone: "+2348099998888",
  });
  const row = (await adminA.api("GET", "/api/admissions?status=pending")).data.requests.find((x) => x.reference === r.data.reference);

  const bad = await adminA.api("POST", `/api/admissions/${row.id}/approve`, { create_student_account: true, password: "short" });
  assert.equal(bad.status, 400);
  assert.equal((await adminA.api("GET", "/api/admissions/" + row.id)).data.request.status, "pending");
  assert.equal(await ctx.db.get("SELECT COUNT(*) AS n FROM students WHERE first_name = 'Second'").then((r2) => Number(r2.n)), 0);

  const good = await adminA.api("POST", `/api/admissions/${row.id}/approve`, { create_student_account: true, password: "GoodPass123!" });
  assert.equal(good.status, 200);
  assert.equal(good.data.portalCreated, true);

});

test("hold and reject are recorded with the reviewer's note", async () => {
  const a = anon();
  const mk = async (name, phone) => {
    const r = await a.req("POST", "/api/public/madaris/testa/apply", { first_name: name, parent_name: "P", parent_phone: phone });
    return r.data.reference;
  };
  const refHold = await mk("Holdme", "+2348011112222");
  const refReject = await mk("Rejectme", "+2348011113333");
  const list = await adminA.api("GET", "/api/admissions?status=pending");
  const h = list.data.requests.find((x) => x.reference === refHold);
  const j = list.data.requests.find((x) => x.reference === refReject);

  assert.equal((await adminA.api("POST", `/api/admissions/${h.id}/hold`, { note: "Awaiting birth certificate" })).status, 200);
  assert.equal((await adminA.api("POST", `/api/admissions/${j.id}/reject`, { note: "Age requirement not met" })).status, 200);

  const detail = await adminA.api("GET", "/api/admissions/" + h.id);
  assert.equal(detail.data.request.status, "on_hold");
  assert.equal(detail.data.request.review_note, "Awaiting birth certificate");

  const tracked = await a.req("GET", `/api/public/madaris/testa/apply-status?reference=${refReject}&phone=%2B2348011113333`);
  assert.equal(tracked.status, 200);
  assert.equal(tracked.data.status, "rejected", "the family can see the outcome");
  assert.ok(!("review_note" in tracked.data), "internal notes are never sent to the family");

  const counts = await adminA.api("GET", "/api/admissions");
  assert.deepEqual(counts.data.byStatus, { pending: 0, approved: 2, on_hold: 1, rejected: 1 });

  // A rejected application can still be revived.
  assert.equal((await adminA.api("POST", `/api/admissions/${j.id}/approve`, { class_id: ctx.classA1 })).status, 200);
});

test("invalid applications are rejected and the honeypot discards bots", async () => {
  const a = anon();
  assert.equal((await a.req("POST", "/api/public/madaris/testa/apply", { first_name: "NoParent" })).status, 400);
  assert.equal((await a.req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Bad", parent_name: "P", parent_phone: "not-a-phone",
  })).status, 400);

  const spam = await a.req("POST", "/api/public/madaris/testa/apply", {
    first_name: "Bot", parent_name: "Bot", parent_phone: "+2348011111111", website: "http://spam",
  });
  assert.equal(spam.status, 200, "the bot is told it worked");
  const list = await adminA.api("GET", "/api/admissions?perPage=200");
  assert.ok(!list.data.requests.some((x) => x.first_name === "Bot"), "no row was created for the honeypot");
});

/* ------------------------------ notices -------------------------------- */

test("only notices marked public reach the logged-out site", async () => {
  const made = await adminA.api("POST", "/api/announcements", { title: "Fees due", body: "Internal wording", audience: "parents" });
  assert.equal(made.status, 200);
  let notices = await anon().req("GET", "/api/public/madaris/testa/notices");
  assert.ok(!notices.data.notices.some((n) => n.title === "Fees due"), "not public yet");

  await adminA.api("PATCH", `/api/announcements/${made.data.id}`, { publish_public: true });
  notices = await anon().req("GET", "/api/public/madaris/testa/notices");
  const found = notices.data.notices.find((n) => n.title === "Fees due");
  assert.ok(found);
  assert.equal(found.body, "Internal wording", "the wording itself is what parents read");
  assert.equal(found.created_by, undefined, "no internal fields leak");
  assert.equal(found.audience, undefined);

  await adminA.api("PATCH", `/api/announcements/${made.data.id}`, { publish_until: "2020-01-01" });
  notices = await anon().req("GET", "/api/public/madaris/testa/notices");
  assert.ok(!notices.data.notices.some((n) => n.title === "Fees due"), "an expired notice is hidden");

  const profile = await anon().req("GET", "/api/public/madaris/testa");
  assert.ok(!profile.data.notices.some((n) => n.title === "Fees due"));

  await adminA.api("PATCH", `/api/announcements/${made.data.id}`, { publish_public: false });
});

test("the public profile reports what is available to visitors", async () => {
  const r = await adminA.api("GET", "/api/madrasa/public-site");
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.public_listing, true);
  assert.equal(r.data.settings.public_results, true);
  assert.equal(r.data.counts.publishedResults > 0, true);
  assert.match(r.data.urls.directory, /^\/madrasa\/testa$/);
  assert.match(r.data.urls.results, /results-check\?madrasa=testa$/);
});

test("public routes never create a session", async () => {
  const before = await ctx.db.get("SELECT COUNT(*) AS n FROM app_sessions");
  const sessionsBefore = Number(before.n);
  const a = anon();
  for (const p of ["/api/public/site", "/api/public/madaris", "/api/public/madaris/testa", "/api/public/madaris/testa/notices", "/api/public/status"]) {
    assert.equal((await a.req("GET", p)).status, 200, p);
  }
  await a.req("POST", "/api/public/results/verify", resultBody({ surname: "Nobody" }));
  assert.equal(a.cookies.mm_session, undefined, "an anonymous visitor is never issued a session cookie");
  const sessions = await ctx.db.get("SELECT COUNT(*) AS n FROM app_sessions");
  assert.equal(Number(sessions.n), sessionsBefore, "public traffic never inflates the session table");
});

/* ----------------------- madrasa registration --------------------------- */

test("madrasa registration validates required fields and returns structured receipt", async () => {
  const a = anon();

  // Missing madrasa name
  const missingName = await a.req("POST", "/api/public/register-madrasa", {
    madrasa: { state: "Lagos", city: "Ikeja", address: "123 Street", phone: "+2348012345678" },
    administrator: { fullName: "Ahmad Ibrahim", position: "Proprietor", email: "ahmad@example.com", phone: "+2348012345678", password: "Password123!" },
    termsAccepted: true,
  });
  assert.equal(missingName.status, 400);

  // Missing terms acceptance
  const missingTerms = await a.req("POST", "/api/public/register-madrasa", {
    madrasa: { name: "Al-Hikmah Academy", state: "Lagos", city: "Ikeja", address: "123 Street", phone: "+2348012345678" },
    administrator: { fullName: "Ahmad Ibrahim", position: "Proprietor", email: "ahmad@example.com", phone: "+2348012345678", password: "Password123!" },
    termsAccepted: false,
  });
  assert.equal(missingTerms.status, 400);

  // Valid registration
  const valid = await a.req("POST", "/api/public/register-madrasa", {
    madrasa: {
      name: "Al-Hikmah Islamic Academy",
      officialName: "Al-Hikmah Educational Foundation",
      description: "Dedicated to Qur'an and Arabic learning.",
      yearEstablished: "2010",
      institutionType: "Madrasa",
      country: "Nigeria",
      state: "Ogun",
      city: "Ijebu-Ode",
      address: "15 Folagbade Street, Ijebu-Ode",
      mapsLink: "https://maps.google.com/?q=Ijebu-Ode",
      phone: "+2348023456789",
      whatsapp: "+2348023456789",
      email: "info@alhikmah.edu.ng",
      website: "https://alhikmah.edu.ng",
      subjects: ["Qur'an", "Tajweed", "Hadith", "Arabic Language"],
      studentCount: "180",
      teacherCount: "14",
      classCount: "8",
      ageGroups: ["Children", "Teenagers", "Adults"],
    },
    administrator: {
      fullName: "Ustadh Ahmad Ibrahim",
      position: "Proprietor",
      email: "ahmad.ibrahim@alhikmah.edu.ng",
      phone: "+2348023456789",
      password: "StrongSecretPassword123!",
    },
    termsAccepted: true,
  });

  assert.equal(valid.status, 200);
  assert.equal(valid.data.ok, true);
  assert.ok(valid.data.registration.registrationId.startsWith("REG-2026-"));
  assert.equal(valid.data.registration.status, "Pending");
  assert.equal(valid.data.madrasa.name, "Al-Hikmah Islamic Academy");
  assert.equal(valid.data.administrator.fullName, "Ustadh Ahmad Ibrahim");
  assert.equal(valid.data.administrator.password, undefined, "password is never echoed");

  // Check registration status lookup
  const regId = valid.data.registration.registrationId;
  const statusRes = await a.req("GET", `/api/public/registration-status/${regId}`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.found, true);
  assert.equal(statusRes.data.registrationId, regId);
  assert.equal(statusRes.data.status, "Pending");
  assert.equal(statusRes.data.madrasaName, "Al-Hikmah Islamic Academy");
});
