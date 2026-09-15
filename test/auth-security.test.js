"use strict";
/* ============================================================================
   AUTH & SECURITY TESTS
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

test("login with wrong password is rejected", async () => {
  const c = new Client(ctx.base);
  const r = await c.login("admin-a", "WrongPassword");
  assert.equal(r.status, 401);
});

test("login with SQL injection in username is rejected", async () => {
  const c = new Client(ctx.base);
  const r = await c.login("admin-a' OR '1'='1", "x");
  assert.equal(r.status, 401);
});

test("login with unknown user is rejected", async () => {
  const c = new Client(ctx.base);
  const r = await c.login("no-such-user", "Whatever123");
  assert.equal(r.status, 401);
});

test("deactivated user cannot log in", async () => {
  const uid = (await ctx.db.get("SELECT id FROM users WHERE username = 'teacher-a'")).id;
  await ctx.db.run("UPDATE users SET is_active = 0 WHERE id = ?", [uid]);
  const c = new Client(ctx.base);
  const r = await c.login("teacher-a", PASSWORD);
  assert.equal(r.status, 403);
  await ctx.db.run("UPDATE users SET is_active = 1 WHERE id = ?", [uid]);
});

test("suspended madrasa blocks its users from login", async () => {
  await ctx.db.run("UPDATE madaris SET status = 'suspended' WHERE id = ?", [ctx.madrasaB]);
  const c = new Client(ctx.base);
  const r = await c.login("admin-b", PASSWORD);
  assert.equal(r.status, 403);
  await ctx.db.run("UPDATE madaris SET status = 'active' WHERE id = ?", [ctx.madrasaB]);
});

test("unauthenticated /api/auth/me reports logged out", async () => {
  const c = new Client(ctx.base);
  const r = await c.req("GET", "/api/auth/me");
  assert.equal(r.status, 200);
  assert.equal(r.data.loggedIn, false);
});

test("public /api/config serves the runtime API base without auth", async () => {
  const c = new Client(ctx.base);
  const r = await c.req("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.equal(r.data.apiBase, "/api");
  const js = await c.req("GET", "/app-config.js");
  assert.equal(js.status, 200);
  const script = await js.res.text();
  assert.match(script, /^window\.__APP_CONFIG__=/);
  const runtime = JSON.parse(script.replace(/^window\.__APP_CONFIG__=/, "").replace(/;\s*$/, ""));
  assert.equal(runtime.apiBase, "/api");
  assert.equal(runtime.categoryConfig.islamic.primaryColor, "#200A3D");
  assert.equal(runtime.categoryConfig.western.primaryColor, "#0A2342");
});

test("authenticated /api/auth/me returns user", async () => {
  const c = new Client(ctx.base);
  await c.login("admin-a", PASSWORD);
  const r = await c.req("GET", "/api/auth/me");
  assert.equal(r.data.loggedIn, true);
  assert.equal(r.data.role, "madrasa_admin");
});

test("CSRF: state-changing request without token is rejected", async () => {
  const c = new Client(ctx.base);
  await c.login("admin-a", PASSWORD);
  const r = await c.req("POST", "/api/announcements", { title: "X", body: "Y" });
  assert.equal(r.status, 403);
});

test("CSRF: state-changing request with token succeeds", async () => {
  const c = new Client(ctx.base);
  await c.login("admin-a", PASSWORD);
  const r = await c.api("POST", "/api/announcements", { title: "CSRF OK", body: "with token" });
  assert.equal(r.status, 200);
});

test("CSRF token bound to session (token from another session is rejected)", async () => {
  const c1 = new Client(ctx.base);
  const c2 = new Client(ctx.base);
  await c1.login("admin-a", PASSWORD);
  const token2 = await c2.csrf(); // different session
  const r = await c1.req("POST", "/api/announcements", { title: "X", body: "Y" }, { headers: { "X-CSRF-Token": token2 } });
  assert.equal(r.status, 403);
});

test("login rate limit kicks in after repeated attempts", async () => {
  // LOGIN_RATE_LIMIT=20 per IP+username. Earlier tests used admin-a once;
  // 25 more wrong attempts must trip the limiter.
  const c = new Client(ctx.base);
  let last = null;
  for (let i = 0; i < 25; i++) {
    last = await c.login("admin-a", "BadPass" + i);
  }
  assert.equal(last.status, 429, `expected 429, got ${last.status}`);
});

test("password change flow", async () => {
  // Uses parent-a: admin-a's rate-limit key is exhausted by the test above.
  const c = new Client(ctx.base);
  await c.login("parent-a", PASSWORD);
  const bad = await c.api("POST", "/api/auth/change-password", { currentPassword: "nope", newPassword: "NewPass123!" });
  assert.equal(bad.status, 400);
  const ok = await c.api("POST", "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "NewPass123!" });
  assert.equal(ok.status, 200);
  const c2 = new Client(ctx.base);
  const r = await c2.login("parent-a", "NewPass123!");
  assert.equal(r.status, 200);
  // restore
  const uid = (await ctx.db.get("SELECT id FROM users WHERE username = 'parent-a'")).id;
  const bcrypt = require("bcryptjs");
  await ctx.db.run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(PASSWORD, 10), uid]);
});

test("malformed JSON body is handled", async () => {
  const c = new Client(ctx.base);
  await c.login("admin-a", PASSWORD);
  const r = await c.req("POST", "/api/announcements", null, { headers: { "Content-Type": "application/json", "X-CSRF-Token": await c.csrf() }, rawBody: "{not json" });
  assert.equal(r.status, 400);
});

test("unauthenticated protected route returns 401", async () => {
  const c = new Client(ctx.base);
  const r = await c.req("GET", "/api/grading");
  assert.equal(r.status, 401);
});
