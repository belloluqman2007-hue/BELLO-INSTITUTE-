"use strict";
/* ============================================================================
   EXPENSES & BUDGET — Browser-level UI Regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA against the real API:
     • Sidebar navigation exposes Finance -> Expenses sub-group with 5 items
     • Expense Categories: renders tree, adds category through modal
     • Record Expense: renders multi-field form, submits draft expense
     • Expense List: renders status badges, executes approve action
     • Budget vs Actual: renders budget progress bars and variance
     • Expense Reports: renders breakdown cards and CSV link
     • Dashboard KPI row: displays Total Fees Collected and Total Expenses
     • Both Islamic and Western school categories share the same module
     • No console or script errors
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
    close() { window.close(); },
  };
}

let ctx;
before(async () => {
  ctx = await setup();
  const bcrypt = require("bcryptjs");
  ctx.users.teacherB = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, "teacher-b", bcrypt.hashSync(PASSWORD, 10), "teacher", "Teacher B"]
  )).lastInsertRowid;
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
});

after(async () => {
  if (ctx) await ctx.close();
});

test("Islamic admin: Finance sidebar exposes Expenses sub-group and all 5 screens render and operate", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloExpenses, "the expenses module is loaded");
    assert.ok(page.doc.body.classList.contains("dash-islamic"), "Islamic theme applied");

    // 1. Check Dashboard KPI cards show Income vs Expenditure
    const dashContent = page.content();
    assert.match(dashContent.textContent, /Total Fees Collected/, "Dashboard KPI includes Total Fees Collected");
    assert.match(dashContent.textContent, /Total Expenses/, "Dashboard KPI includes Total Expenses");

    // 2. Sidebar exposes Finance group with Expenses sub-group
    const financeBtn = [...page.doc.querySelectorAll(".dash-nav-link")].find((b) => b.textContent.includes("Finance"));
    assert.ok(financeBtn, "Finance group present in the sidebar");
    financeBtn.dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(200);

    const navText = page.doc.querySelector("#dashNav").textContent;
    assert.match(navText, /Expenses/, "Expenses subgroup header present in sidebar");
    assert.match(navText, /Expense Categories/);
    assert.match(navText, /Record Expense/);
    assert.match(navText, /Expense List/);
    assert.match(navText, /Budget vs Actual/);
    assert.match(navText, /Expense Reports/);

    // 3. Expense Categories: add category through modal
    await page.route("finance/expenses/categories");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Expense Categories/);
    assert.ok(content.querySelector("#openAddCategoryBtn"), "Add Category button present");

    content.querySelector("#openAddCategoryBtn").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(300);
    const catForm = page.doc.querySelector("#categoryForm");
    assert.ok(catForm, "Category modal opened");
    catForm.elements.name.value = "Office Supplies & Paper";
    catForm.elements.type.value = "operating";
    catForm.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1200);
    content = page.content();
    assert.match(content.textContent, /Office Supplies & Paper/, "Created category appears in tree table");

    // 4. Record Expense: form fields and draft submission
    await page.route("finance/expenses/record");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Record School Expense/);
    const expForm = content.querySelector("#recordExpenseForm");
    assert.ok(expForm, "Expense record form present");

    // Select category and fill amount
    const catSelect = expForm.elements.category_id;
    assert.ok(catSelect.options.length > 1, "Category options available");
    catSelect.selectedIndex = 1;
    expForm.elements.amount_ngn.value = "35000";
    expForm.elements.vendor.value = "Paper Palace Ltd";
    expForm.elements.description.value = "Printing reams and ink cartridges";
    expForm.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1500);

    // Redirects to Expense List
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Expense Management/);
    assert.match(content.textContent, /Paper Palace Ltd/, "Recorded expense appears in table");
    assert.match(content.textContent, /Draft/, "New expense has Draft status pill");

    // 5. Approve draft expense
    const approveBtn = content.querySelector(".approve-expense-btn");
    assert.ok(approveBtn, "Approve action button present on draft expense");
    approveBtn.dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(1500);
    content = page.content();
    assert.match(content.textContent, /Approved/, "Status updated to Approved");

    // 6. Budget vs Actual
    await page.route("finance/expenses/budget");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Budget vs\. Actual/);
    assert.ok(content.querySelector("#openSetBudgetBtn"), "Set Budget button present");
    assert.ok(content.querySelector(".dash-table"), "Budget breakdown table present");

    // 7. Expense Reports
    await page.route("finance/expenses/reports");
    content = page.content();
    assert.match(content.querySelector("h2").textContent, /Expense Reports/);
    assert.ok(content.querySelector("#exportReportCsvBtn"), "CSV export link present");
    assert.match(content.textContent, /Spending by Category/);
    assert.match(content.textContent, /Monthly Expenditure/);
    assert.match(content.textContent, /Top Vendors/);

    assert.deepEqual(page.errors, [], "no script errors in Islamic admin workspace");
  } finally {
    page.close();
  }
});

test("Western Academy admin: Expenses module operates identically with Western identity", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"), "Western theme applied");
    assert.ok(page.window.BelloExpenses, "the expenses module is available to Western academies");

    // Check Expense List
    await page.route("finance/expenses");
    const content = page.content();
    assert.match(content.querySelector("h2").textContent, /Expense Management/);
    assert.ok(content.querySelector("#recordNewExpenseBtn"), "Record Expense button present");

    // Check Categories
    await page.route("finance/expenses/categories");
    assert.match(page.content().querySelector("h2").textContent, /Expense Categories/);

    // Check Budget
    await page.route("finance/expenses/budget");
    assert.match(page.content().querySelector("h2").textContent, /Budget vs\. Actual/);

    // Check Reports
    await page.route("finance/expenses/reports");
    assert.match(page.content().querySelector("h2").textContent, /Expense Reports/);

    assert.deepEqual(page.errors, [], "no script errors in Western academy admin workspace");
  } finally {
    page.close();
  }
});
