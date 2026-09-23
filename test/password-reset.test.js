"use strict";
/* ============================================================================
   PASSWORD RESET SECURITY TESTS
   ----------------------------------------------------------------------------
   Covers the self-service recovery flow end to end:
     • request → generic response (no account enumeration)
     • tokens are single-use and expire
     • a reset invalidates every existing session of the account
     • admin-mediated link delivery is tenant-scoped
     • change-password invalidates the account's OTHER sessions
     • remember-me extends the session without granting anything else
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

async function latestToken(username) {
  const row = await ctx.db.get(
    "SELECT t.* FROM password_reset_tokens t JOIN users u ON u.id = t.user_id WHERE u.username = ? ORDER BY t.id DESC LIMIT 1",
    [username]
  );
  return row;
}

test("forgot-password requires an identifier", async () => {
  const c = new Client(ctx.base);
  const r = await c.req("POST", "/api/auth/forgot-password", {});
  assert.equal(r.status, 400);
});

test("forgot-password answers identically for known and unknown accounts", async () => {
  const c = new Client(ctx.base);
  const known = await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const unknown = await c.req("POST", "/api/auth/forgot-password", { identifier: "nobody-here" });
  const byEmail = await c.req("POST", "/api/auth/forgot-password", { identifier: "a@test.example" });
  assert.equal(known.status, 200);
  assert.ok(known.data.ok);
  assert.deepEqual(known.data, unknown.data, "responses must be byte-identical to avoid enumeration");
  assert.deepEqual(known.data, byEmail.data, "email lookup must behave the same as username lookup");
});

test("forgot-password creates a hashed, expiring, single-live token", async () => {
  await new Client(ctx.base).req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const row = await latestToken("teacher-a");
  assert.ok(row, "token row created");
  assert.match(row.token_hash, /^[0-9a-f]{64}$/, "only the sha256 hash is stored");
  assert.ok(row.token_encrypted, "an encrypted copy exists for admin delivery");
  assert.ok(!row.token_encrypted.includes(row.token_hash), "encrypted copy is not the hash");
  const expires = new Date(String(row.expires_at).replace(" ", "T")).getTime();
  assert.ok(expires > Date.now(), "token expires in the future");
  assert.ok(expires < Date.now() + 61 * 60 * 1000, "token expiry is bounded (default 60 minutes)");
  assert.equal(row.used_at, null);
});

test("a second request invalidates the previous live token", async () => {
  const c = new Client(ctx.base);
  await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const first = await latestToken("teacher-a");
  await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const second = await latestToken("teacher-a");
  assert.notEqual(first.id, second.id, "a new token was issued");
  const dead = await ctx.db.get("SELECT used_at FROM password_reset_tokens WHERE id = ?", [first.id]);
  assert.ok(dead.used_at, "the previous token was consumed immediately");
});

test("reset-password rejects an unknown token", async () => {
  const c = new Client(ctx.base);
  const r = await c.req("POST", "/api/auth/reset-password", { token: "0".repeat(64), newPassword: "NewPass1234!" });
  assert.equal(r.status, 400);
});

test("reset-password enforces the minimum length", async () => {
  const c = new Client(ctx.base);
  await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const row = await latestToken("teacher-a");
  // The token cannot be extracted from the API (only its hash is stored), so
  // simulate the admin-mediated hand-off by decrypting with the app secret —
  // exactly what /auth/reset-requests does for the administrator.
  const crypto = require("crypto");
  const key = crypto.scryptSync(process.env.SESSION_SECRET, "bello-password-reset-v1", 32);
  const buf = Buffer.from(row.token_encrypted, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const token = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  const short = await c.req("POST", "/api/auth/reset-password", { token, newPassword: "short" });
  assert.equal(short.status, 400);
  // The failed attempt must NOT consume the token.
  const stillLive = await ctx.db.get("SELECT used_at FROM password_reset_tokens WHERE id = ?", [row.id]);
  assert.equal(stillLive.used_at, null);
});

async function issueToken(username) {
  await new Client(ctx.base).req("POST", "/api/auth/forgot-password", { identifier: username });
  const row = await latestToken(username);
  const crypto = require("crypto");
  const key = crypto.scryptSync(process.env.SESSION_SECRET, "bello-password-reset-v1", 32);
  const buf = Buffer.from(row.token_encrypted, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const token = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  return { row, token };
}

test("full reset flow: new password works, old password dies, sessions die, token cannot be reused", async () => {
  // The teacher is signed in on a "stolen" session when the reset happens.
  const liveSession = new Client(ctx.base);
  await liveSession.login("student-a1", PASSWORD);
  const meBefore = await liveSession.req("GET", "/api/auth/me");
  assert.equal(meBefore.data.loggedIn, true);

  const { row, token } = await issueToken("student-a1");
  const c = new Client(ctx.base);
  const r = await c.req("POST", "/api/auth/reset-password", { token, newPassword: "FreshPass123!" });
  assert.equal(r.status, 200);
  assert.ok(r.data.ok);

  // Old password rejected, new password accepted.
  const old = await new Client(ctx.base).login("student-a1", PASSWORD);
  assert.equal(old.status, 401);
  const fresh = await new Client(ctx.base).login("student-a1", "FreshPass123!");
  assert.equal(fresh.status, 200);

  // The pre-reset session is gone.
  const meAfter = await liveSession.req("GET", "/api/auth/me");
  assert.equal(meAfter.data.loggedIn, false);

  // The token is single-use.
  const reuse = await c.req("POST", "/api/auth/reset-password", { token, newPassword: "Another123!" });
  assert.equal(reuse.status, 400);
  const consumed = await ctx.db.get("SELECT used_at FROM password_reset_tokens WHERE id = ?", [row.id]);
  assert.ok(consumed.used_at);

  // Restore the original password so later suites are unaffected.
  const restore = new Client(ctx.base);
  await restore.login("student-a1", "FreshPass123!");
  const csrf = await restore.csrf();
  const back = await restore.req("POST", "/api/auth/change-password", { currentPassword: "FreshPass123!", newPassword: PASSWORD }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(back.status, 200);
});

test("expired reset tokens are refused", async () => {
  const { token } = await issueToken("teacher-a");
  // Age the token past its window directly in the database.
  await ctx.db.run(
    "UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE username = 'teacher-a')",
    [new Date(Date.now() - 3600 * 1000).toISOString()]
  );
  const c = new Client(ctx.base);
  const r = await c.req("POST", "/api/auth/reset-password", { token, newPassword: "Later1234!" });
  assert.equal(r.status, 400);
});

test("deactivated accounts never receive reset tokens", async () => {
  const uid = (await ctx.db.get("SELECT id FROM users WHERE username = 'teacher-a'")).id;
  await ctx.db.run("UPDATE users SET is_active = 0 WHERE id = ?", [uid]);
  const c = new Client(ctx.base);
  const r = await c.req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  assert.equal(r.status, 200, "the response is still the generic success");
  const row = await ctx.db.get("SELECT t.id FROM password_reset_tokens t WHERE t.user_id = ? AND t.used_at IS NULL", [uid]);
  assert.equal(row, undefined, "no live token exists for the deactivated account");
  await ctx.db.run("UPDATE users SET is_active = 1 WHERE id = ?", [uid]);
});

test("reset requests are visible to the institution admin but tenant-scoped", async () => {
  // A request for a Madrasa A teacher…
  await new Client(ctx.base).req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  // …must be invisible to Madrasa B's administrator.
  const adminB = new Client(ctx.base);
  await adminB.login("admin-b", PASSWORD);
  const rB = await adminB.req("GET", "/api/auth/reset-requests");
  assert.equal(rB.status, 200);
  assert.ok(!rB.data.requests.some((x) => x.username === "teacher-a"), "tenant B must not see tenant A reset requests");

  const adminA = new Client(ctx.base);
  await adminA.login("admin-a", PASSWORD);
  const rA = await adminA.req("GET", "/api/auth/reset-requests");
  assert.equal(rA.status, 200);
  assert.ok(rA.data.requests.some((x) => x.username === "teacher-a" && x.resetLink), "own-tenant request is listed with a link");

  // Non-admin roles get nothing.
  const teacher = new Client(ctx.base);
  await teacher.login("teacher-a", PASSWORD);
  const rT = await teacher.req("GET", "/api/auth/reset-requests");
  assert.equal(rT.status, 403);
});

test("super admin sees platform-wide reset requests", async () => {
  await new Client(ctx.base).req("POST", "/api/auth/forgot-password", { identifier: "teacher-a" });
  const sa = new Client(ctx.base);
  await sa.login("testadmin", "TestAdmin123!");
  const r = await sa.req("GET", "/api/auth/reset-requests");
  assert.equal(r.status, 200);
  assert.ok(r.data.requests.some((x) => x.username === "teacher-a"));
});

test("change-password invalidates the account's other sessions but keeps the current one", async () => {
  const device1 = new Client(ctx.base);
  const device2 = new Client(ctx.base);
  await device1.login("parent-a", PASSWORD);
  await device2.login("parent-a", PASSWORD);
  const csrf = await device1.csrf();
  const r = await device1.req("POST", "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "Rotate1234!" }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(r.status, 200);
  const me1 = await device1.req("GET", "/api/auth/me");
  const me2 = await device2.req("GET", "/api/auth/me");
  assert.equal(me1.data.loggedIn, true, "the session that changed the password stays signed in");
  assert.equal(me2.data.loggedIn, false, "the other device was signed out");
  // Restore.
  const csrf2 = await device1.csrf();
  await device1.req("POST", "/api/auth/change-password", { currentPassword: "Rotate1234!", newPassword: PASSWORD }, { headers: { "X-CSRF-Token": csrf2 } });
});

test("remember me extends the session cookie lifetime server-side", async () => {
  const plain = new Client(ctx.base);
  await plain.login("teacher-a", PASSWORD);
  const remembered = new Client(ctx.base);
  await remembered.req("POST", "/api/auth/login", { username: "teacher-a", password: PASSWORD, remember: true });
  const sid = (sid => sid)(decodeURIComponent(remembered.cookies["mm_session"] || "").replace(/^s:/, "").split(".")[0]);
  const rows = await ctx.db.all("SELECT sid, expires FROM app_sessions");
  const plainSid = decodeURIComponent(plain.cookies["mm_session"] || "").replace(/^s:/, "").split(".")[0];
  const plainRow = rows.find((x) => x.sid === plainSid);
  const remRow = rows.find((x) => x.sid === sid);
  assert.ok(plainRow && remRow, "both sessions exist");
  const plainLife = Number(plainRow.expires) - Date.now();
  const remLife = Number(remRow.expires) - Date.now();
  assert.ok(plainLife <= 13 * 3600 * 1000, "default session is ~12h");
  assert.ok(remLife > 20 * 24 * 3600 * 1000, "remembered session is ~30 days");
  // The remembered session is still just a teacher — nothing more.
  const me = await remembered.req("GET", "/api/auth/me");
  assert.equal(me.data.role, "teacher");
});

test("authenticated API responses are never cacheable", async () => {
  const c = new Client(ctx.base);
  await c.login("teacher-a", PASSWORD);
  const r = await c.req("GET", "/api/auth/me");
  assert.match(r.res.headers.get("cache-control") || "", /no-store/);
});
