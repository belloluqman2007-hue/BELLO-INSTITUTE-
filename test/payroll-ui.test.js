"use strict";
/* ============================================================================
   PAYROLL — browser-level regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA against the real API to prove the Payroll section
   is wired end-to-end: sidebar navigation for BOTH institution categories,
   each of the four screens rendering live data in the existing design system,
   a structure actually saving through the modal, a period being processed,
   the payslip list/print affordances, and advances being issued — all without
   a single script error (CSP-safe, no console errors).
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
      window.open = () => null; // payslip print buttons open a new tab
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
    close() { window.close(); },
  };
}

let ctx;
before(async () => {
  ctx = await setup();
  // Give madrasa B (Western Academy) a teacher so the shared screens have data.
  const bcrypt = require("bcryptjs");
  ctx.users.teacherB = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, "teacher-b", bcrypt.hashSync(PASSWORD, 10), "teacher", "Teacher B"]
  )).lastInsertRowid;
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic admin: Payroll section navigates, renders and saves through the real UI", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloPayroll, "the payroll module is loaded");
    assert.ok(page.doc.body.classList.contains("dash-islamic"), "Islamic theme applied");

    // Sidebar exposes the Payroll group with its four screens.
    const group = [...page.doc.querySelectorAll(".dash-nav-link")].find((b) => b.textContent.trim() === "Payroll");
    assert.ok(group, "Payroll group present in the sidebar");
    group.dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(150);
    const labels = [...page.doc.querySelectorAll(".dash-nav-sub.is-open button")].map((b) => b.textContent.trim());
    for (const expected of ["Salary Structures", "Pay Periods", "Payslips", "Advances & Loans"]) {
      assert.ok(labels.includes(expected), `sidebar item "${expected}" present`);
    }

    // --- Salary Structures: renders, saves through the modal, lists the row.
    await page.route("payroll/structures");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Salary Structures/);
    assert.ok(content.querySelector(".dash-table"), "structures use the shared table");
    assert.ok(content.querySelector("#addStructure"), "add button present");

    content.querySelector("#addStructure").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(300);
    const form = page.doc.querySelector("#structureForm");
    assert.ok(form, "structure modal opened");
    form.elements.user_id.value = String(ctx.users.teacherA);
    form.elements.grade.value = "Senior Teacher";
    form.elements.base_ngn.value = "250000";
    form.elements.housing.value = "40000";
    form.elements.tax.value = "20000";
    form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1200);
    content = page.content();
    assert.match(content.textContent, /Teacher A/, "saved structure lists the teacher");
    assert.match(content.textContent, /Senior Teacher/, "saved structure lists the grade");

    // --- Advances: issue one through the modal.
    await page.route("payroll/advances");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Advances & Loans/);
    content.querySelector("#addAdvance").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(300);
    const advanceForm = page.doc.querySelector("#advanceForm");
    assert.ok(advanceForm, "advance modal opened");
    advanceForm.elements.user_id.value = String(ctx.users.teacherA);
    advanceForm.elements.amount.value = "120000";
    advanceForm.elements.repayment_months.value = "12";
    advanceForm.elements.reason.value = "Rent support";
    advanceForm.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1200);
    content = page.content();
    assert.match(content.textContent, /Rent support/, "issued advance is listed");
    assert.match(content.textContent, /₦120,000/, "advance amount formatted");

    // --- Pay Periods: create, process, and see the status move.
    await page.route("payroll/periods");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Pay Periods/);
    content.querySelector("#addPeriod").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(300);
    const periodForm = page.doc.querySelector("#periodForm");
    assert.ok(periodForm, "period modal opened");
    periodForm.elements.session_id.value = String(ctx.sessionA);
    periodForm.elements.month.value = "9";
    periodForm.elements.year.value = "2026";
    periodForm.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1200);
    content = page.content();
    assert.match(content.textContent, /September 2026/, "period row rendered");

    const processBtn = content.querySelector("[data-process-period]");
    assert.ok(processBtn, "process action available on the draft period");
    processBtn.dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(1500);
    content = page.content();
    assert.match(content.textContent, /Processed/, "period status moved to processed");
    assert.ok(content.querySelector("[data-pay-period]"), "mark-paid action now available");
    assert.ok(content.querySelector(`a[href*="/payroll/periods/"][href$="/export.csv"]`), "CSV export link present");

    // --- Payslips: filterable list with print affordance.
    await page.route("payroll/payslips");
    await sleep(400);
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Payslips/);
    assert.ok(content.querySelector("#slipPeriod"), "period filter present");
    assert.ok(content.querySelector("#slipTeacher"), "teacher filter present");
    assert.match(content.textContent, /Teacher A/, "payslip row for the processed teacher");
    // base 250,000 + housing 40,000 - tax 20,000 - advance instalment 10,000
    assert.match(content.textContent, /₦260,000/, "computed net pay displayed");
    const printBtn = content.querySelector("[data-print-slip]");
    assert.ok(printBtn, "print button on each payslip");
    printBtn.dispatchEvent(new page.window.Event("click", { bubbles: true })); // window.open is stubbed
    await sleep(150);

    // No script/console errors across the whole workflow.
    assert.deepEqual(page.errors, [], "no script errors while using the payroll section");
  } finally { page.close(); }
});

test("Western Academy admin gets the same Payroll section (category compatibility)", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"), "Western theme applied");
    assert.ok(page.window.BelloPayroll, "the payroll module is loaded for Western admins too");

    await page.route("payroll/structures");
    const content = page.content();
    assert.match(content.querySelector("h2").textContent, /Salary Structures/);
    assert.ok(content.querySelector("#addStructure"), "Western admin can open the add-structure modal");
    assert.ok(content.querySelector(".dash-table"), "Western admin sees the shared table");

    await page.route("payroll/payslips");
    assert.match(page.content().querySelector("h2").textContent, /Payslips/, "payslips screen renders for Western admin");
    await page.route("payroll/advances");
    assert.match(page.content().querySelector("h2").textContent, /Advances & Loans/);

    assert.deepEqual(page.errors, [], "no script errors in the Western console either");
  } finally { page.close(); }
});
