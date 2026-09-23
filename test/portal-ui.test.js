"use strict";
/* ============================================================================
   PORTAL SHELL — browser-level tests (jsdom)
   ----------------------------------------------------------------------------
   The Teacher / Student / Parent workspaces are real, reloadable addresses
   served by the same SPA shell. These tests drive them the way a browser
   does: real scripts from the server, a fetch that carries a cookie jar.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  /* jsdom devDependency not installed (production install) — UI half skips. */
}
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

const ROOT = path.join(__dirname, "..");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const APP_JS = fs.readFileSync(path.join(ROOT, "public", "js", "app.js"), "utf8");
const SERVER_APP_JS = fs.readFileSync(path.join(ROOT, "server", "app.js"), "utf8");

let ctx;

before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

/* ------------------------------ source contract --------------------------- */

test("the portals are first-class parts of the shipped SPA", () => {
  for (const script of ["portal.js", "portal-teacher.js", "portal-student.js", "portal-parent.js"]) {
    assert.ok(INDEX_HTML.includes(`/js/${script}"`), `index.html loads ${script}`);
  }
  assert.ok(INDEX_HTML.includes('/css/portal.css"'), "index.html loads the portal stylesheet");
  for (const [name, src] of [["app.js", APP_JS], ["server/app.js", SERVER_APP_JS]]) {
    for (const p of ["/teacher", "/student", "/parent"]) {
      assert.ok(src.includes(`"${p}"`), `${name} knows the ${p} address`);
    }
  }
  // The portals reuse the existing dashboard design system rather than a
  // second design language.
  assert.ok(fs.readFileSync(path.join(ROOT, "public", "js", "portal.js"), "utf8").includes("dash-root"),
    "the portal shell uses the shared dash-* design system");
});

test("GET /teacher, /student and /parent serve the SPA shell", async () => {
  const anon = new Client(ctx.base);
  for (const p of ["/teacher", "/student", "/parent", "/parent/meetings"]) {
    const r = await anon.req("GET", p);
    assert.equal(r.status, 200, p);
    const ct = r.res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/html"), `${p} serves HTML`);
  }
});

/* ------------------------------ browser-level ------------------------------ */

async function openPortal(urlPath) {
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
  await waitFor(() => dom.window.document.getElementById("portalLoginForm")
    || dom.window.document.getElementById("portalRoot"));
  return {
    dom, jar, pageErrors,
    doc: dom.window.document,
    form: () => dom.window.document.getElementById("portalLoginForm"),
    shell: () => dom.window.document.getElementById("portalRoot"),
    loginFormFill: async (username, password) => {
      const form = dom.window.document.getElementById("portalLoginForm");
      form.elements.username.value = username;
      form.elements.password.value = password;
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    },
    close() { try { dom.window.close(); } catch (e) { /* ignore */ } },
  };
}

test("an anonymous visitor at /student gets the portal's own sign-in form", { skip: skipUI }, async () => {
  const page = await openPortal("/student");
  assert.ok(page.form(), "the student portal shows its sign-in form");
  assert.ok(!page.shell(), "no workspace without a session");
  assert.equal(page.doc.querySelector(".dash-login-card h1").textContent, "Sign in to your student portal");
  page.close();
});

test("a student signs in and the student workspace mounts", { skip: skipUI }, async () => {
  const page = await openPortal("/student");
  assert.ok(page.form(), "the form is shown first");
  await page.loginFormFill("student-a1", "Passw0rd!123");
  await waitFor(() => page.shell() && page.doc.querySelector(".portal-welcome"));
  assert.ok(page.shell(), "the portal shell mounts after sign-in");
  assert.ok(page.doc.querySelector(".portal-welcome"), "the student dashboard renders");
  assert.match(page.doc.querySelector(".portal-welcome h2").textContent, /Alpha One/i);
  assert.ok(page.doc.querySelector("#portalBell"), "the notification bell is in the header");
  // Child-scoped navigation exists.
  assert.ok([...page.doc.querySelectorAll("#portalNav a")].some((a) => /assignments/i.test(a.textContent)),
    "the assignments page is reachable from the nav");
  page.close();
});

test("a teacher signs in at /teacher and the teacher workspace mounts", { skip: skipUI }, async () => {
  const page = await openPortal("/teacher");
  await page.loginFormFill("teacher-a", "Passw0rd!123");
  await waitFor(() => page.shell() && page.doc.querySelector(".portal-welcome"));
  assert.ok(page.shell(), "the teacher shell mounts");
  assert.match(page.doc.querySelector(".portal-welcome h2").textContent, /Teacher A/i);
  assert.ok(page.doc.querySelector("#portalRoot").getAttribute("data-portal-role") === "teacher",
    "the shell is marked with its role");
  const nav = [...page.doc.querySelectorAll("#portalNav a")].map((a) => a.textContent);
  for (const expected of ["My Classes", "Attendance", "Lesson Plans", "Assignments", "Results", "My Leave"]) {
    assert.ok(nav.some((n) => n.includes(expected)), `the nav includes ${expected}`);
  }
  page.close();
});

test("a parent signs in at /parent and sees every linked child", { skip: skipUI }, async () => {
  const page = await openPortal("/parent");
  await page.loginFormFill("parent-a", "Passw0rd!123");
  await waitFor(() => page.shell() && page.doc.querySelector(".portal-welcome"));
  assert.ok(page.shell(), "the parent shell mounts");
  const names = [...page.doc.querySelectorAll(".dash-card-head h3")].map((h) => h.textContent);
  assert.ok(names.some((n) => /Alpha One/i.test(n)), "child 1 is on the family dashboard");
  assert.ok(names.some((n) => /Bravo Two/i.test(n)), "child 2 is on the family dashboard");
  // The child switcher appears on a child-scoped page.
  page.dom.window.location.hash = "#/parent/attendance";
  await waitFor(() => page.doc.querySelector(".portal-child-switch"));
  assert.ok(page.doc.querySelector(".portal-child-switch"), "the child switcher renders on child pages");
  const chips = [...page.doc.querySelectorAll(".portal-child-chip")];
  assert.equal(chips.length, 2, "both children can be selected");
  page.close();
});

test("a wrong-role account is not let into another portal", { skip: skipUI }, async () => {
  const page = await openPortal("/teacher");
  await page.loginFormFill("student-a1", "Passw0rd!123");
  await waitFor(() => page.doc.querySelector(".dash-login-error"));
  assert.ok(!page.shell(), "a student never mounts the teacher workspace");
  const err = page.doc.querySelector(".dash-login-error");
  assert.ok(err, "the refusal is explained on the form");
  page.close();
});
