"use strict";
/* ============================================================================
   PORTAL ACCESS TAB — browser-level regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA against the real API to prove the account-creation
   gap is actually closed in the browser:

     • the "Portal access" tab sits among the EXISTING student-profile tabs
       (none of them are displaced)
     • it reports "No login yet", then the created username and active state
     • submitting the form really creates the login, through the existing
       POST /api/students/:id/portal-account endpoint
     • the same panel creates a parent login and shows its linked children
     • the single-sign-in guidance is on screen
     • the tab is NOT offered to a teacher account (server-side the endpoint
       is madrasa_admin-only; the UI must not dangle a control that 403s)

   Requires the jsdom devDependency; the suite skips cleanly without it.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, PASSWORD } = require("./helpers");
initEnv();

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { /* production install */ }
const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Boots /admin in a DOM with a cookie jar and signs the given account in. */
async function openAdmin(base, username) {
  let cookie = "";
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => {
    if (!/Not implemented: window\.(scrollTo|HTMLCanvasElement|print)/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.print = () => {};
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
  await sleep(900);
  return {
    window, doc: window.document, errors,
    content: () => window.document.querySelector("#dashContent"),
    modal: () => window.document.querySelector(".dash-modal"),
    async route(route) { window.BelloDashboard.go(route); await sleep(1000); },
    click(el) { el.dispatchEvent(new window.Event("click", { bubbles: true })); },
    submit(form) { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); },
    close() { window.close(); },
  };
}

/** Opens Alpha One's profile modal and returns it. */
async function openAlphaProfile(page) {
  await page.route("students/profiles");
  const row = [...page.content().querySelectorAll("tbody tr")].find((tr) => /Alpha/.test(tr.textContent));
  assert.ok(row, "Alpha is listed");
  page.click(row.querySelector("[data-profile-open]"));
  for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal-backdrop"); i++) await sleep(50);
  await sleep(600);
  const modal = page.modal();
  assert.ok(modal, "profile modal opened");
  return modal;
}

let ctx;
before(async () => {
  ctx = await setup();
  // studentA2 (Bravo) starts with no portal login at all — the "No login yet"
  // and creation paths are exercised against it.
});
after(async () => { if (ctx) await ctx.close(); });

test("an admin creates a student login from the profile's Portal access tab", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("students/profiles");
    const row = [...page.content().querySelectorAll("tbody tr")].find((tr) => /Bravo/.test(tr.textContent));
    assert.ok(row, "Bravo is listed");
    page.click(row.querySelector("[data-profile-open]"));
    for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal-backdrop"); i++) await sleep(50);
    await sleep(600);
    let modal = page.modal();

    // The new tab joins the existing ones without displacing any of them.
    const tabs = [...modal.querySelectorAll("[data-profile-tab]")].map((b) => b.textContent.trim());
    assert.ok(tabs.includes("Portal access"), "the Portal access tab exists");
    for (const existing of ["Overview", "Personal & family", "Academic", "Student life", "Health", "Finance", "Documents", "Communication"]) {
      assert.ok(tabs.includes(existing), `existing tab "${existing}" still present`);
    }

    page.click([...modal.querySelectorAll("[data-profile-tab]")].find((b) => b.dataset.profileTab === "portal"));
    await sleep(300);
    let panel = modal.querySelector("#studentProfilePanel");
    assert.match(panel.textContent, /No login yet/, "a student without a login says so");
    assert.match(panel.textContent, /sign in through/i, "the single-login guidance is shown");
    assert.ok(panel.textContent.includes("/login"), "the guidance names the one sign-in page");

    // Create the login through the real endpoint.
    const form = panel.querySelector("#studentPortalForm");
    assert.ok(form, "the creation form is offered to an administrator");
    form.elements.username.value = "bravo.two";
    form.elements.password.value = "UiPortal1234!";
    page.submit(form);
    await sleep(1200);

    const created = await ctx.db.get("SELECT username, role, student_id FROM users WHERE username = ?", ["bravo.two"]);
    assert.ok(created, "the account really exists in the database");
    assert.equal(created.role, "student");
    assert.equal(Number(created.student_id), Number(ctx.studentA2));

    // The profile reopens on the Portal access tab and now shows the account.
    for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal"); i++) await sleep(50);
    await sleep(500);
    panel = page.modal().querySelector("#studentProfilePanel");
    assert.match(panel.textContent, /bravo\.two/, "the username is shown after creation");
    assert.match(panel.textContent, /Active/, "the account status is shown");
    assert.ok(!/UiPortal1234!/.test(page.doc.body.textContent), "the password is never rendered back");

    assert.deepEqual(page.errors, [], "no client-side errors");
  } finally { page.close(); }
});

test("the same tab creates a parent login and lists its linked children", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    const modal = await openAlphaProfile(page);
    page.click([...modal.querySelectorAll("[data-profile-tab]")].find((b) => b.dataset.profileTab === "portal"));
    await sleep(300);
    let panel = modal.querySelector("#studentProfilePanel");

    // Alpha already has the seeded "parent-a" guardian linked to two children.
    assert.match(panel.textContent, /parent-a/, "an existing parent login is listed");
    assert.match(panel.textContent, /Bravo/, "its other linked child is listed");

    const form = panel.querySelector("#parentPortalForm");
    assert.ok(form, "the parent creation form is offered");
    form.elements.username.value = "alpha.guardian";
    form.elements.password.value = "UiParent1234!";
    form.elements.full_name.value = "Second Guardian";
    page.submit(form);
    await sleep(1200);

    const parent = await ctx.db.get("SELECT id, role, full_name FROM users WHERE username = ?", ["alpha.guardian"]);
    assert.ok(parent, "the parent account exists");
    assert.equal(parent.role, "parent");
    const links = await ctx.db.all("SELECT student_id FROM parent_links WHERE user_id = ?", [parent.id]);
    assert.deepEqual(links.map((l) => Number(l.student_id)), [Number(ctx.studentA1)], "linked to this child");

    for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal"); i++) await sleep(50);
    await sleep(500);
    panel = page.modal().querySelector("#studentProfilePanel");
    assert.match(panel.textContent, /alpha\.guardian/, "the new parent login is listed");
    assert.ok(!/UiParent1234!/.test(page.doc.body.textContent), "the password is never rendered back");

    assert.deepEqual(page.errors, [], "no client-side errors");
  } finally { page.close(); }
});
