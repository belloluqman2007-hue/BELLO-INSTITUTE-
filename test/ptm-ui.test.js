"use strict";
/* ============================================================================
   PARENT-TEACHER MEETINGS — browser-level regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA and the real parent portal page against the real
   API, to prove the module is wired end-to-end:
     • the Communication sidebar group gains "PTM Sessions" for BOTH
       institution categories, and the Islamic-only groups stay Islamic-only;
     • an administrator creates a session through the modal, opens it, and
       opens the booking grid (teachers as columns, slots as rows);
     • a parent signs in at /parent/meetings, walks child -> teacher -> slot
       and reaches the confirmation screen with date, time and location;
     • the booked cell then shows the parent and student names in the grid;
     • existing pages still render afterwards;
     • not one script error anywhere (the CSP forbids inline handlers).
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, PASSWORD } = require("./helpers");
initEnv();

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { /* production install */ }
const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dayOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Boot a real page with a cookie-forwarding fetch and console capture. */
async function openPage(url) {
  let cookie = "";
  const errors = [];
  const origin = new URL(url).origin;
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => {
    if (!/Not implemented: window\.(scrollTo|HTMLCanvasElement|print)/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(url, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.print = () => {};
      window.confirm = () => true;
      window.open = () => null;
      window.fetch = async (input, init = {}) => {
        const target = String(input).startsWith("http") ? String(input) : origin + String(input);
        const headers = new Headers(init.headers || {});
        if (cookie) headers.set("cookie", cookie);
        const response = await fetch(target, { ...init, headers });
        for (const value of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
          const pair = value.split(";", 1)[0]; const i = pair.indexOf("=");
          cookie = pair.slice(0, i) + "=" + pair.slice(i + 1);
        }
        return response;
      };
    },
  });
  const { window } = dom;
  return {
    window, doc: window.document, errors,
    click(el) { el.dispatchEvent(new window.Event("click", { bubbles: true })); },
    submit(form) { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); },
    close() { window.close(); },
  };
}

async function openAdmin(base, username) {
  const page = await openPage(base + "/admin");
  const { window } = page;
  for (let i = 0; i < 80 && !window.document.querySelector("#dashLoginForm"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashLoginForm"), "admin sign-in form rendered");
  window.document.querySelector("#dlUser").value = username;
  window.document.querySelector("#dlPass").value = PASSWORD;
  page.submit(window.document.querySelector("#dashLoginForm"));
  for (let i = 0; i < 100 && !window.document.querySelector("#dashContent"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashContent"), "authenticated dashboard shell rendered");
  await sleep(900);
  page.content = () => window.document.querySelector("#dashContent");
  page.route = async (route) => { window.BelloDashboard.go(route); await sleep(1000); };
  return page;
}

/** Boot the public parent portal page and sign the parent in. */
async function openParentPortal(base, username) {
  const page = await openPage(base + "/parent/meetings");
  const { window } = page;
  for (let i = 0; i < 100 && !window.document.querySelector("#ptmLoginForm"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#ptmLoginForm"), "parent sign-in form rendered");
  const form = window.document.querySelector("#ptmLoginForm");
  form.elements.username.value = username;
  form.elements.password.value = PASSWORD;
  page.submit(form);
  await sleep(1200);
  return page;
}

let ctx;
before(async () => {
  ctx = await setup();
  const bcrypt = require("bcryptjs");
  // Madrasa B is the Western Academy, with a teacher, a parent and a link so
  // the identical screens have real data on that side too.
  ctx.users.teacherB = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, "teacher-b", bcrypt.hashSync(PASSWORD, 10), "teacher", "Teacher B"]
  )).lastInsertRowid;
  await ctx.db.run("INSERT INTO teacher_assignments (madrasa_id,user_id,class_id,subject_id) VALUES (?,?,?,?)", [ctx.madrasaB, ctx.users.teacherB, ctx.classB1, ctx.subjB1]);
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic admin: PTM Sessions navigates, creates a session and shows the grid", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloPTM, "the PTM module script is loaded");
    assert.ok(page.doc.body.classList.contains("dash-islamic"), "Islamic theme applied");

    // --- The Communication group gained the new item, next to the old ones.
    const group = [...page.doc.querySelectorAll(".dash-nav-link")].find((b) => b.textContent.trim() === "Communication");
    assert.ok(group, "the Communication group is present");
    page.click(group);
    await sleep(200);
    const labels = [...page.doc.querySelectorAll(".dash-nav-sub.is-open button")].map((b) => b.textContent.trim());
    for (const expected of ["Announcements", "Messages", "Notifications", "Parent Communication", "PTM Sessions"]) {
      assert.ok(labels.includes(expected), `sidebar item "${expected}" present`);
    }

    // --- The empty state renders in the shared design system.
    await page.route("communication/ptm");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Parent-Teacher Meetings/);
    assert.ok(content.querySelector(".dash-table"), "it uses the shared table");
    assert.ok(content.querySelector(".dash-stats-grid"), "stat cards render");
    assert.match(content.textContent, /No meeting sessions yet/);

    // --- Create a session through the modal.
    page.click(content.querySelector("#ptmNew"));
    await sleep(500);
    const form = page.doc.querySelector("#ptmForm");
    assert.ok(form, "the create-session modal opened");
    form.elements.title.value = "First Term Parent-Teacher Meeting";
    form.elements.date.value = dayOffset(14);
    form.elements.session_start.value = "09:00";
    form.elements.session_end.value = "10:00";
    form.elements.slot_duration_mins.value = "10";
    form.elements.location.value = "Main hall";
    form.elements.status.value = "open";
    // The term picker is fed by the existing /api/sessions endpoint.
    assert.ok([...form.elements.term_id.options].some((o) => /First Term/.test(o.textContent)), "the seeded terms populate the picker");
    page.submit(form);
    await sleep(1400);

    content = page.content();
    assert.match(content.textContent, /First Term Parent-Teacher Meeting/, "the session is listed");
    assert.match(content.textContent, /Main hall/);
    assert.ok([...content.querySelectorAll(".dash-pill")].some((p) => p.textContent.trim() === "open"), "the status badge reads open");

    const sessionRow = await ctx.db.get("SELECT * FROM ptm_sessions WHERE madrasa_id = ? ORDER BY id DESC", [ctx.madrasaA]);
    assert.ok(sessionRow, "the row reached the database");
    assert.equal(Number(sessionRow.madrasa_id), ctx.madrasaA, "written to this tenant only");

    // --- Open the booking grid.
    page.click(content.querySelector("[data-ptm-open]"));
    await sleep(1200);
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /First Term Parent-Teacher Meeting/);
    assert.ok(content.querySelector(".ptm-grid"), "the booking grid renders");
    assert.equal(content.querySelectorAll(".ptm-grid tbody tr").length, 6, "six ten-minute slots");
    assert.match(content.querySelector(".ptm-grid thead").textContent, /Teacher A/, "teachers are the columns");
    assert.ok(content.querySelector("#ptmPrint"), "a Print button is offered");
    assert.match(content.querySelector('a[href*="export.csv"]').getAttribute("href"), /\/ptm\/\d+\/export\.csv$/, "the CSV link uses the API base");
    // Print is a bound listener, never an inline handler (CSP script-src 'self').
    assert.equal(content.querySelector("#ptmPrint").getAttribute("onclick"), null);
    page.click(content.querySelector("#ptmPrint"));
    await sleep(120);

    page.click(content.querySelector("#ptmBack"));
    await sleep(900);
    assert.match(page.content().querySelector("h2").textContent, /Parent-Teacher Meetings/, "Back returns to the list");

    assert.deepEqual(page.errors, [], "no script errors in the admin flow");
  } finally { page.close(); }
});

test("a parent books a meeting through the portal and sees the confirmation", { skip }, async () => {
  // The administrator's open session from the first test is reused.
  const session = await ctx.db.get("SELECT * FROM ptm_sessions WHERE madrasa_id = ? AND status = 'open' ORDER BY id DESC", [ctx.madrasaA]);
  assert.ok(session, "an open session exists to book against");

  const page = await openParentPortal(ctx.base, "parent-a");
  try {
    // Step 1 — the open session is offered; drafts never are.
    let sessionBtn = [...page.doc.querySelectorAll("[data-ptm-session]")].find((b) => Number(b.dataset.ptmSession) === Number(session.id));
    assert.ok(sessionBtn, "the open meeting session is listed for the parent");
    page.click(sessionBtn);
    await sleep(1000);

    // Step 2 — only this parent's own children.
    const children = [...page.doc.querySelectorAll("[data-ptm-child]")];
    assert.equal(children.length, 2, "exactly the two linked children");
    assert.match(page.doc.body.textContent, /Alpha One/);
    assert.match(page.doc.body.textContent, /Bravo Two/);
    assert.doesNotMatch(page.doc.body.textContent, /Charlie Three/, "no child from the other institution");
    page.click(children.find((b) => /Alpha One/.test(b.textContent)));
    await sleep(500);

    // Step 3 — that child's teachers, with the subject they teach.
    const teacher = [...page.doc.querySelectorAll("[data-ptm-teacher]")].find((b) => /Teacher A/.test(b.textContent));
    assert.ok(teacher, "the child's teacher is offered");
    assert.match(teacher.textContent, /Fiqh/, "the subject comes from the existing assignments");
    page.click(teacher);
    await sleep(1000);

    // Step 4 — the free slots, derived from the session window.
    const slots = [...page.doc.querySelectorAll("[data-ptm-slot]")];
    assert.equal(slots.length, 6, "six slots in a 09:00-10:00 window of 10 minutes");
    assert.match(slots[0].textContent.trim(), /^09:00$/);
    page.click(slots[2]);
    await sleep(1400);

    // Confirmation screen with the date, the time and the location.
    const confirmation = page.doc.querySelector(".ptm-confirmation");
    assert.ok(confirmation, "the confirmation screen rendered");
    assert.match(confirmation.textContent, /Meeting confirmed/i);
    assert.match(confirmation.textContent, /Alpha One/);
    assert.match(confirmation.textContent, /Teacher A/);
    assert.match(confirmation.textContent, /09:20/, "the booked time");
    assert.match(confirmation.textContent, /Main hall/, "the location");

    // It really was written, tenant-scoped, and notified both sides.
    const booking = await ctx.db.get("SELECT * FROM ptm_bookings WHERE madrasa_id = ? ORDER BY id DESC", [ctx.madrasaA]);
    assert.equal(Number(booking.slot_number), 3);
    assert.equal(String(booking.slot_time).slice(0, 5), "09:20");
    assert.equal(booking.status, "booked");
    const notes = await ctx.db.all("SELECT * FROM notifications WHERE madrasa_id = ? AND type = 'ptm_booking' AND entity_id = ?", [ctx.madrasaA, booking.id]);
    assert.equal(notes.length, 2, "the parent and the teacher were both notified");

    assert.deepEqual(page.errors, [], "no script errors in the parent flow");
  } finally { page.close(); }
});

test("the admin grid then shows the booked cell with the parent and student", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("communication/ptm");
    page.click(page.content().querySelector("[data-ptm-open]"));
    await sleep(1200);
    const content = page.content();
    const cell = content.querySelector(".ptm-cell.is-booked");
    assert.ok(cell, "the booked cell is highlighted");
    assert.match(cell.textContent, /Alpha One/, "the student name is in the cell");
    assert.match(cell.textContent, /Guardian A/, "the parent name is in the cell");
    assert.match(content.textContent, /09:20/);
    assert.ok(cell.querySelector("[data-ptm-cancel]"), "the administrator can cancel from the grid");

    // Existing pages keep working after the new module has rendered.
    await page.route("communication/announcements");
    assert.ok(page.content().textContent.length > 0, "announcements still render");
    await page.route("communication/parents");
    assert.ok(page.content().textContent.length > 0, "parent communication still renders");
    await page.route("students");
    assert.ok(page.content().textContent.length > 0, "the students page still renders");
    await page.route("dashboard");
    assert.ok(page.content().querySelector(".dash-stats-grid, .dash-stat-card"), "the dashboard home still renders");

    assert.deepEqual(page.errors, [], "no script errors after the round trip");
  } finally { page.close(); }
});

test("a Western academy admin gets the identical PTM module", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"), "Western theme applied");
    const sidebar = page.doc.querySelector(".dash-sidebar").textContent;
    assert.match(sidebar, /Communication/, "the group is never category-gated");
    assert.doesNotMatch(sidebar, /Qur'an \/ Islamic Education/, "the Islamic group stays Islamic-only");

    await page.route("communication/ptm");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Parent-Teacher Meetings/, "the same heading");
    // Tenant isolation is visible in the UI: madrasa A's session never appears.
    assert.doesNotMatch(content.textContent, /First Term Parent-Teacher Meeting/);

    page.click(content.querySelector("#ptmNew"));
    await sleep(500);
    const form = page.doc.querySelector("#ptmForm");
    form.elements.title.value = "Fall Parent-Teacher Conference";
    form.elements.date.value = dayOffset(12);
    form.elements.session_start.value = "13:00";
    form.elements.session_end.value = "14:00";
    form.elements.slot_duration_mins.value = "15";
    form.elements.location.value = "Gymnasium";
    form.elements.status.value = "open";
    page.submit(form);
    await sleep(1400);

    content = page.content();
    assert.match(content.textContent, /Fall Parent-Teacher Conference/, "the academy session is listed");
    page.click(content.querySelector("[data-ptm-open]"));
    await sleep(1200);
    content = page.content();
    assert.ok(content.querySelector(".ptm-grid"), "the same grid renders for an academy");
    assert.equal(content.querySelectorAll(".ptm-grid tbody tr").length, 4, "four fifteen-minute slots");
    assert.match(content.querySelector(".ptm-grid thead").textContent, /Teacher B/);
    assert.doesNotMatch(content.textContent, /Teacher A\b/, "no teacher from the other institution");

    assert.deepEqual(page.errors, [], "no script errors on the Western side either");
  } finally { page.close(); }
});
