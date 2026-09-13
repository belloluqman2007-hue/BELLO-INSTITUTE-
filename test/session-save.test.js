"use strict";
/* ============================================================================
   SIGN-IN / SESSION STORE — regression tests for "Session save error."
   ----------------------------------------------------------------------------
   Reported: pressing Sign in with the CORRECT username and password answered
   500 { error: "Session save error." }.

   Root cause: app_sessions.expires stores a JavaScript epoch in MILLISECONDS
   (Date.now() ≈ 1.79e12). The column was created as INTEGER, which MySQL
   reads as a 4-byte signed INT capped at 2,147,483,647 (≈ 2.1e9). Every
   INSERT overflowed with ER_WARN_DATA_OUT_OF_RANGE, express-session's save()
   callback got the error, and the login route returned "Session save error."
   SQLite's INTEGER is 8 bytes, which is why development never showed it.

   What is locked down here:
     1. The session schema can hold a millisecond epoch (BIGINT on MySQL).
     2. A correct sign-in returns 200, sets the cookie and persists a row
        whose expiry really is in the future.
     3. Concurrent sign-ins / parallel writes for one sid never fail (the
        store upserts atomically instead of read-then-write).
     4. The error text, if a store write ever does fail, tells the operator
        what to do instead of saying only "Session save error.".
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

const ROOT = path.join(__dirname, "..");
const MIGRATE_JS = fs.readFileSync(path.join(ROOT, "server", "migrate.js"), "utf8");
const AUTH_JS = fs.readFileSync(path.join(ROOT, "server", "routes", "auth.js"), "utf8");
const STORE_JS = fs.readFileSync(path.join(ROOT, "server", "session-store.js"), "utf8");

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

/* ---------------------------- schema contract --------------------------- */

test("app_sessions.expires is BIGINT on MySQL (millisecond epochs overflow INT)", () => {
  // The CREATE TABLE must be dialect-aware…
  assert.match(
    MIGRATE_JS,
    /CREATE TABLE IF NOT EXISTS app_sessions[\s\S]*?expires \$\{dialect === "mysql" \? "BIGINT" : "INTEGER"\}/,
    "app_sessions must be created with BIGINT expires on MySQL"
  );
  // …and an explicit migration must widen databases that already exist.
  assert.match(MIGRATE_JS, /id: "014_session_expiry_bigint"/);
  assert.match(MIGRATE_JS, /ALTER TABLE app_sessions MODIFY COLUMN expires BIGINT/);
});

test("a millisecond epoch does not fit in a 4-byte INT (the actual overflow)", () => {
  const INT_MAX = 2147483647;
  assert.ok(Date.now() > INT_MAX, "sanity: Date.now() exceeds MySQL INT range");
});

/* ------------------------------ live login ------------------------------ */

test("correct credentials sign in successfully (no Session save error)", async () => {
  const c = new Client(ctx.base);
  const r = await c.login("testadmin", SA_PASSWORD);
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.role, "super_admin");
  assert.ok(c.cookies.mm_session, "a session cookie must be issued");
});

test("the signed-in session is persisted with an expiry in the future", async () => {
  const c = new Client(ctx.base);
  const before = Date.now();
  const r = await c.login("admin-a", PASSWORD);
  assert.equal(r.status, 200);

  const rows = await ctx.db.all("SELECT sid, expires, data FROM app_sessions");
  assert.ok(rows.length >= 1, "the login must write a session row");
  const row = rows.find((x) => String(x.data || "").includes("userId")) || rows[0];
  const expires = Number(row.expires);
  assert.ok(Number.isFinite(expires), "expires must be a number");
  assert.ok(expires > before, "the stored expiry must be in the future, not clamped");
  assert.ok(expires > 2147483647, "the expiry is a millisecond epoch, not a truncated INT");
});

test("the session survives the next request (/api/auth/me reports logged in)", async () => {
  const c = new Client(ctx.base);
  assert.equal((await c.login("admin-a", PASSWORD)).status, 200);
  const me = await c.req("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.loggedIn, true);
  assert.equal(me.data.user.username, "admin-a");
});

test("concurrent sign-ins all succeed (no transaction/duplicate-key collision)", async () => {
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map(() => new Client(ctx.base).login("admin-a", PASSWORD))
  );
  for (const r of results) {
    assert.equal(r.status, 200, `parallel login failed: ${JSON.stringify(r.data)}`);
  }
});

test("parallel writes to one session do not error", async () => {
  const c = new Client(ctx.base);
  assert.equal((await c.login("admin-a", PASSWORD)).status, 200);
  // rolling sessions re-save on every request; fire a burst at once.
  const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(() => c.req("GET", "/api/auth/me")));
  for (const r of rs) {
    assert.equal(r.status, 200);
    assert.equal(r.data.loggedIn, true);
  }
});

test("logout removes the session row and signs the user out", async () => {
  const c = new Client(ctx.base);
  assert.equal((await c.login("admin-a", PASSWORD)).status, 200);
  const out = await c.api("POST", "/api/auth/logout", {});
  assert.equal(out.status, 200);
  const me = await c.req("GET", "/api/auth/me");
  assert.equal(me.data.loggedIn, false);
});

/* --------------------------- the store itself --------------------------- */

test("the session store upserts atomically instead of read-then-write", () => {
  assert.ok(
    /ON DUPLICATE KEY UPDATE/.test(STORE_JS) && /ON CONFLICT\(sid\) DO UPDATE/.test(STORE_JS),
    "set() must be a single dialect-aware upsert"
  );
  assert.ok(
    !/db\.transaction\(/.test(STORE_JS),
    "set() must not wrap every session write in its own transaction"
  );
});

test("store.set survives being called repeatedly for the same sid", async () => {
  const DBSessionStore = require("../server/session-store");
  const store = new DBSessionStore();
  const sess = { cookie: { expires: new Date(Date.now() + 3600000) }, userId: 1 };
  const save = () => new Promise((resolve, reject) =>
    store.set("regression-sid", sess, (e) => (e ? reject(e) : resolve())));
  await save();
  await save();
  await Promise.all([save(), save(), save()]);
  const row = await ctx.db.get("SELECT * FROM app_sessions WHERE sid = ?", ["regression-sid"]);
  assert.ok(row, "the row must exist after repeated upserts");
  assert.ok(Number(row.expires) > Date.now(), "expiry must remain in the future");
  await new Promise((r) => store.destroy("regression-sid", r));
});

test("a session with no cookie expiry still gets a sane future expiry", async () => {
  const DBSessionStore = require("../server/session-store");
  const store = new DBSessionStore();
  await new Promise((resolve, reject) =>
    store.set("no-expiry-sid", { cookie: {} }, (e) => (e ? reject(e) : resolve())));
  const row = await ctx.db.get("SELECT * FROM app_sessions WHERE sid = ?", ["no-expiry-sid"]);
  assert.ok(Number(row.expires) > Date.now(), "fallback TTL must be applied");
  await new Promise((r) => store.destroy("no-expiry-sid", r));
});

/* --------------------------- the error message -------------------------- */

test("a session-store failure is logged and explained, not left as bare text", () => {
  assert.ok(
    /console\.error\("Login failed while saving the session:"/.test(AUTH_JS),
    "the real driver error must be logged server-side"
  );
  assert.ok(
    /ER_WARN_DATA_OUT_OF_RANGE/.test(AUTH_JS),
    "the out-of-range case must be recognised and explained"
  );
  assert.ok(
    !/error: "Session save error\."/.test(AUTH_JS),
    "the opaque \"Session save error.\" text must be gone"
  );
  assert.ok(
    /npm run migrate/.test(AUTH_JS),
    "the message must tell the operator the remedy"
  );
});
