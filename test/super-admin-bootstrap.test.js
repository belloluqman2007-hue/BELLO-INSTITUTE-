"use strict";
/* ============================================================================
   SUPER-ADMIN BOOTSTRAP — regression tests for the reported fault
   ----------------------------------------------------------------------------
   Reported: "If I enter my username and password as admin and super admin I
   tried to sign in nothing will happen."

   Root causes covered here:

     1. NO ACCOUNT WAS EVER CREATED.
        seedSuperAdmin() returned early with a single console warning when
        SUPER_ADMIN_PASSWORD was unset — the normal state of a fresh clone or
        of a host where the variable was never configured. The platform then
        booted with a COMPLETELY EMPTY users table, so `admin` (the documented
        username) matched nothing and every attempt answered "Invalid username
        or password". Nothing on screen said the account did not exist.

     2. THE USERNAME WAS STORED IN A CASE LOGIN CANNOT MATCH.
        POST /api/auth/login lower-cases the submitted username, but the seed
        inserted SUPER_ADMIN_USERNAME verbatim. `SUPER_ADMIN_USERNAME=Admin`
        therefore created an account that NO input could ever match — the one
        account on the platform was permanently unreachable.

   The contract now:
     • A boot always leaves a usable super admin: development generates a
       password (printed + .dev-credentials.txt); production refuses to start
       rather than come up unreachable.
     • Super-admin usernames are stored lower-case, and existing mixed-case
       rows are repaired on boot.
     • Logging in to a platform with zero accounts says so explicitly.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { initEnv, setup, Client } = require("./helpers");
initEnv();

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

/* ------------------------------------------------------------------ */
/* 1. The account is actually created                                  */
/* ------------------------------------------------------------------ */

/** Runs a fresh seed in a child process with its own throwaway database. */
function seedIn(env = {}) {
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-bootstrap-"));
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server", "seed.js")],
    {
      cwd: dir,
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        NODE_ENV: "development",
        DATABASE_DRIVER: "sqlite",
        DATA_DIR: path.join(dir, "data"),
        DATABASE_FILE: path.join(dir, "data", "madrasa_platform.sqlite"),
        BACKUP_DIR: path.join(dir, "data", "backups"),
        BACKUP_INTERVAL_MINUTES: "0",
        SUPER_ADMIN_USERNAME: "",
        SUPER_ADMIN_PASSWORD: "",
      }, env),
    }
  );
  return { dir, res, file: path.join(dir, "data", "madrasa_platform.sqlite") };
}

/** Reads the users table of a seeded SQLite file. */
function usersIn(file) {
  const { DatabaseSync } = require("node:sqlite");
  const raw = new DatabaseSync(file);
  const rows = raw.prepare("SELECT username, role, password_hash FROM users").all();
  raw.close();
  return rows;
}

test("THE REPORTED FAULT: a seed with NO SUPER_ADMIN_PASSWORD still creates a usable account", () => {
  const { dir, res, file } = seedIn();
  assert.equal(res.status, 0, "the seed succeeds:\n" + res.stdout + res.stderr);

  const users = usersIn(file);
  const supers = users.filter((u) => u.role === "super_admin");
  assert.equal(supers.length, 1, "exactly one super admin exists — an empty users table is the bug");
  assert.equal(supers[0].username, "admin", "it uses the documented default username");
  assert.ok(supers[0].password_hash, "it has a real password hash");

  // The generated password must be discoverable, or it is no better than none.
  const printed = /^\s*password:[ \t]*(\S+)\s*$/m.exec(res.stdout);
  assert.ok(printed, "the generated password is printed:\n" + res.stdout);
  const creds = path.join(dir, ".dev-credentials.txt");
  assert.ok(fs.existsSync(creds), "the generated password is written to .dev-credentials.txt");
  assert.ok(fs.readFileSync(creds, "utf8").includes(printed[1]), "the file holds the same password");

  // And it must actually verify against the stored hash.
  const bcrypt = require("bcryptjs");
  assert.ok(bcrypt.compareSync(printed[1], supers[0].password_hash),
    "the printed password really opens the seeded account");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the generated development password is never a fixed, guessable string", () => {
  const a = seedIn();
  const b = seedIn();
  const pa = /^\s*password:[ \t]*(\S+)\s*$/m.exec(a.res.stdout)[1];
  const pb = /^\s*password:[ \t]*(\S+)\s*$/m.exec(b.res.stdout)[1];
  assert.notEqual(pa, pb, "two installs do not share one hard-coded password");
  assert.ok(pa.length >= 12, "the generated password is long enough");
  fs.rmSync(a.dir, { recursive: true, force: true });
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test("an explicit SUPER_ADMIN_PASSWORD is still honoured exactly", () => {
  const { dir, res, file } = seedIn({ SUPER_ADMIN_PASSWORD: "Chosen-Password-123!" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const bcrypt = require("bcryptjs");
  const su = usersIn(file).find((u) => u.role === "super_admin");
  assert.ok(bcrypt.compareSync("Chosen-Password-123!", su.password_hash),
    "the configured password is the one stored");
  assert.ok(!fs.existsSync(path.join(dir, ".dev-credentials.txt")),
    "no generated-credentials file when the operator chose the password");
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* 2. Username casing                                                  */
/* ------------------------------------------------------------------ */

test("SUPER_ADMIN_USERNAME is stored lower-case, so the typed username can match it", () => {
  const { dir, file } = seedIn({ SUPER_ADMIN_USERNAME: "Admin", SUPER_ADMIN_PASSWORD: "Chosen-Password-123!" });
  const su = usersIn(file).find((u) => u.role === "super_admin");
  assert.equal(su.username, "admin",
    "a mixed-case SUPER_ADMIN_USERNAME must not create an account login can never find");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an existing mixed-case super admin is repaired instead of staying unreachable", async () => {
  const bcrypt = require("bcryptjs");
  const { normalizeSuperAdminUsernames } = require("../server/seed");
  // A row exactly as older seeds wrote it.
  await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (NULL,?,?, 'super_admin','Legacy Admin')",
    ["LegacyAdmin", bcrypt.hashSync("Legacy-Pass-123!", 10)]
  );
  const fixed = await normalizeSuperAdminUsernames();
  assert.ok(fixed >= 1, "the mixed-case row was normalised");

  const row = await ctx.db.get("SELECT username FROM users WHERE full_name = 'Legacy Admin'");
  assert.equal(row.username, "legacyadmin");

  // And it can now actually sign in with what a person would type.
  const c = new Client(ctx.base);
  const r = await c.login("LegacyAdmin", "Legacy-Pass-123!");
  assert.equal(r.status, 200, "the repaired account signs in");
  await ctx.db.run("DELETE FROM users WHERE full_name = 'Legacy Admin'");
});

test("login is case-insensitive on the username", async () => {
  const c = new Client(ctx.base);
  const r = await c.login("TESTADMIN", "TestAdmin123!");
  assert.equal(r.status, 200, "the seeded super admin signs in regardless of typed case");
  assert.equal(r.data.role, "super_admin");
});

/* ------------------------------------------------------------------ */
/* 3. An un-provisioned platform explains itself                       */
/* ------------------------------------------------------------------ */

test("signing in to a platform with ZERO accounts says so, instead of 'invalid password'", async () => {
  // Move every account aside: this is the state the reporter's platform was in.
  const saved = await ctx.db.all("SELECT * FROM users");
  await ctx.db.run("DELETE FROM users");
  try {
    const c = new Client(ctx.base);
    const r = await c.login("admin", "super admin");
    assert.equal(r.status, 503, "an empty platform is a 503, not a 401 about a password");
    assert.equal(r.data.code, "NO_ACCOUNTS");
    assert.match(r.data.error, /no accounts yet/i,
      "the message names the real problem so the operator can fix it");
  } finally {
    for (const u of saved) {
      await ctx.db.run(
        "INSERT INTO users (id, madrasa_id, username, password_hash, role, full_name, full_name_ar, email, phone, student_id, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [u.id, u.madrasa_id, u.username, u.password_hash, u.role, u.full_name, u.full_name_ar,
         u.email, u.phone, u.student_id, u.is_active]
      );
    }
  }
});

test("with accounts present, a wrong password is still a plain 401 (no user enumeration)", async () => {
  const c = new Client(ctx.base);
  const wrong = await c.login("testadmin", "not-the-password");
  assert.equal(wrong.status, 401);
  assert.match(wrong.data.error, /Invalid username or password/);
  const unknown = await c.login("no-such-account-at-all", "whatever123");
  assert.equal(unknown.status, 401, "an unknown user is indistinguishable from a wrong password");
  assert.match(unknown.data.error, /Invalid username or password/);
});

/* ------------------------------------------------------------------ */
/* 4. Production must fail loudly rather than boot unreachable         */
/* ------------------------------------------------------------------ */

test("production refuses to seed a platform nobody could sign in to", async () => {
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-bootstrap-prod-"));
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server", "seed.js")],
    {
      cwd: dir,
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        NODE_ENV: "production",
        DATABASE_DRIVER: "sqlite",
        DATA_DIR: path.join(dir, "data"),
        DATABASE_FILE: path.join(dir, "data", "madrasa_platform.sqlite"),
        BACKUP_DIR: path.join(dir, "data", "backups"),
        BACKUP_INTERVAL_MINUTES: "0",
        PERSISTENT_VOLUME_DIR: path.join(dir, "data"),
        SESSION_SECRET: "x".repeat(48),
        SUPER_ADMIN_PASSWORD: "",
        DATA_PERSISTENT_ACK: "1",
      }),
    }
  );
  assert.notEqual(res.status, 0, "the seed fails instead of creating an empty platform");
  assert.match(res.stdout + res.stderr, /SUPER_ADMIN_PASSWORD/,
    "the failure names the variable to set");
  assert.ok(!fs.existsSync(path.join(dir, ".dev-credentials.txt")),
    "production never invents a password");
  fs.rmSync(dir, { recursive: true, force: true });
});
