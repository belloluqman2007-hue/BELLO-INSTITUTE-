"use strict";
/* ============================================================================
   UI REGRESSION — the shipped public SPA (public/js/app.js) in a DOM (jsdom)
   ----------------------------------------------------------------------------
   The super-admin "Platform → Madaris → Edit" screens this file used to drive
   were removed when the public site was reset to the bilingual marketing
   experience (see public/js/public.js). Those routes must now fall back to
   the homepage instead of throwing, and the real SPA must keep rendering its
   bilingual (English + العربية) pages with the royal-purple identity.

   Requires the jsdom devDependency; the suite skips cleanly without it.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, SA_PASSWORD } = require("./helpers");
initEnv();

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  /* jsdom devDependency not installed (production install) — this file skips. */
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
      for (const p of cookie.split(";")) { const i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = jar[p.slice(0, i).trim()] || p.slice(i + 1); }
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

  return {
    window,
    pageErrors,
    doc: window.document,
    $: (sel) => window.document.querySelector(sel),
    $$: (sel) => Array.from(window.document.querySelectorAll(sel)),
    themeColor: () => {
      const meta = window.document.querySelector('meta[name="theme-color"]');
      return meta ? meta.content : null;
    },
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

test("the homepage renders bilingual copy (English + العربية) with no client errors", { skip }, async () => {
  await sa.go("");

  const heading = sa.$("#hero-title");
  assert.ok(heading, "the hero rendered instead of staying blank");
  assert.match(heading.textContent, /BELLO/, "the hero welcomes visitors to BELLO");

  const heroArabic = sa.$(".hero-arabic");
  assert.ok(heroArabic, "the Arabic welcome line is present");
  assert.equal(heroArabic.getAttribute("lang"), "ar");
  assert.equal(heroArabic.getAttribute("dir"), "rtl");
  assert.match(heroArabic.textContent, /منصة/, "the welcome line is real Arabic copy");

  const choiceArabic = sa.$$(".choice-ar");
  assert.equal(choiceArabic.length, 2, "both school-choice cards carry an Arabic subtitle");
  assert.match(choiceArabic[0].textContent, /إسلامية/, "the Islamic card is labelled in Arabic");

  assert.ok(sa.$(".footer-ar"), "the footer carries the Arabic mission line");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("the Islamic Schools page renders its Arabic identity and the royal-purple theme", { skip }, async () => {
  await sa.go("islamic-schools");

  const title = sa.$("#category-title");
  assert.ok(title, "the category page rendered");
  assert.equal(title.textContent.trim(), "Islamic education, ready to discover.");

  const titleAr = sa.$(".category-title-ar");
  assert.ok(titleAr, "the page heading is mirrored in Arabic");
  assert.match(titleAr.textContent, /إسلامي/, "the Arabic title is real Arabic copy");

  assert.ok(sa.$(".category-quote-ar"), "the Arabic knowledge quote is displayed");
  assert.equal(sa.$$(".type-ar").length, 4, "every institution-type card is labelled in Arabic");
  assert.equal(sa.themeColor(), "#31075e", "the Islamic experience uses the deep royal-purple brand colour");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("removed platform routes fall back to the homepage instead of throwing", { skip }, async () => {
  // The old super-admin "Platform → Madaris" screens are gone from the public
  // SPA; their URLs must render the homepage, never a blank page or a toast.
  await sa.go("platform/madaris/" + ctx.madrasaA);

  assert.ok(sa.$("#hero-title"), "the homepage rendered for the removed route");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});

test("the Western Academies page keeps its own navy identity", { skip }, async () => {
  await sa.go("western-schools");
  assert.ok(sa.$("#western-top"), "the western experience rendered");
  assert.notEqual(sa.themeColor(), "#31075e", "the western experience does not use the Islamic purple");
  assert.deepEqual(sa.pageErrors, [], "no client-side error was raised: " + sa.pageErrors.join(" | "));
});
