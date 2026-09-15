"use strict";
/* ============================================================================
   ADMIN → MY INSTITUTION
   ----------------------------------------------------------------------------
   Covers the eight-section institution workspace end to end:

     • the section-gated PUT (a section can only write its own columns)
     • validation of colours, hours, emails, links, enums and numbers
     • the 21 default website pages, and that they are NOT all published
     • pages CRUD, reordering, and the rule that core pages cannot be deleted
     • gallery albums and media, including URL-only videos
     • deleting an album keeps its photos
     • permissions: teachers cannot write, and tenants never see each other
     • the public site actually reflects what the administrator configured,
       including the publish switch and the per-field visibility toggles
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { initEnv, setup, Client } = require("./helpers");
initEnv();

let ctx, adminA, adminB, teacherA, anon;

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  await adminA.login("admin-a", "Passw0rd!123");
  adminB = new Client(ctx.base);
  await adminB.login("admin-b", "Passw0rd!123");
  teacherA = new Client(ctx.base);
  await teacherA.login("teacher-a", "Passw0rd!123");
  anon = new Client(ctx.base);
  // Madrasa A must be publicly visible for the public-site assertions.
  await ctx.db.run("UPDATE madaris SET public_listing = 1 WHERE id = ?", [ctx.madrasaA]);
});
after(async () => { if (ctx) await ctx.close(); });

/* ---------------------------------------------------------------- overview */

test("GET /institution returns the record, resolved appearance, vocabularies and live counts", async () => {
  const r = await adminA.req("GET", "/api/madrasa/institution");
  assert.equal(r.status, 200);
  assert.equal(r.data.madrasa.slug, "testa");
  assert.equal(r.data.category, "islamic");

  // Appearance always resolves to a usable theme even before it is configured.
  assert.match(r.data.appearance.brand_color, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(r.data.appearance.islamic_color, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(r.data.appearance.western_color, /^#[0-9a-fA-F]{3,8}$/);
  assert.ok(r.data.appearance.font_family);

  // The admin SPA renders every dropdown from these lists.
  for (const key of ["ownershipTypes", "boardingStatuses", "schoolDays", "galleryCategories",
    "fonts", "homepageLayouts", "currencies", "timezones", "islamicTypes", "westernTypes"]) {
    assert.ok(Array.isArray(r.data.options[key]) && r.data.options[key].length, `options.${key} is populated`);
  }
  assert.equal(r.data.options.galleryCategories.length, 7, "the seven documented gallery categories");
  assert.ok(r.data.stats, "counts for the section headers");
});

/* --------------------------------------------------------------- section 1 */

test("the profile section saves identity, story and leadership fields", async () => {
  const r = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "profile",
    motto_en: "Knowledge and character",
    tagline: "A school for the whole child",
    short_description: "Qur'anic memorisation alongside a full academic curriculum.",
    history: "Founded in a two-room building in 1998.",
    mission: "To raise God-conscious, well-educated citizens.",
    vision: "A community transformed by knowledge.",
    core_values: "Sincerity\nDiscipline\nService",
    philosophy: "Every child learns differently.",
    ownership_type: "Private",
    founded_year: "1998",
    head_name: "Ustadh Ibrahim Salami",
    head_title: "Principal",
    registration_no: "OG/IJ/2001/114",
    accreditation_body: "Ogun State Ministry of Education",
  });
  assert.equal(r.status, 200);
  const m = r.data.madrasa;
  assert.equal(m.mission, "To raise God-conscious, well-educated citizens.");
  assert.equal(m.head_name, "Ustadh Ibrahim Salami");
  assert.equal(m.founded_year, "1998");
  assert.equal(m.ownership_type, "Private");

  // Persisted, not just echoed back.
  const again = await adminA.req("GET", "/api/madrasa/institution");
  assert.equal(again.data.madrasa.vision, "A community transformed by knowledge.");
});

test("a section can only write its own columns, and the category is never editable", async () => {
  const before = await adminA.req("GET", "/api/madrasa/institution");

  // Unknown section is refused outright rather than writing everything.
  const unknown = await adminA.api("PUT", "/api/madrasa/institution", { section: "everything", name_en: "Hijacked" });
  assert.equal(unknown.status, 400);

  // Fields outside the named section (and the tenant's own identity) are dropped.
  const crossed = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "profile", category: "western", slug: "stolen", plan_id: 999, status: "suspended",
  });
  assert.equal(crossed.status, 400, "nothing writable was supplied");

  const after = await adminA.req("GET", "/api/madrasa/institution");
  assert.equal(after.data.madrasa.category, before.data.madrasa.category);
  assert.equal(after.data.madrasa.slug, "testa");
  assert.equal(after.data.madrasa.status, before.data.madrasa.status);
});

test("profile validation rejects a malformed founded year", async () => {
  const r = await adminA.api("PUT", "/api/madrasa/institution", { section: "profile", founded_year: "ninety-eight" });
  assert.equal(r.status, 400);
});

/* --------------------------------------------------------------- section 2 */

test("the information section stores operations, and validates hours, emails and enums", async () => {
  const ok = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "information",
    country: "Nigeria",
    alt_phone: "+2348031112222",
    admissions_email: "admissions@testa.example",
    opening_time: "07:30",
    closing_time: "15:00",
    school_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    levels_offered: "Nursery to SSS3",
    islamic_education_info: "Qur'an, Tajweed, Hadith, Fiqh and Arabic.",
    western_education_info: "Mathematics, English, Sciences and ICT.",
    languages_of_instruction: "English, Arabic",
    student_capacity: "600",
    boarding_status: "Day & Boarding",
    admission_status: "open",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.madrasa.school_days, "Mon,Tue,Wed,Thu,Fri", "days are normalised to a stored list");
  assert.equal(Number(ok.data.madrasa.student_capacity), 600);
  assert.equal(ok.data.madrasa.boarding_status, "Day & Boarding");

  for (const [field, value] of [
    ["opening_time", "9am"],
    ["admissions_email", "not-an-email"],
    ["boarding_status", "Spaceship"],
    ["student_capacity", "many"],
    ["website", "javascript:alert(1)"],
  ]) {
    const bad = await adminA.api("PUT", "/api/madrasa/institution", { section: "information", [field]: value });
    assert.equal(bad.status, 400, `${field}=${value} is rejected`);
  }

  // Junk day names are filtered out rather than stored.
  const filtered = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "information", school_days: ["Mon", "Funday", "<script>"],
  });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.madrasa.school_days, "Mon");
});

/* --------------------------------------------------------------- section 4 */

test("appearance saves both education accents, validates hex and enums, and resets to the category theme", async () => {
  const saved = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "appearance",
    brand_color: "#2c0f52",
    secondary_color: "#c8952c",
    islamic_color: "#1f7a4d",
    western_color: "#0a2342",
    font_family: "serif",
    button_style: "pill",
    homepage_layout: "hero-stats",
    website_theme: "light",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.appearance.islamic_color, "#1f7a4d");
  assert.equal(saved.data.appearance.western_color, "#0a2342");
  assert.equal(saved.data.appearance.font_family, "serif");

  const badHex = await adminA.api("PUT", "/api/madrasa/institution", { section: "appearance", brand_color: "red" });
  assert.equal(badHex.status, 400);
  const badFont = await adminA.api("PUT", "/api/madrasa/institution", { section: "appearance", font_family: "Comic Sans" });
  assert.equal(badFont.status, 400);

  const reset = await adminA.api("POST", "/api/madrasa/institution/appearance/reset", {});
  assert.equal(reset.status, 200);
  assert.equal(reset.data.appearance.brand_color, "#200A3D", "back to the Islamic default");
  assert.equal(reset.data.appearance.font_family, "system");
});

/* --------------------------------------------------------------- section 5 */

test("the 21 default pages are seeded once, and they are not all published", async () => {
  const first = await adminA.req("GET", "/api/madrasa/institution/pages");
  assert.equal(first.status, 200);
  assert.equal(first.data.pages.length, 21);

  const published = first.data.pages.filter((p) => Number(p.is_published) === 1);
  assert.ok(published.length > 0 && published.length < 21,
    "the administrator decides what goes live — publishing is not forced");
  assert.ok(first.data.pages.some((p) => p.slug === "home" && Number(p.is_published) === 1));
  assert.ok(first.data.pages.some((p) => p.slug === "privacy" && Number(p.is_published) === 0));

  // Idempotent: a second read does not duplicate the defaults.
  const second = await adminA.req("GET", "/api/madrasa/institution/pages");
  assert.equal(second.data.pages.length, 21);
});

test("pages can be created, edited, reordered and published; core pages cannot be deleted", async () => {
  const created = await adminA.api("POST", "/api/madrasa/institution/pages", {
    title: "Boarding Life",
    summary: "What life in our hostel looks like.",
    body: "Our boarding house is supervised around the clock.",
    is_published: true,
    in_navigation: true,
  });
  assert.equal(created.status, 200);
  const newId = created.data.id;

  let pages = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  const mine = pages.find((p) => Number(p.id) === Number(newId));
  assert.equal(mine.slug, "boarding-life", "the address is derived from the title");
  assert.equal(Number(mine.is_system), 0);

  // Duplicate addresses are refused.
  const dupe = await adminA.api("POST", "/api/madrasa/institution/pages", { title: "Boarding Life" });
  assert.equal(dupe.status, 400);

  // Editing, including the SEO fields and menu visibility.
  const edited = await adminA.api("PATCH", `/api/madrasa/institution/pages/${newId}`, {
    seo_title: "Boarding Life at Test Madrasa A",
    seo_description: "Supervised hostel accommodation.",
    in_navigation: false,
    is_published: false,
  });
  assert.equal(edited.status, 200);

  pages = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  const after = pages.find((p) => Number(p.id) === Number(newId));
  assert.equal(after.seo_title, "Boarding Life at Test Madrasa A");
  assert.equal(Number(after.in_navigation), 0);
  assert.equal(Number(after.is_published), 0);

  // Core pages may be unpublished but never deleted.
  const home = pages.find((p) => p.slug === "home");
  const refused = await adminA.api("DELETE", `/api/madrasa/institution/pages/${home.id}`);
  assert.equal(refused.status, 400);
  const unpublished = await adminA.api("PATCH", `/api/madrasa/institution/pages/${home.id}`, { is_published: false });
  assert.equal(unpublished.status, 200);
  await adminA.api("PATCH", `/api/madrasa/institution/pages/${home.id}`, { is_published: true });

  // Reordering persists.
  const order = pages.map((p) => p.id).reverse();
  const reordered = await adminA.api("PUT", "/api/madrasa/institution/pages/reorder", { order });
  assert.equal(reordered.status, 200);
  const afterOrder = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  assert.equal(Number(afterOrder[0].id), Number(order[0]), "the new first page stuck");

  // A custom page can be deleted.
  const deleted = await adminA.api("DELETE", `/api/madrasa/institution/pages/${newId}`);
  assert.equal(deleted.status, 200);
  const remaining = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  assert.ok(!remaining.some((p) => Number(p.id) === Number(newId)));
});

/* --------------------------------------------------------------- section 6 */

test("gallery albums and videos work, and deleting an album keeps its media", async () => {
  const album = await adminA.api("POST", "/api/madrasa/institution/albums", {
    title: "Graduation 2026",
    description: "Our 2026 graduands.",
    category: "Graduation",
    is_published: true,
    is_featured: true,
  });
  assert.equal(album.status, 200);
  const albumId = album.data.id;

  const video = await adminA.api("POST", "/api/madrasa/institution/media/video", {
    video_url: "https://www.youtube.com/watch?v=abc123",
    caption: "Graduation highlights",
    category: "Graduation",
    album_id: albumId,
    is_published: true,
  });
  assert.equal(video.status, 200);
  const videoId = video.data.id;

  // Only real web links are accepted for videos.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "/relative/path"]) {
    const bad = await adminA.api("POST", "/api/madrasa/institution/media/video", { video_url: url });
    assert.equal(bad.status, 400, `${url} is rejected`);
  }

  let media = (await adminA.req("GET", "/api/madrasa/institution/media")).data.media;
  const saved = media.find((x) => Number(x.id) === Number(videoId));
  assert.equal(saved.media_type, "video");
  assert.equal(saved.video_url, "https://www.youtube.com/watch?v=abc123");
  assert.equal(Number(saved.album_id), Number(albumId));

  // Captions, categories and publication can be edited afterwards.
  const patched = await adminA.api("PATCH", `/api/madrasa/institution/media/${videoId}`, {
    caption: "Graduation day 2026", category: "Events", is_published: false,
  });
  assert.equal(patched.status, 200);
  media = (await adminA.req("GET", "/api/madrasa/institution/media")).data.media;
  const edited = media.find((x) => Number(x.id) === Number(videoId));
  assert.equal(edited.caption, "Graduation day 2026");
  assert.equal(edited.category, "Events");
  assert.equal(Number(edited.is_published), 0);

  // Deleting the album must NOT destroy the photos and videos inside it.
  const removed = await adminA.api("DELETE", `/api/madrasa/institution/albums/${albumId}`);
  assert.equal(removed.status, 200);
  media = (await adminA.req("GET", "/api/madrasa/institution/media")).data.media;
  const survivor = media.find((x) => Number(x.id) === Number(videoId));
  assert.ok(survivor, "the video survived its album");
  assert.ok(!survivor.album_id, "and is simply unfiled");

  await adminA.api("DELETE", `/api/madrasa/institution/media/${videoId}`);
});

/* --------------------------------------------------------------- section 7 */

test("contact details save with per-field public visibility switches", async () => {
  const r = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "contact",
    whatsapp: "+2348029990000",
    emergency_contact: "Security desk +2348020001111",
    maps_link: "https://maps.google.com/?q=ijebu-ode",
    facebook: "https://facebook.com/testa",
    show_phone: true,
    show_email: true,
    show_address: true,
    show_map: true,
    show_hours: true,
    show_socials: true,
    show_head: true,
    show_whatsapp: true,
    show_emergency: false,
    contact_form_enabled: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.madrasa.whatsapp, "+2348029990000");
  assert.equal(Number(r.data.madrasa.show_emergency), 0);
  assert.equal(Number(r.data.madrasa.contact_form_enabled), 1);

  const badLink = await adminA.api("PUT", "/api/madrasa/institution", { section: "contact", facebook: "javascript:alert(1)" });
  assert.equal(badLink.status, 400);
});

/* --------------------------------------------------------------- section 8 */

test("institution settings save general, localization and website defaults", async () => {
  const r = await adminA.api("PUT", "/api/madrasa/institution", {
    section: "settings",
    school_code: "TMA-001",
    timezone: "Africa/Lagos",
    currency: "NGN",
    default_language: "en",
    date_format: "DD/MM/YYYY",
    seo_title: "Test Madrasa A",
    seo_description: "Hifz and academics.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.madrasa.school_code, "TMA-001");
  assert.equal(r.data.madrasa.currency, "NGN");
  assert.equal(r.data.madrasa.seo_title, "Test Madrasa A");

  const badTz = await adminA.api("PUT", "/api/madrasa/institution", { section: "settings", timezone: "Mars/Olympus" });
  assert.equal(badTz.status, 400);
});

/* ------------------------------------------------------------- permissions */

test("only administrators may modify the institution, and tenants stay isolated", async () => {
  // Anonymous visitors cannot even read the admin projection.
  assert.equal((await anon.req("GET", "/api/madrasa/institution")).status, 401);

  // A teacher of the same tenant may not write anything in this section.
  for (const [method, path, body] of [
    ["PUT", "/api/madrasa/institution", { section: "profile", name_en: "Teacher Renamed It" }],
    ["POST", "/api/madrasa/institution/pages", { title: "Nope" }],
    ["POST", "/api/madrasa/institution/albums", { title: "Nope" }],
    ["POST", "/api/madrasa/institution/appearance/reset", {}],
  ]) {
    const r = await teacherA.api(method, path, body);
    assert.equal(r.status, 403, `teacher ${method} ${path} is refused`);
  }

  // Madrasa B sees only its own record and cannot touch A's pages.
  const bView = await adminB.req("GET", "/api/madrasa/institution");
  assert.equal(bView.data.madrasa.slug, "testb");

  const aPages = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  const target = aPages[0].id;
  assert.equal((await adminB.api("PATCH", `/api/madrasa/institution/pages/${target}`, { title: "Stolen" })).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/madrasa/institution/pages/${target}`)).status, 404);

  const stillThere = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  assert.equal(stillThere.find((p) => Number(p.id) === Number(target)).title, aPages[0].title);
});

/* ------------------------------------------------------------ public site */

test("the public website reflects the administrator's configuration", async () => {
  // Publish a page and a gallery item so there is something to see.
  const pages = (await adminA.req("GET", "/api/madrasa/institution/pages")).data.pages;
  const about = pages.find((p) => p.slug === "about-us");
  await adminA.api("PATCH", `/api/madrasa/institution/pages/${about.id}`, {
    body: "We have served Ijebu-Ode since 1998.", is_published: true, in_navigation: true,
  });
  const faqs = pages.find((p) => p.slug === "faqs");
  await adminA.api("PATCH", `/api/madrasa/institution/pages/${faqs.id}`, { is_published: false });

  const album = await adminA.api("POST", "/api/madrasa/institution/albums", {
    title: "Sports Day", category: "Sports", is_published: true, is_featured: true,
  });
  const hidden = await adminA.api("POST", "/api/madrasa/institution/albums", {
    title: "Draft album", category: "Events", is_published: false,
  });
  await adminA.api("POST", "/api/madrasa/institution/media/video", {
    video_url: "https://vimeo.com/12345", caption: "Relay final", category: "Sports",
    album_id: album.data.id, is_published: true,
  });
  await adminA.api("POST", "/api/madrasa/institution/media/video", {
    video_url: "https://vimeo.com/99999", caption: "Not ready", is_published: false,
  });

  const r = await anon.req("GET", "/api/public/madaris/testa");
  assert.equal(r.status, 200);
  const m = r.data.madrasa;

  // Identity and story from Institution Profile.
  assert.equal(m.profile.mission, "To raise God-conscious, well-educated citizens.");
  assert.equal(m.profile.headName, "Ustadh Ibrahim Salami", "shown because show_head is on");

  // Operations from Institution Information.
  assert.equal(m.information.boardingStatus, "Day & Boarding");
  assert.equal(m.information.studentCapacity, 600);

  // Appearance from Website Appearance.
  assert.match(m.appearance.brand_color, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(m.appearance.islamic_color, /^#[0-9a-fA-F]{3,8}$/);

  // Contact visibility: WhatsApp was made public, the emergency line was not.
  assert.equal(m.whatsapp, "+2348029990000");
  assert.equal(m.contact.emergency, "", "hidden because show_emergency is off");
  assert.equal(m.contact.socials.facebook, "https://facebook.com/testa");

  // Pages: only published ones, and the menu only lists what was flagged.
  assert.ok(r.data.sitePages.some((p) => p.slug === "about-us" && p.body.includes("Ijebu-Ode")));
  assert.ok(!r.data.sitePages.some((p) => p.slug === "faqs"), "unpublished pages are not exposed at all");
  assert.ok(r.data.navigation.every((p) => r.data.sitePages.some((s) => s.slug === p.slug)));

  // Gallery: published albums and media only.
  assert.ok(r.data.gallery.albums.some((a) => a.title === "Sports Day"));
  assert.ok(!r.data.gallery.albums.some((a) => a.title === "Draft album"));
  assert.ok(r.data.gallery.media.some((g) => g.caption === "Relay final" && g.type === "video"));
  assert.ok(!r.data.gallery.media.some((g) => g.caption === "Not ready"));

  assert.ok(!Object.keys(m).some((k) => k === "id"), "the internal row id is never published");
});

test("unpublishing the website takes the public page offline without touching the data", async () => {
  const off = await adminA.api("PUT", "/api/madrasa/institution", { section: "website", website_published: false });
  assert.equal(off.status, 200);

  const gone = await anon.req("GET", "/api/public/madaris/testa");
  assert.equal(gone.status, 404);

  // Nothing was destroyed — the administrator still sees everything.
  const stillThere = await adminA.req("GET", "/api/madrasa/institution/pages");
  assert.equal(stillThere.data.pages.length, 21);

  const on = await adminA.api("PUT", "/api/madrasa/institution", { section: "website", website_published: true });
  assert.equal(on.status, 200);
  assert.equal((await anon.req("GET", "/api/public/madaris/testa")).status, 200);
});

test("the website control room reports page, media and application counts", async () => {
  const r = await adminA.req("GET", "/api/madrasa/institution/website");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.pages) && r.data.pages.length === 21);
  assert.equal(typeof r.data.counts.pendingApplications, "number");
  assert.equal(typeof r.data.counts.publicNotices, "number");
  assert.equal(typeof r.data.counts.publishedMedia, "number");
});

test("existing profile and public-site endpoints keep working alongside the new section", async () => {
  // The older screens must not regress — they read and write the same record.
  const profile = await adminA.req("GET", "/api/madrasa/profile");
  assert.equal(profile.status, 200);
  assert.equal(profile.data.madrasa.head_name, "Ustadh Ibrahim Salami");

  const site = await adminA.req("GET", "/api/madrasa/public-site");
  assert.equal(site.status, 200);

  const legacy = await adminA.api("PUT", "/api/madrasa/profile", { motto_en: "Knowledge and character" });
  assert.equal(legacy.status, 200);
  const after = await adminA.req("GET", "/api/madrasa/institution");
  assert.equal(after.data.madrasa.motto_en, "Knowledge and character");
});
