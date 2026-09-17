"use strict";
/* ============================================================================
   STAFF LEAVE — browser-level regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA against the real API to prove the Staff Leave
   section is wired end-to-end: sidebar navigation for BOTH institution
   categories, each of the five screens rendering live data in the existing
   design system, a request actually being filed through the modal and then
   approved (with the balance and calendar updating), and the existing pages
   still working afterwards — all without a single script error (CSP-safe).
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, PASSWORD } = require("./helpers");
initEnv();

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { /* production install */ }
const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openAdmin(base, username) {
  let cookie = "";
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => {
    if (!/Not implemented: window\.(scrollTo|HTMLCanvasElement)/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.open = () => null;
      window.fetch = async (input, init = {}) => {
        const url = String(input).startsWith("http") ? input : base + input;
        const headers = new Headers(init.headers || {});
        if (cookie) headers.set("cookie", cookie);
        const response = await fetch(url, { ...init, headers });
        for (const value of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
          const pair = value.split(";", 1)[0]; const i = pair.indexOf("=");
          cookie = pair.slice(0, i) + "=" + pair.slice(i + 1);
        }
        return response;
      };
    },
  });
  const { window } = dom;
  for (let i = 0; i < 80 && !window.document.querySelector("#dashLoginForm"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashLoginForm"), "admin sign-in form rendered");
  window.document.querySelector("#dlUser").value = username;
  window.document.querySelector("#dlPass").value = PASSWORD;
  window.document.querySelector("#dashLoginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 100 && !window.document.querySelector("#dashContent"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashContent"), "authenticated dashboard shell rendered");
  await sleep(900);
  return {
    window, doc: window.document, errors,
    content: () => window.document.querySelector("#dashContent"),
    async route(route) { window.BelloDashboard.go(route); await sleep(1000); },
    click(el) { el.dispatchEvent(new window.Event("click", { bubbles: true })); },
    submit(form) { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); },
    close() { window.close(); },
  };
}

let ctx;
before(async () => {
  ctx = await setup();
  const bcrypt = require("bcryptjs");
  // Give madrasa B (Western Academy) a teacher so the shared screens have data.
  ctx.users.teacherB = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, "teacher-b", bcrypt.hashSync(PASSWORD, 10), "teacher", "Teacher B"]
  )).lastInsertRowid;
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic admin: Staff Leave navigates, files and approves through the real UI", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloLeave, "the leave module is loaded");
    assert.ok(page.doc.body.classList.contains("dash-islamic"), "Islamic theme applied");

    // --- Sidebar exposes the Staff Leave group with its five screens.
    const group = [...page.doc.querySelectorAll(".dash-nav-link")].find((b) => b.textContent.trim() === "Staff Leave");
    assert.ok(group, "Staff Leave group present in the sidebar");
    page.click(group);
    await sleep(150);
    const labels = [...page.doc.querySelectorAll(".dash-nav-sub.is-open button")].map((b) => b.textContent.trim());
    for (const expected of ["Leave Requests", "Leave Calendar", "Leave Balances", "Leave Types", "My Leave"]) {
      assert.ok(labels.includes(expected), `sidebar item "${expected}" present`);
    }

    // --- Leave Types: the seeded catalogue renders in the shared table.
    await page.route("hr/types");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Leave Types/);
    assert.ok(content.querySelector(".dash-table"), "types use the shared table");
    assert.match(content.textContent, /Annual Leave/);
    assert.match(content.textContent, /Maternity \/ Paternity Leave/);
    assert.match(content.textContent, /Unpaid/);

    // Add a type through the modal.
    page.click(content.querySelector("#lvAddType"));
    await sleep(300);
    const typeForm = page.doc.querySelector("#leaveTypeForm");
    assert.ok(typeForm, "leave type modal opened");
    typeForm.elements.name.value = "Compassionate Leave";
    typeForm.elements.days_per_year.value = "7";
    page.submit(typeForm);
    await sleep(1200);
    assert.match(page.content().textContent, /Compassionate Leave/, "the new type is listed");

    // --- Leave Requests: file one through the modal, then approve it.
    await page.route("hr/requests");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Leave Requests/);
    assert.ok(content.querySelector("#lvStatus"), "status filter present");
    assert.ok(content.querySelector(".dash-stats-grid").textContent.includes("Pending approval"), "stat cards render");

    page.click(content.querySelector("#leaveNew"));
    await sleep(400);
    const form = page.doc.querySelector("#leaveRequestForm");
    assert.ok(form, "request modal opened");
    form.elements.user_id.value = String(ctx.users.teacherA);
    const annual = [...form.elements.type_id.options].find((o) => /^Annual Leave/.test(o.textContent));
    assert.ok(annual, "the seeded catalogue populates the type picker");
    form.elements.type_id.value = annual.value;
    form.elements.start_date.value = "2026-11-02";
    form.elements.end_date.value = "2026-11-04";
    form.elements.reason.value = "Family commitment in Kano";
    page.submit(form);
    await sleep(1400);
    content = page.content();
    assert.match(content.textContent, /Teacher A/, "the filed request is listed");
    assert.match(content.textContent, /Pending/, "it starts pending");

    // Approve it with a note.
    const approve = content.querySelector("[data-approve]");
    assert.ok(approve, "an approve action is offered for a pending request");
    page.click(approve);
    await sleep(400);
    const decision = page.doc.querySelector("#leaveDecision");
    assert.ok(decision, "approval modal opened");
    assert.match(decision.textContent, /Family commitment in Kano/, "the reason is shown to the approver");
    decision.elements.note.value = "Approved, cover arranged.";
    page.submit(decision);
    await sleep(1400);
    content = page.content();
    assert.match(content.textContent, /Approved/, "the row now reads approved");

    // The approval really did write the existing attendance register.
    const rows = await ctx.db.all(
      "SELECT day, status FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ? AND status = 'on_leave' ORDER BY day",
      [ctx.madrasaA, ctx.users.teacherA]
    );
    assert.equal(rows.length, 3, "Mon–Wed written into teacher_attendance");
    assert.equal(rows[0].day, "2026-11-02");

    // --- Leave Balances: the approved days are deducted on screen.
    await page.route("hr/balances");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Leave Balances/);
    assert.match(content.textContent, /Teacher A/);
    assert.match(content.textContent, /18 left/, "21 days entitlement minus the 3 approved days");
    assert.match(content.textContent, /Days taken/, "stat cards render");

    // --- Leave Calendar: the approved leave is colour-coded in the grid.
    await page.route("hr/calendar");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Leave Calendar/);
    assert.ok(content.querySelector(".leave-grid"), "the monthly grid renders");
    assert.equal(content.querySelectorAll(".leave-weekdays span").length, 7, "seven weekday headers");
    assert.ok(content.querySelector("#lvLegend .dash-chip"), "the type legend renders");
    // Walk to November 2026 and confirm the entries appear.
    for (let i = 0; i < 24 && !/November 2026/.test(content.querySelector("#lvMonthLabel").textContent); i++) {
      page.click(content.querySelector("#lvNextMonth"));
      await sleep(250);
      content = page.content();
    }
    assert.match(content.querySelector("#lvMonthLabel").textContent, /November 2026/);
    assert.ok(content.querySelectorAll(".leave-day.has-leave").length >= 3, "the leave days are marked");
    assert.match(content.querySelector(".leave-entry").textContent, /Teacher A/);

    // --- My Leave: an administrator is told they have no entitlement of their own.
    await page.route("hr/my-leave");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /My Leave/);
    assert.match(content.textContent, /Administrator account/);

    // --- Existing pages still work after the new module has rendered.
    await page.route("attendance/teachers");
    assert.ok(page.content().textContent.length > 0, "the teacher attendance page still renders");
    await page.route("payroll/structures");
    assert.match(page.content().querySelector("h2").textContent, /Salary Structures/, "payroll is unaffected");
    await page.route("dashboard");
    assert.ok(page.content().querySelector(".dash-stats-grid, .dash-stat-card"), "the dashboard home still renders");

    assert.deepEqual(page.errors, [], "no script errors anywhere in the flow");
  } finally { page.close(); }
});

test("Western academy admin gets the identical Staff Leave module", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"), "Western theme applied");
    const sidebar = page.doc.querySelector(".dash-sidebar").textContent;
    assert.match(sidebar, /Staff Leave/, "leave is never category-gated");
    assert.doesNotMatch(sidebar, /Qur'an \/ Islamic Education/, "the Islamic group stays Islamic-only");

    await page.route("hr/types");
    let content = page.content();
    assert.match(content.textContent, /Annual Leave/, "the same catalogue is seeded for an academy");
    assert.match(content.textContent, /Study Leave/);

    await page.route("hr/requests");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Leave Requests/);
    assert.ok(content.querySelector("#lvRows"), "the same table renders");
    // Tenant isolation is visible in the UI: madrasa A's teacher never appears.
    assert.doesNotMatch(content.textContent, /Teacher A/);

    await page.route("hr/balances");
    assert.match(page.content().querySelector("h2").textContent, /Leave Balances/);
    await page.route("hr/calendar");
    assert.ok(page.content().querySelector(".leave-grid"), "the calendar grid renders for an academy");

    assert.deepEqual(page.errors, [], "no script errors on the Western side either");
  } finally { page.close(); }
});

test("a teacher's self-service screen shows only their own leave", { skip }, async () => {
  // The admin SPA admits administrators only, so the teacher-facing contract
  // (GET /api/leave/me + POST /api/leave) is asserted at the API level here —
  // this is exactly what a teacher portal / teacher dashboard will render.
  const { Client } = require("./helpers");
  const teacher = new Client(ctx.base);
  assert.equal((await teacher.login("teacher-a", PASSWORD)).status, 200);

  const mine = await teacher.req("GET", "/api/leave/me");
  assert.equal(mine.status, 200);
  assert.ok(mine.data.staff, "the teacher has a staff record");
  assert.ok(mine.data.balances.length >= 6, "one balance per leave type");
  assert.ok(mine.data.requests.every((r) => Number(r.user_id) === ctx.users.teacherA));

  const filed = await teacher.api("POST", "/api/leave", {
    type_id: mine.data.types.find((t) => t.code === "sick").id,
    start_date: "2027-04-05", end_date: "2027-04-06", reason: "Medical appointment.",
  });
  assert.equal(filed.status, 200);
  assert.equal(filed.data.days, 2);

  const after = await teacher.req("GET", "/api/leave/me");
  assert.ok(after.data.requests.some((r) => r.id === filed.data.id), "it appears in their own history");
  const sick = after.data.balances.find((b) => b.type_code === "sick" || b.type_name === "Sick Leave");
  assert.equal(sick.pending, 2, "pending days are shown separately from taken days");
  assert.equal(sick.taken, 0, "a pending request is not yet deducted");
});
