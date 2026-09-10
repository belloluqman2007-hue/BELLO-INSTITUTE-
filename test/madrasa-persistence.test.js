"use strict";
/* ============================================================================
   "IF I ADD A MADRASA, AFTER SOME TIME IT JUST DISAPPEARS"
   ----------------------------------------------------------------------------
   The reports were never about the app forgetting a tenant: the app opened a
   DIFFERENT database file. The SQLite path used to be chosen from NODE_ENV
   (madrasa_platform.sqlite in production, madrasa_platform_dev.sqlite
   anywhere else), so any boot whose environment differed — a deploy that set
   NODE_ENV, a CLI run from a shell that did not, a re-created service — got a
   brand-new EMPTY database, silently migrated and seeded. The madaris looked
   deleted; the next boot with the other NODE_ENV found them again. Hence
   "several times".

   These tests pin the fix:
     • one SQLite file name per DATA_DIR, whatever NODE_ENV says;
     • an older, env-suffixed file is adopted instead of shadowed by a new one;
     • a real restart (dev → production) still shows the same tenant;
     • if the storage really is wiped, the boot restores the newest snapshot.
   Run: npm test
   ========================================================================== */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
// No initEnv(): these tests must use the DEFAULT file resolution, and config is
// only required for its pure resolver. The child servers get their own env.
const config = require("../server/config");

const SA_USER = "root";
const SA_PASS = "MadrasaSurvives123!";
const pick = (opts) => config.resolveSqliteDatabaseFile(Object.assign({ explicit: "" }, opts));

/* ------------------------------ the resolver ------------------------------ */

test("the database file no longer depends on NODE_ENV", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmenv-"));
  const files = ["development", "production", "test", "staging"].map((env) => pick({ dataDir: dir, nodeEnv: env }).file);
  assert.equal(new Set(files).size, 1, "one environment or a hundred, the same file: " + files.join(" vs "));
  assert.equal(path.basename(files[0]), "madrasa_platform.sqlite");
  assert.equal(path.dirname(files[0]), dir, "…inside DATA_DIR");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an existing env-suffixed database is adopted, not shadowed by a new empty one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmlegacy-"));
  const legacy = path.join(dir, "madrasa_platform_dev.sqlite");
  fs.writeFileSync(legacy, "the tenants are in here");

  // An upgrade to this build must find the data an older build wrote, even if
  // the new boot is production (which used to mean a different file entirely).
  const prod = pick({ dataDir: dir, nodeEnv: "production" });
  assert.equal(prod.file, legacy, "production boot finds the existing database instead of creating an empty one");
  assert.equal(prod.usedLegacy, true);
  assert.match(prod.reason, /legacy/);

  // Once the canonical file exists it wins, and the other one is reported.
  fs.writeFileSync(path.join(dir, "madrasa_platform.sqlite"), "canonical");
  const next = pick({ dataDir: dir, nodeEnv: "production" });
  assert.equal(next.file, path.join(dir, "madrasa_platform.sqlite"));
  assert.equal(next.usedLegacy, false);
  assert.deepEqual(next.otherFiles.map((f) => f.name), ["madrasa_platform_dev.sqlite"], "and says what it ignored");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("an explicit DATABASE_FILE still wins, and mentions its neighbours", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmexplicit-"));
  fs.writeFileSync(path.join(dir, "madrasa_platform.sqlite"), "canonical");
  const r = config.resolveSqliteDatabaseFile({ dataDir: dir, nodeEnv: "production", explicit: path.join(dir, "special.sqlite") });
  assert.equal(r.file, path.join(dir, "special.sqlite"));
  assert.match(r.reason, /explicit DATABASE_FILE/);
  assert.deepEqual(r.otherFiles.map((f) => f.name), ["madrasa_platform.sqlite"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a stray file that is not a platform database is still reported, never opened", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmstray-"));
  fs.writeFileSync(path.join(dir, "somebody-elses.sqlite"), "x");
  const r = pick({ dataDir: dir, nodeEnv: "development" });
  assert.equal(r.file, path.join(dir, "madrasa_platform.sqlite"), "we do not jump onto an unrelated database");
  assert.deepEqual(r.otherFiles.map((f) => f.name), ["somebody-elses.sqlite"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------------- the reported bug, end to end ---------------------- */

const children = [];
after(() => { for (const c of children) { try { if (c.exitCode === null) c.kill("SIGKILL"); } catch (e) { /* gone */ } } });

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm" + name + "-"));
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Boots the real server (server/index.js, exactly as Render does) with its own
 * data directory, and returns a client + shutdown helper.
 */
async function boot({ dir, nodeEnv, port, extraEnv = {} }) {
  const env = Object.assign({}, process.env, {
    NODE_ENV: nodeEnv,
    PORT: String(port),
    DATA_DIR: path.join(dir, "data"),
    PERSISTENT_VOLUME_DIR: dir,
    SESSION_SECRET: "madrasa-survives-test-secret-0123456789-abcdefghijklmn",
    SUPER_ADMIN_USERNAME: SA_USER,
    SUPER_ADMIN_PASSWORD: SA_PASS,
    BACKUP_INTERVAL_MINUTES: "0",
    API_RATE_LIMIT: "1000000",
    LOGIN_RATE_LIMIT: "1000000",
    DATABASE_DRIVER: "sqlite",
  }, extraEnv);
  delete env.DATABASE_FILE;
  delete env.NODE_ENV; env.NODE_ENV = nodeEnv;

  const logs = [];
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "index.js")], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const onLine = (b) => logs.push(String(b));
  child.stdout.on("data", onLine);
  child.stderr.on("data", onLine);

  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("server exited early:\n" + logs.join(""));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) break;
    } catch (e) { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error("server did not come up:\n" + logs.join(""));
    await new Promise((r) => setTimeout(r, 150));
  }

  const text = () => logs.join("\n");
  return {
    child,
    port,
    logs: text,
    api: (method, path_, body) => apiCall(port, method, path_, body),
    async stop(signal = "SIGTERM") {
      if (child.exitCode === null) child.kill(signal);
      const end = Date.now() + 15000;
      while (child.exitCode === null && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      if (child.exitCode === null) { child.kill("SIGKILL"); throw new Error("server did not shut down:\n" + text()); }
      return text();
    },
  };
}

/** Tiny session client: CSRF double-submit + cookie, like the browser does. */
function makeClient(port) {
  let cookie = "";
  async function call(method, urlPath, body, headers = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      // The app marks session cookies Secure in production and Render terminates
      // TLS in front of it; this is what a browser would send.
      headers: Object.assign({ "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, cookie ? { Cookie: cookie } : {}, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      cookie = pair.slice(0, i) + "=" + pair.slice(i + 1);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    return { status: res.status, data };
  }
  return call;
}

async function apiCall(port, method, urlPath, body) {
  const call = makeClient(port);
  const login = await call("POST", "/api/auth/login", { username: SA_USER, password: SA_PASS });
  assert.equal(login.status, 200, "super admin login: " + JSON.stringify(login.data));
  const csrf = (await call("GET", "/api/csrf-token")).data.csrfToken;
  return call(method, urlPath, body, { "X-CSRF-Token": csrf });
}

const listSchemas = (dir) => {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, "data")); } catch (e) { return []; }
  return names.filter((n) => /\.sqlite$/i.test(n)).sort();
};

test("a madrasa added on a development boot is still there after a production boot", async () => {
  const dir = tmpDir("restart");
  const slug = "al-hikmah";

  const a = await boot({ dir, nodeEnv: "development", port: await freePort() });
  const created = await a.api("POST", "/api/platform/madaris", {
    slug, name_en: "Al-Hikmah Madrasa", name_ar: "الحكمة", city: "Ijebu-Ode", state_name: "Ogun", plan_id: 1,
    admin_username: "alhikmah", admin_password: "AdminPass123!",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const listedWhileUp = await a.api("GET", "/api/platform/madaris");
  assert.ok(listedWhileUp.data.madaris.some((m) => m.slug === slug), "it was there to begin with");
  const devLog = await a.stop();
  assert.match(devLog, /Database file: .*madrasa_platform\.sqlite/, "the boot log names the file it used");

  // Same volume, different NODE_ENV — the case that used to open an empty file.
  const b = await boot({ dir, nodeEnv: "production", port: await freePort() });
  const afterRestart = await b.api("GET", "/api/platform/madaris");
  assert.ok(
    afterRestart.data.madaris.some((m) => m.slug === slug),
    "the madrasa is STILL there after a restart with another NODE_ENV: " + JSON.stringify(afterRestart.data.madaris)
  );
  const stats = await b.api("GET", "/api/platform/stats");
  assert.equal(stats.data.madaris, 1, "and so is the count the dashboard shows");

  const diag = await b.api("GET", "/api/platform/backups/diagnostics");
  assert.equal(path.basename(diag.data.persistence.databaseFile), "madrasa_platform.sqlite");
  assert.deepEqual(diag.data.persistence.otherDatabaseFiles, [], "no second database is hiding the first one");
  assert.equal(diag.data.persistence.counts.madaris, 1);
  await b.stop();

  assert.deepEqual(listSchemas(dir), ["madrasa_platform.sqlite"], "one database file for every environment");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the CLI sees the same database the service does (NODE_ENV-free path)", async () => {
  const dir = tmpDir("cli");
  const a = await boot({ dir, nodeEnv: "development", port: await freePort() });
  await a.api("POST", "/api/platform/madaris", { slug: "furqa", name_en: "Furqa Academy", plan_id: 1 });
  await a.stop();

  const { execFileSync } = require("child_process");
  const env = Object.assign({}, process.env, {
    NODE_ENV: "production", DATA_DIR: path.join(dir, "data"), PERSISTENT_VOLUME_DIR: dir,
    DATABASE_DRIVER: "sqlite", BACKUP_INTERVAL_MINUTES: "0",
  });
  delete env.DATABASE_FILE;
  const out = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "backup.js"), "--list"], {
    env, cwd: ROOT, encoding: "utf8",
  });
  assert.match(out, /madrasa_platform\.sqlite/, "the tool prints which database it is on:\n" + out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a CLI cannot quietly create an empty database beside the real one", async () => {
  const dir = tmpDir("cliprotect");
  const { spawnSync } = require("child_process");
  const env = Object.assign({}, process.env, {
    NODE_ENV: "production", DATABASE_DRIVER: "sqlite", DATA_DIR: path.join(dir, "data"),
    PERSISTENT_VOLUME_DIR: dir, SUPER_ADMIN_PASSWORD: SA_PASS, SESSION_SECRET: "x".repeat(40),
    BACKUP_INTERVAL_MINUTES: "0",
  });
  delete env.DATABASE_FILE;
  const run = (script, args = []) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, script), ...args], { env, cwd: ROOT, encoding: "utf8" });

  // Nothing exists yet, and no snapshot either: a snapshot of "nothing" would
  // become the newest backup and be restored later by mistake, so it is refused.
  const snap = run("server/backup.js");
  assert.notEqual(snap.status, 0, "no silent empty snapshot");
  assert.match(snap.stderr, /there is no database at/);
  assert.deepEqual(listSchemas(dir).filter((n) => n.endsWith(".sqlite")), [], "refusing means REFUSING: no file was created");

  // The same command with --force is an explicit "I know, start from nothing".
  const forced = run("server/backup.js", ["--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /brand-new, empty database|Database:/, forced.stdout);

  fs.rmSync(dir, { recursive: true, force: true });
});

/* --------------------------- recovery after a wipe ------------------------ */

test("when the host wipes the storage, the next boot puts the madrasa back", async () => {
  const dir = tmpDir("wipe");
  const slug = "noor-ul-islam";

  const a = await boot({ dir, nodeEnv: "production", port: await freePort() });
  await a.api("POST", "/api/platform/madaris", {
    slug, name_en: "Noor Ul Islam", plan_id: 1, admin_username: "noor", admin_password: "AdminPass123!",
  });
  // A graceful shutdown snapshots the database — the copy that survives.
  await a.stop();
  const dataDir = path.join(dir, "data");
  const snapshots = fs.readdirSync(path.join(dataDir, "backups")).filter((n) => /^snapshot-.*\.json$/.test(n));
  assert.ok(snapshots.length, "a shutdown snapshot exists");

  // Simulate the throwaway container: the database file is simply not there.
  for (const f of fs.readdirSync(dataDir)) {
    if (/\.sqlite(-wal|-shm)?$/.test(f)) fs.rmSync(path.join(dataDir, f), { force: true });
  }
  assert.equal(fs.readdirSync(dataDir).filter((n) => /\.sqlite$/i.test(n)).length, 0);

  const b = await boot({ dir, nodeEnv: "production", port: await freePort() });
  const listed = await b.api("GET", "/api/platform/madaris");
  assert.ok(
    listed.data.madaris.some((m) => m.slug === slug),
    "the boot restored it from the snapshot: " + JSON.stringify(listed.data)
  );
  const login = await makeClient(b.port)("POST", "/api/auth/login", { username: "noor", password: "AdminPass123!" });
  assert.equal(login.status, 200, "the tenant admin's account came back too");

  const diag = await b.api("GET", "/api/platform/backups/diagnostics");
  assert.ok(
    diag.data.persistence.warnings.some((w) => w.code === "AUTO_RESTORED"),
    "and the admin is told it happened: " + JSON.stringify(diag.data.persistence.warnings.map((w) => w.code))
  );
  await b.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AUTO_RESTORE_ON_EMPTY_DB=0 leaves an empty database alone", async () => {
  const dir = tmpDir("noauto");
  const a = await boot({ dir, nodeEnv: "production", port: await freePort() });
  await a.api("POST", "/api/platform/madaris", { slug: "hidden", name_en: "Hidden School", plan_id: 1 });
  await a.stop();

  const dataDir = path.join(dir, "data");
  for (const f of fs.readdirSync(dataDir)) {
    if (/\.sqlite(-wal|-shm)?$/.test(f)) fs.rmSync(path.join(dataDir, f), { force: true });
  }
  const b = await boot({ dir, nodeEnv: "production", port: await freePort(), extraEnv: { AUTO_RESTORE_ON_EMPTY_DB: "0" } });
  const listed = await b.api("GET", "/api/platform/madaris");
  assert.equal(listed.data.madaris.length, 0, "disabled means disabled");
  assert.match(await b.stop(), /AUTO_RESTORE_ON_EMPTY_DB=0/, "it says so in the log");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a populated database is never overwritten by a snapshot", async () => {
  const dir = tmpDir("nooverwrite");
  const a = await boot({ dir, nodeEnv: "production", port: await freePort() });
  await a.api("POST", "/api/platform/madaris", { slug: "keep-me", name_en: "Keep Me", plan_id: 1 });
  await a.stop();

  // A snapshot exists AND the database still has its own data: autoRecover must
  // stay out of it, even though an older snapshot mentions a different tenant.
  const persistence = require("../server/services/persistence");
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath, ["-e", `
    const db = require(${JSON.stringify(path.join(ROOT, "server", "db.js"))});
    const p = require(${JSON.stringify(path.join(ROOT, "server", "services", "persistence.js"))});
    p.autoRecover(db).then((r) => { console.log(JSON.stringify(r)); return db.close(); });
  `], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { NODE_ENV: "production", DATA_DIR: path.join(dir, "data"), PERSISTENT_VOLUME_DIR: dir, DATABASE_DRIVER: "sqlite", SESSION_SECRET: "y".repeat(40) }),
    encoding: "utf8",
  });
  const result = JSON.parse(out.trim().split("\n").pop());
  assert.equal(result.skipped, "database already has data", JSON.stringify(result));
  const stillThere = JSON.parse(execFileSync(process.execPath, ["-e", `
    const db = require(${JSON.stringify(path.join(ROOT, "server", "db.js"))});
    db.all("SELECT slug FROM madaris").then((r) => { console.log(JSON.stringify(r)); return db.close(); });
  `], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { NODE_ENV: "production", DATA_DIR: path.join(dir, "data"), PERSISTENT_VOLUME_DIR: dir, DATABASE_DRIVER: "sqlite", SESSION_SECRET: "y".repeat(40) }),
    encoding: "utf8",
  }).trim().split("\n").pop());
  assert.deepEqual(stillThere.map((r) => r.slug), ["keep-me"], "nothing was replaced");
  fs.rmSync(dir, { recursive: true, force: true });
});
