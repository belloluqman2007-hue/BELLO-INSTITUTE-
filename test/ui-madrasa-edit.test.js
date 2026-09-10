"use strict";
/* ============================================================================
   UI REGRESSION — Platform → Madaris → Edit (super admin)
   ----------------------------------------------------------------------------
   Reported bug: opening a madrasa the admin had registered — the page every
   "Edit" link points at (#/platform/madaris/:id) — showed a toast reading
   "Cannot read properties of undefined (reading 'id')" and rendered nothing.

   Cause: the super-admin route wrapper SA() re-invoked the handler with NO
   arguments, so `params` was undefined inside the route handler that reads
   params.id. This test drives the REAL public/js/app.js in a DOM (jsdom)
   against the real server, so a wrapper that drops router arguments fails
   here again immediately.

   Requires the jsdom devDependency; the suite skips cleanly without it.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, SA_PASSWORD, PASSWORD } = require("./helpers");
initEnv();

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  /* jsdom not installed (production install) — this file skips. */
}

const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boots the shipped SPA against `base` in a DOM and returns helpers.
 * fetch is replaced with a cookie-aware implementation (jsdom has none), so
 * the page talks to the test server with a real session, exactly like a
 * browser would.
 */
async function openApp(base) {
  const pageErrors = [];
  let cookie = "";
  const vc = new VirtualConsole(); // swallow the page's own console noise
  vc.on("jsdomError", (e) => {
    const msg = String((e.detail && e.detail.message) || e.message || e);
    if (!/Not implemented/i.test(msg)) pageErrors.push("jsdomError: " + msg);
  });
  vc.on("error", (...a) => pageErrors.push("console.error: " + a.map(String).join(" ")));

  const patchedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input;
    const headers = new Headers(init.headers || {});
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const jar = {};
      for (const p of cookie.split(";")) { const i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1); }
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    }
    return res;
  };

  const dom = await JSDOM.fromURL(base + "/", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = patchedFetch;
      window.addEventListener("error", (e) => pageErrors.push(e.error ? String(e.error.stack || e.error.message) : String(e.message)));
      window.addEventListener("unhandledrejection", (e) => pageErrors.push("unhandledrejection: " + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
    },
  });
  const { window } = dom;

  // Wait for the SPA to finish booting (its own scripts + first route).
  for (let i = 0; i < 100 && !(window.App && window.API); i++) await sleep(50);
  assert.ok(window.App && window.API, "the SPA booted");
  await sleep(300);

  const click = (el) => {
    assert.ok(el, "element to click exists");
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };

  return {
    window,
    pageErrors,
    click,
    doc: window.document,
    $: (sel) => window.document.querySelector(sel),
    async login(username, password) {
      const r = await window.API.login(username, password);
      await window.App.refreshMe();
      return r;
    },
    async go(path, settle = 700) {
      await window.App.routeTo(path);
      await sleep(settle);
    },
    close() { try { window.close(); } catch (e) { /* ignore */ } },
  };
}

let ctx;
let sa;
after(async () => { if (sa) sa.close(); if (ctx) await ctx.close(); });

before(async () => {
  ctx = await setup();
  if (!JSDOM) return;
  sa = await openApp(ctx.base);
  await sa.login("testadmin", SA_PASSWORD);
  assert.equal(sa.window.App.me.role, "super_admin");
});

test("platform madrasa page renders the registered madrasa (no undefined params)", { skip }, async () => {
  await sa.go("platform/madaris/" + ctx.madrasaA);

  const heading = sa.$("#view h1");
  assert.ok(heading, "the page rendered a heading instead of staying blank");
  assert.equal(heading.textContent.trim(), "Test Madrasa A");
  assert.ok(sa.$("#editBtn"), "the Edit button is present");
  assert.ok(sa.$("#adminBtn"), "the admin-account button is present");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("Edit opens the form pre-filled and saving updates the madrasa", { skip }, async () => {
  sa.click(sa.$("#editBtn"));
  await sleep(1200); // the form loads the plan list on demand

  const slug = sa.$("#fSlug");
  const nameEn = sa.$("#fNameEn");
  assert.ok(slug && nameEn, "the edit modal opened");
  assert.equal(slug.value, "testa", "the form is pre-filled from the madrasa being edited");
  assert.equal(nameEn.value, "Test Madrasa A");
  assert.ok(sa.$("#fPlan").options.length > 0, "the plan dropdown is populated");

  nameEn.value = "Test Madrasa A (renamed)";
  sa.$("#fCity").value = "Ijebu-Ode";
  sa.click(sa.$("#fSave"));
  await sleep(1200);

  const row = await ctx.db.get("SELECT name_en, city FROM madaris WHERE id = ?", [ctx.madrasaA]);
  assert.equal(row.name_en, "Test Madrasa A (renamed)", "the edit was saved");
  assert.equal(row.city, "Ijebu-Ode");
  assert.ok(!sa.$(".modal-backdrop"), "the modal closed after saving");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("the madrasa list links to each madrasa's edit page", { skip }, async () => {
  await sa.go("platform/madaris");
  const link = sa.$(`#madRows a[href="#/platform/madaris/${ctx.madrasaB}"]`);
  assert.ok(link, "the list links to the madrasa detail page");
  await sa.go("platform/madaris/" + ctx.madrasaB);
  assert.equal(sa.$("#view h1").textContent.trim(), "Test Madrasa B");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("a madrasa admin is still refused the platform page", { skip }, async () => {
  const other = await openApp(ctx.base);
  try {
    await other.login("admin-a", PASSWORD);
    await other.go("platform/madaris/" + ctx.madrasaA);
    assert.match(other.$("#view").textContent, /403/, "the super-admin guard still blocks other roles");
    assert.deepEqual(other.pageErrors, []);
  } finally { other.close(); }
});
