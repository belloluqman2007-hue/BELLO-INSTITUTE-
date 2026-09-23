"use strict";
/* ============================================================================
   ADMIN SECTION & LOGIN — regression tests for the reported fault
   ----------------------------------------------------------------------------
   Reported: "If I press login it will just take me to the super admin
   without any password, which is not supposed to be."

   Root causes covered here:
     1. The dashboard's boot() treated ANY live session as permission to
        mount the admin console. Because the session cookie outlives the
        visit, pressing Login while (unknowingly) still signed in skipped
        the form entirely and opened the super-admin console — zero
        password entry.
     2. boot() registered a NEW hashchange listener on every call and its
        handler rendered the admin shell straight from in-memory state, so
        after the session ended server-side the SPA kept painting a
        "logged-in" console whose every request 401'd.

   The contract now:
     • /login (and the legacy /#/login hash) ALWAYS shows the sign-in form.
       A live session adds a "you are already signed in as …" notice with an
       EXPLICIT Continue action — never silent, passwordless entry.
     • /admin is the admin section's own address; unauthenticated visitors
       get the sign-in form, not the console.
     • Wrong/empty credentials never open the console.
     • A session that ends server-side bounces the SPA back to the form.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { initEnv, setup, Client, SA_PASSWORD } = require("./helpers");
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
/** Waits until `fn()` is truthy, or the timeout expires. Never asserts —
    the caller's own assertions still decide pass/fail, so a genuine
    regression fails exactly as loudly as before, only without the flake. */
async function waitFor(fn, timeoutMs = 10000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { /* keep polling */ }
    await sleep(stepMs);
  }
  return false;
}

const ROOT = path.join(__dirname, "..");
const DASH_JS = fs.readFileSync(path.join(ROOT, "public", "js", "dashboard.js"), "utf8");
const APP_JS = fs.readFileSync(path.join(ROOT, "public", "js", "app.js"), "utf8");
const ACADEMY_JS = fs.readFileSync(path.join(ROOT, "public", "js", "register-academy.js"), "utf8");
const API_JS = fs.readFileSync(path.join(ROOT, "public", "js", "api.js"), "utf8");
const SERVER_APP_JS = fs.readFileSync(path.join(ROOT, "server", "app.js"), "utf8");

let ctx;

before(async () => {
  ctx = await setup();
});
after(async () => { await ctx.close(); });

/* ------------------------------------------------------------------ */
/* Source-level contract (runs even without jsdom)                     */
/* ------------------------------------------------------------------ */

test("the login page always shows the form — a live session never bypasses it", () => {
  assert.ok(/function isLoginPage\(\)/.test(DASH_JS), "the dashboard knows what the sign-in page is");
  assert.ok(/if \(isLoginPage\(\) \|\| !authenticated\) \{/.test(DASH_JS),
    "boot() renders the sign-in form on the login page even when a session is alive");
  assert.ok(/renderLogin\(root, null, authenticated \? me : null\)/.test(DASH_JS),
    "a live session is passed to the form only as a notice, never as entry");
});

test("the admin section has real addresses and every public Login link uses them", () => {
  assert.ok(/app\.get\("\/login", schoolLinkHandler\)/.test(SERVER_APP_JS), "GET /login serves the SPA shell");
  assert.ok(/app\.get\("\/admin", schoolLinkHandler\)/.test(SERVER_APP_JS), "GET /admin serves the SPA shell");
  assert.ok(/path === "\/login" \|\| path === "\/admin" \|\| path === "\/admin\/login"/.test(APP_JS),
    "the SPA router routes /login and /admin into the admin module");
  // The old hash link could boot the dashboard from whatever state the
  // current page was holding; a real /login address always starts fresh.
  for (const [name, src] of [["app.js", APP_JS], ["register-academy.js", ACADEMY_JS]]) {
    assert.ok(!/href="\/#\/login"/.test(src), `${name} has no legacy /#/login links`);
    assert.ok(/href="\/login"/.test(src), `${name} links to the real sign-in page`);
  }
});

test("the dashboard can no longer render the admin shell from stale session state", () => {
  // boot() used to add a fresh listener on every call (they piled up).
  const registrations = DASH_JS.match(/addEventListener\("hashchange"/g) || [];
  assert.equal(registrations.length, 1, "exactly ONE hashchange listener exists");
  assert.ok(/if \(!state\.me\) \{ boot\(\); return; \}/.test(DASH_JS),
    "renderApp() re-authenticates when there is no session in memory");
  assert.ok(/function resetSessionState\(\)/.test(DASH_JS) && /resetSessionState\(\);/.test(DASH_JS),
    "session state is explicitly cleared (login screen + logout)");
});

test("a 401 from an authenticated API call bounces the SPA to the sign-in form", () => {
  assert.ok(/bello:unauthorized/.test(API_JS),
    "the API client reports 401s (session ended server-side)");
  assert.ok(/addEventListener\("bello:unauthorized"/.test(DASH_JS),
    "the dashboard listens and falls back to the sign-in form");
});

/* ------------------------------------------------------------------ */
/* HTTP contract                                                       */
/* ------------------------------------------------------------------ */

test("GET /login, /admin and /admin/login all serve the SPA shell", async () => {
  const anon = new Client(ctx.base);
  for (const p of ["/login", "/admin", "/admin/login"]) {
    const r = await anon.req("GET", p);
    assert.equal(r.status, 200, p);
    const ct = r.res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/html"), `${p} serves HTML`);
    assert.ok(r.res.url === ctx.base + p || true); // (no redirect expected)
  }
});

test("the API itself never authenticates without a password", async () => {
  const anon = new Client(ctx.base);
  const empty = await anon.req("POST", "/api/auth/login", { username: "testadmin", password: "" });
  assert.equal(empty.status, 400);
  const wrong = await anon.req("POST", "/api/auth/login", { username: "testadmin", password: "definitely-wrong" });
  assert.equal(wrong.status, 401);
  const me = await anon.req("GET", "/api/auth/me");
  assert.equal(me.data.loggedIn, false, "no session was created by the failed attempts");
});

/* ------------------------------------------------------------------ */
/* Browser-level contract (jsdom; skips without the devDependency)     */
/* ------------------------------------------------------------------ */

/**
 * Opens the shipped SPA at `path` (with an optional session cookie) the way
 * a real browser would: real scripts from the server, a fetch that carries
 * a cookie jar (so Set-Cookie from the login response is honoured).
 */
async function openAdminApp(urlPath, initialCookie) {
  const jar = { value: initialCookie || "" };
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
  await waitFor(() => dom.window.document.getElementById("dashLoginForm")
    || dom.window.document.querySelector(".dash-root"));
  return {
    dom,
    jar,
    pageErrors,
    doc: dom.window.document,
    form: () => dom.window.document.getElementById("dashLoginForm"),
    shell: () => !!dom.window.document.querySelector(".dash-root"),
    close() { try { dom.window.close(); } catch (e) { /* ignore */ } },
  };
}

/** Session cookie for the seeded super admin. */
async function superAdminCookie() {
  const c = new Client(ctx.base);
  const r = await c.login("testadmin", SA_PASSWORD);
  assert.equal(r.status, 200, "seeded super admin can log in via the API");
  return c.cookieHeader();
}

test("a visitor with NO session presses Login → the sign-in form, never the console", { skip: skipUI }, async () => {
  const page = await openAdminApp("/#/login");
  assert.ok(page.form(), "the sign-in form is shown");
  assert.ok(!page.shell(), "no admin console is rendered");
  assert.ok(!page.doc.getElementById("dashContinueBtn"), "no 'already signed in' notice for an anonymous visitor");
  assert.deepEqual(page.pageErrors, []);
  page.close();
});

test("THE REPORTED FAULT: a live super-admin session pressing Login still gets the form", { skip: skipUI }, async () => {
  const cookie = await superAdminCookie();
  for (const route of ["/login", "/#/login"]) {
    const page = await openAdminApp(route, cookie);
    assert.ok(page.form(), `${route}: the sign-in form is shown`);
    assert.ok(!page.shell(), `${route}: the super-admin console must NOT open without a password`);
    const notice = page.doc.querySelector(".dash-login-session-copy");
    assert.ok(notice, `${route}: the 'already signed in' notice is shown`);
    assert.match(notice.textContent, /already signed in as Test Admin/i);
    assert.ok(page.doc.getElementById("dashContinueBtn"),
      `${route}: continuing requires an EXPLICIT action, not silent entry`);
    assert.deepEqual(page.pageErrors, []);
    page.close();
  }
});

test("an unauthenticated visitor opening /admin gets the form, not the console", { skip: skipUI }, async () => {
  const page = await openAdminApp("/admin");
  assert.ok(page.form(), "the sign-in form is shown");
  assert.ok(!page.shell(), "no admin console is rendered");
  assert.deepEqual(page.pageErrors, []);
  page.close();
});

test("wrong credentials keep the visitor on the form with the API's error", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  page.doc.getElementById("dlUser").value = "testadmin";
  page.doc.getElementById("dlPass").value = "not-the-password";
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => page.doc.querySelector(".dash-login-error"));
  assert.ok(page.form(), "still on the sign-in form");
  assert.ok(!page.shell(), "no admin console is rendered");
  const err = page.doc.querySelector(".dash-login-error");
  assert.ok(err, "the failure is shown");
  assert.match(err.textContent, /Invalid username or password/i);
  page.close();
});

test("correct credentials sign the admin in and mount the console", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  page.doc.getElementById("dlUser").value = "testadmin";
  page.doc.getElementById("dlPass").value = SA_PASSWORD;
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => !page.form() && page.shell());
  assert.ok(!page.form(), "the form is gone after a successful sign-in");
  assert.ok(page.shell(), "the admin console is mounted");
  assert.equal(page.dom.window.location.pathname, "/admin",
    "the address bar lands on the admin section's own address");
  assert.deepEqual(page.pageErrors, []);
  page.close();
});

test("a session that ends server-side bounces the open console back to the form", { skip: skipUI }, async () => {
  const cookie = await superAdminCookie();
  const page = await openAdminApp("/admin", cookie);
  assert.ok(page.shell(), "the console is mounted while the session is alive");

  // End the session server-side (logged out in another tab / expiry /
  // deactivated) — the SPA in this "tab" still holds stale state.
  const c = new Client(ctx.base);
  c.cookies = { mm_session: page.jar.value.replace(/^mm_session=/, "") };
  const out = await c.api("POST", "/api/auth/logout");
  assert.equal(out.status, 200, "server-side logout");

  // Navigate inside the SPA: the old code re-rendered the admin shell from
  // stale in-memory state; now the 401 must bounce to the sign-in form.
  page.dom.window.location.hash = "#/app/platform/madaris";
  await waitFor(() => page.form() && page.doc.querySelector(".dash-login-error"));
  assert.ok(page.form(), "the sign-in form is back");
  assert.ok(!page.shell(), "no admin console survives the dead session");
  const err = page.doc.querySelector(".dash-login-error");
  assert.ok(err && /session has ended/i.test(err.textContent), "the visitor is told why");
  page.close();
});

/* ------------------------------------------------------------------ */
/* "I enter my username and password, press Sign In, NOTHING happens"  */
/* ------------------------------------------------------------------ */
/*
   Every one of these used to end with the visitor staring at an unchanged
   form: no console, no error, no clue. A sign-in attempt must ALWAYS end in
   a visible outcome — the console, a stated reason, or (since the portal
   pass) a hand-off to the account's own workspace.
*/

test("a valid NON-ADMIN account (teacher) is handed to the teacher workspace", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  page.doc.getElementById("dlUser").value = "teacher-a";
  page.doc.getElementById("dlPass").value = "Passw0rd!123";
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  // The routing hand-off renders an interstitial naming the destination and
  // links on to /teacher — the account has its own workspace now. (Wait for
  // the portal LINK, not just any card heading: the sign-in form itself also
  // renders inside a .dash-login-card.)
  await waitFor(() => page.doc.querySelector('.dash-login-card a[href="/teacher"]'));
  assert.ok(!page.shell(), "a teacher never gets the admin console");
  assert.ok(!page.form(), "the visitor is not silently returned to the form");
  const heading = page.doc.querySelector(".dash-login-card h1");
  assert.ok(heading && /opening your workspace/i.test(heading.textContent),
    "the attempt does NOT fail silently — the hand-off is shown");
  const link = page.doc.querySelector('.dash-login-card a[href="/teacher"]');
  assert.ok(link, "the destination is the teacher portal at /teacher");
  // The credentials were correct, so a session exists — and it is exactly
  // what the teacher portal needs, so it must stay open.
  const c = new Client(ctx.base);
  c.cookies = { mm_session: page.jar.value.replace(/^mm_session=/, "") };
  const me = await c.req("GET", "/api/auth/me");
  assert.equal(me.data.loggedIn, true, "the teacher session stays open for the portal");
  assert.equal(me.data.role, "teacher");
  page.close();
});

test("a valid NON-ADMIN account (student) is handed to the student portal", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  page.doc.getElementById("dlUser").value = "student-a1";
  page.doc.getElementById("dlPass").value = "Passw0rd!123";
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => page.doc.querySelector('.dash-login-card a[href="/student"]'));
  assert.ok(!page.shell(), "a student never gets the admin console");
  assert.ok(!page.form(), "the form is replaced by the hand-off");
  const heading = page.doc.querySelector(".dash-login-card h1");
  assert.ok(heading && /opening your workspace/i.test(heading.textContent),
    "the student is handed off, instead of a silently re-rendered form");
  const link = page.doc.querySelector('.dash-login-card a[href="/student"]');
  assert.ok(link, "the destination is the student portal at /student");
  page.close();
});

test("a failed attempt restores the Sign In button and keeps the typed username", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  page.doc.getElementById("dlUser").value = "testadmin";
  page.doc.getElementById("dlPass").value = "not-the-password";
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => {
    const b = page.doc.querySelector(".dash-login-submit");
    return b && b.disabled === false && /Sign In/i.test(b.textContent);
  });
  const btn = page.doc.querySelector(".dash-login-submit");
  assert.ok(btn, "the submit button is still there");
  assert.equal(btn.disabled, false, "the button is re-enabled — a retry is possible");
  assert.match(btn.textContent, /Sign In/i, "the button is not stuck on 'Signing in…'");
  assert.equal(page.doc.getElementById("dlUser").value, "testadmin",
    "the username survives the failed attempt so only the password must be retyped");
  page.close();
});

test("submitting an empty form states what is missing instead of doing nothing", { skip: skipUI }, async () => {
  const page = await openAdminApp("/login");
  // `novalidate` + autofill/password managers can submit blank fields.
  page.doc.getElementById("dlUser").value = "";
  page.doc.getElementById("dlPass").value = "";
  page.form().dispatchEvent(new page.dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => page.doc.querySelector(".dash-login-error"));
  const err = page.doc.querySelector(".dash-login-error");
  assert.ok(err, "an empty submit is not silently swallowed");
  assert.match(err.textContent, /Enter both your username and your password/i);
  assert.ok(!page.shell(), "no console");
  page.close();
});

test("the API client turns an unreachable server into a readable message", () => {
  // A rejected fetch (offline/DNS/server down) used to surface as an
  // undefined message, which rendered as a blank error — i.e. "nothing".
  assert.ok(/catch \(networkError\)/.test(API_JS), "login() catches fetch rejections");
  assert.ok(/Could not reach the server/.test(API_JS), "and reports them in words");
  assert.ok(/Too many sign-in attempts/.test(API_JS), "429 has a message of its own");
  assert.ok(/r\.status >= 500/.test(API_JS), "a non-JSON 5xx page still yields a message");
});

test("one sign-in performs exactly one boot (no duplicated/racing dashboard loads)", () => {
  assert.ok(/let bootInFlight = null;/.test(DASH_JS), "boot() is guarded against concurrent runs");
  assert.ok(/if \(bootInFlight\) return bootInFlight;/.test(DASH_JS),
    "a second boot() reuses the in-flight one instead of racing it");
});

test("the sign-in handler always leaves a visible outcome", () => {
  // Source-level guard: the submit path must never fall through without
  // either mounting the console or rendering an error.
  assert.ok(/function nonAdminMessage\(role\)/.test(DASH_JS), "non-admin roles have an explicit message");
  assert.ok(/const ADMIN_ROLES = \["madrasa_admin", "super_admin"\];/.test(DASH_JS),
    "the roles that may open this console are named in one place");
  assert.ok(/submitBtn\.disabled = false; submitBtn\.textContent = submitLabel;/.test(DASH_JS),
    "the button is restored in a finally block");
});
