"use strict";
/* ============================================================================
   UNIFIED LOGIN — browser-level tests (jsdom)
   ----------------------------------------------------------------------------
   One sign-in page for every account type. The browser must never ask for a
   role: the credentials are submitted, the SERVER answers with the role, and
   the page hands the session to the right workspace. These tests drive the
   real SPA against the real API, the way the portal-ui suite does.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) { /* production install without the dev dependency */ }
const skipUI = !JSDOM ? "jsdom devDependency not installed" : false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 12000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { /* keep polling */ }
    await sleep(stepMs);
  }
  return false;
}

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

/** Boots the SPA at a real address with a cookie jar, like a browser. */
async function openPage(urlPath) {
  const jar = { value: "" };
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String((e.detail && e.detail.message) || e.message || e);
    if (!/Not implemented/i.test(msg)) pageErrors.push("jsdomError: " + msg);
  });
  const res = await fetch(ctx.base + urlPath, { headers: jar.value ? { cookie: jar.value } : {} });
  const html = await res.text();
  const dom = new JSDOM(html, {
    url: ctx.base + urlPath,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.addEventListener("error", (e) => pageErrors.push(String(e.message)));
      window.fetch = async (input, init = {}) => {
        const abs = new URL(String(input), ctx.base).href;
        const headers = Object.assign({}, init.headers || {}, jar.value ? { cookie: jar.value } : {});
        const r = await fetch(abs, Object.assign({}, init, { headers }));
        const setCookie = r.headers.get("set-cookie");
        if (setCookie) jar.value = setCookie.split(";")[0];
        return r;
      };
    },
  });
  return {
    dom, jar, pageErrors,
    doc: dom.window.document,
    close() { try { dom.window.close(); } catch (e) { /* ignore */ } },
  };
}

test("the unified sign-in card has every required control and no role chooser", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dashLoginForm")), "the sign-in form renders");
  const form = page.doc.getElementById("dashLoginForm");
  assert.ok(form.elements.username, "username/email field");
  assert.ok(form.elements.password, "password field");
  assert.equal(form.elements.password.type, "password", "password is masked by default");
  assert.ok(page.doc.getElementById("dlPassToggle"), "show/hide password toggle");
  assert.ok(page.doc.getElementById("dlRemember"), "remember me checkbox");
  assert.ok(page.doc.getElementById("dlForgot"), "forgot password link");
  assert.equal(page.doc.getElementById("dlForgot").getAttribute("href"), "/forgot-password");
  // No role selection anywhere on the card.
  const html = page.doc.querySelector(".dash-login-card").innerHTML;
  for (const bad of ["role", "Super Admin", "select your"] ) {
    if (bad === "role") assert.ok(!/<select[^>]*name=["']role/i.test(html), "no role select input");
    else assert.ok(!new RegExp(bad, "i").test(html), `no "${bad}" chooser on the card`);
  }
  assert.match(page.doc.querySelector(".dash-login-card h1").textContent, /sign in to edusphere/i);
  assert.match(page.doc.querySelector(".dash-login-card .brand-row img").getAttribute("src"), /edusphere-logo\.png$/, "the unified sign-in card carries the official EduSphere logo");
  // The card addresses every account type equally.
  assert.match(page.doc.querySelector(".dash-login-card .sub").textContent, /administrator|teacher|student|parent/i);
  page.close();
});

test("show/hide password toggles the field and its accessibility state", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dlPassToggle")));
  const input = page.doc.getElementById("dlPass");
  const toggle = page.doc.getElementById("dlPassToggle");
  toggle.click();
  assert.equal(input.type, "text");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  toggle.click();
  assert.equal(input.type, "password");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  page.close();
});

// jsdom cannot follow location.replace across pages, so the hand-off is
// asserted exactly the way the existing admin-login suite does: the
// interstitial names the right workspace, the admin console never mounts,
// and the live session carries the correct server-determined role.
test("a teacher signing in on the unified page is handed to the teacher workspace", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dashLoginForm")));
  const form = page.doc.getElementById("dashLoginForm");
  form.elements.username.value = "teacher-a";
  form.elements.password.value = PASSWORD;
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.querySelector('.dash-login-card a[href="/teacher"]')),
    "the hand-off interstitial links to the teacher portal");
  assert.ok(!page.doc.querySelector(".dash-root"), "a teacher never gets the admin console shell");
  const me = await (async () => { const r = await fetch(ctx.base + "/api/auth/me", { headers: { cookie: page.jar.value } }); return r.json(); })();
  assert.equal(me.loggedIn, true, "the session stays open for the portal");
  assert.equal(me.role, "teacher", "the SERVER determined the role — no client input");
  page.close();
});

test("a student signing in on the unified page is handed to the student workspace", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dashLoginForm")));
  const form = page.doc.getElementById("dashLoginForm");
  form.elements.username.value = "student-a1";
  form.elements.password.value = PASSWORD;
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.querySelector('.dash-login-card a[href="/student"]')),
    "the hand-off interstitial links to the student portal");
  assert.ok(!page.doc.querySelector(".dash-root"), "a student never gets the admin console shell");
  const me = await (async () => { const r = await fetch(ctx.base + "/api/auth/me", { headers: { cookie: page.jar.value } }); return r.json(); })();
  assert.equal(me.role, "student");
  page.close();
});

test("an administrator signing in lands on the admin dashboard", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dashLoginForm")));
  const form = page.doc.getElementById("dashLoginForm");
  form.elements.username.value = "admin-a";
  form.elements.password.value = PASSWORD;
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.querySelector(".dash-root")), "the admin console mounts");
  // Let the console's initial burst of async work settle before the jsdom
  // window is torn down (tearing down mid-flight produces jsdom-internal
  // noise that node:test reports as an unhandled rejection).
  await sleep(700);
  page.close();
});

test("wrong credentials show an error, keep the username and stay on the form", { skip: skipUI }, async () => {
  const page = await openPage("/login");
  assert.ok(await waitFor(() => page.doc.getElementById("dashLoginForm")));
  const form = page.doc.getElementById("dashLoginForm");
  form.elements.username.value = "teacher-a";
  form.elements.password.value = "NotThePassword";
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.querySelector(".dash-login-error")));
  assert.match(page.doc.querySelector(".dash-login-error").textContent, /invalid username or password/i);
  assert.equal(page.doc.getElementById("dashLoginForm").elements.username.value, "teacher-a",
    "the typed username survives the retry");
  page.close();
});

test("the forgot-password page submits and answers generically", { skip: skipUI }, async () => {
  const page = await openPage("/forgot-password");
  assert.ok(await waitFor(() => page.doc.getElementById("fpForm")), "the request form renders");
  const form = page.doc.getElementById("fpForm");
  form.elements.identifier.value = "teacher-a";
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.querySelector(".dash-login-success")), "the confirmation appears");
  assert.match(page.doc.querySelector(".dash-login-success").textContent, /if that account exists/i,
    "the answer never confirms the account exists");
  page.close();
});

test("the reset-password page without a token explains itself; with a token it shows the form", { skip: skipUI }, async () => {
  const page = await openPage("/reset-password");
  assert.ok(await waitFor(() => page.doc.querySelector(".dash-login-card")), "the card renders");
  assert.match(page.doc.body.textContent, /reset link required/i);

  // Issue a real token through the API and open its link.
  const c = new Client(ctx.base);
  await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const list = await admin.req("GET", "/api/auth/reset-requests");
  const request = list.data.requests.find((x) => x.username === "teacher-a" && x.resetLink);
  assert.ok(request, "the admin can see the pending link");
  const page2 = await openPage(request.resetLink);
  assert.ok(await waitFor(() => page2.doc.getElementById("rpForm")), "the new-password form renders");
  page.close(); page2.close();
});

test("the student portal advertises online examinations in its navigation", { skip: skipUI }, async () => {
  const page = await openPage("/student");
  assert.ok(await waitFor(() => page.doc.getElementById("portalLoginForm")));
  const form = page.doc.getElementById("portalLoginForm");
  assert.ok(page.doc.getElementById("plPassToggle"), "the portal sign-in also has the show/hide toggle");
  assert.ok(page.doc.getElementById("plRemember"), "…and remember me");
  form.elements.username.value = "student-a1";
  form.elements.password.value = PASSWORD;
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.getElementById("portalRoot")));
  await waitFor(() => page.doc.querySelectorAll("#portalNav a").length > 0);
  assert.ok([...page.doc.querySelectorAll("#portalNav a")].some((a) => /online exams/i.test(a.textContent)),
    "the online exams page is reachable from the nav");
  page.close();
});

test("the parent portal offers online fee payment", { skip: skipUI }, async () => {
  const page = await openPage("/parent");
  assert.ok(await waitFor(() => page.doc.getElementById("portalLoginForm")));
  const form = page.doc.getElementById("portalLoginForm");
  form.elements.username.value = "parent-a";
  form.elements.password.value = PASSWORD;
  form.dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await waitFor(() => page.doc.getElementById("portalRoot")));
  await waitFor(() => page.doc.querySelectorAll("#portalNav a").length > 0);
  const feesLink = [...page.doc.querySelectorAll("#portalNav a")].find((a) => /fees/i.test(a.textContent));
  assert.ok(feesLink, "the fees page is in the nav");
  feesLink.click();
  assert.ok(await waitFor(() => page.doc.getElementById("payOnlineBtn")), "the Pay online button renders on the fees page");
  page.close();
});
