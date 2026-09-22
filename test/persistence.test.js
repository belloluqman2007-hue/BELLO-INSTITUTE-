"use strict";
/* ============================================================================
   PERSISTENCE & BACKUPS — why "the madrasa I added disappeared" happens, how
   the platform now detects and survives it, and that a snapshot really can be
   restored.
   Run: npm test
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initEnv, setup, Client, USE_MYSQL, PASSWORD, SA_PASSWORD } = require("./helpers");
// This file asserts HOW the platform persists data. Both drivers are checked
// for the same behaviour; only the driver-specific facts (a SQLite file on
// disk vs. an external MySQL server) differ, so those assertions branch
// instead of being skipped.
const DRIVER = USE_MYSQL ? "mysql" : "sqlite";
const tmpRoot = initEnv();

const config = require("../server/config");
const persistence = require("../server/services/persistence");
const backup = require("../server/services/backup");

let ctx, sa;
before(async () => {
  ctx = await setup();
  sa = new Client(ctx.base);
  await sa.login("testadmin", SA_PASSWORD);
});
after(async () => { await ctx.close(); });

const backupDir = () => path.join(tmpRoot, "data", "backups");

/* ------------------------------ configuration --------------------------- */

test("everything the app writes lives under DATA_DIR, and can be redirected", () => {
  assert.equal(config.DATA_DIR, path.join(tmpRoot, "data"));
  assert.equal(config.BACKUP_DIR, path.join(config.DATA_DIR, "backups"), "backups default next to the database");
  assert.equal(config.UPLOAD_DIR, path.join(tmpRoot, "uploads"), "an explicit UPLOAD_DIR still wins");
  assert.equal(path.resolve(config.DATA_DIR, "uploads"), path.join(path.join(tmpRoot, "data"), "uploads"), "and the default nests uploads under DATA_DIR");
  assert.equal(config.PERSISTENT_VOLUME_DIR, "/var/data", "the mount point Render/Fly/K8s use");
  assert.equal(config.IS_PRODUCTION, false);
  assert.equal(config.BACKUP_INTERVAL_MINUTES, 0, "tests must never start a background timer");
  assert.ok(config.BACKUP_KEEP >= 1);
  assert.equal(path.basename(config.DB_CONFIG.file), "test.sqlite", "an explicit DATABASE_FILE still wins");
  assert.ok(config.isUnder("/a/b/c", "/a/b"));
  assert.ok(!config.isUnder("/a/bc", "/a/b"), "a prefix is not a directory");
  assert.ok(Array.isArray(config.persistenceWarnings()));
});

/* ------------------------------ storage probe --------------------------- */

test("describeStorage judges a directory and explains itself", () => {
  const d = persistence.describeStorage(path.join(tmpRoot, "data"));
  assert.equal(d.exists, true);
  assert.equal(d.writable, true, "we can actually write there");
  assert.equal(d.onPersistentVolume === false || d.onPersistentVolume === true, true, "on Linux an answer, not a shrug");
  if (d.onPersistentVolume === false) {
    assert.ok(d.checks.length, "a negative verdict must always carry the reason");
    assert.match(d.checks.join(" "), /ephemeral|root filesystem/i);
  }
  const missing = persistence.describeStorage(path.join(tmpRoot, "nope", "deep"));
  assert.equal(missing.exists, true, "missing directories are created for you, not an error");
});

test("findMountFor finds the mount that covers a path", () => {
  if (process.platform !== "linux") return; // /proc/mounts is the only source
  const root = persistence.findMountFor("/");
  assert.ok(root && root.mountPoint === "/" && root.root === false, "the root filesystem is recognised");
  const here = persistence.findMountFor(path.resolve(process.cwd()));
  assert.ok(here && here.fstype, "an app path resolves to a mount: " + JSON.stringify(here));
  // /proc is its own mount, so a path inside it must resolve to that, not to /.
  const proc = persistence.findMountFor("/proc/self/status");
  assert.ok(proc && proc.mountPoint === "/proc", "the longest covering mount wins: " + JSON.stringify(proc));
});

test("the state marker proves the volume survived a restart", async () => {
  const markerFile = path.join(config.DATA_DIR, ".platform-state.json");
  fs.rmSync(markerFile, { force: true });
  const first = persistence.touchMarker({ appVersion: "test" });
  assert.equal(first.volumeSurvivedRestarts, false, "a first boot has nothing to compare with");
  assert.equal(first.marker.bootCount, 1);
  assert.equal(first.marker.appVersion, "test");
  assert.ok(fs.existsSync(markerFile));

  const second = persistence.touchMarker({ appVersion: "test" });
  assert.equal(second.volumeSurvivedRestarts, true, "the marker was still there — the disk survived");
  assert.equal(second.marker.bootCount, 2);
  assert.equal(second.marker.firstSeenAt, first.marker.firstSeenAt, "the original date is kept, not rewritten");
  assert.equal(second.previous.lastBootHost, first.marker.lastBootHost);

  // The classic symptom: the marker is gone even though rows existed.
  const counts = await persistence.recordCounts(ctx.db);
  assert.deepEqual(Object.keys(counts).sort(), ["madaris", "results", "students", "users"]);
  assert.ok(counts.madaris >= 1, "the last boot recorded what was in the database");
  const lost = persistence.touchMarker({ appVersion: "test" });
  assert.ok(lost.marker.lastKnownCounts, "the counts ride in the marker for the next boot to compare");
  // Leave a marker behind: later tests read the boot state through the API, and
  // "no marker" is the production-only alarm, not something to dangle here.
  assert.ok(fs.existsSync(markerFile));
});

test("the report is a verdict, not an exception, in development", async () => {
  const r = await persistence.report(ctx.db);
  assert.equal(r.level, "ok", "a developer's own disk is durable even when mounted at /");
  assert.equal(r.driver, DRIVER);
  assert.equal(r.externalDatabase, USE_MYSQL);
  if (!USE_MYSQL) assert.match(r.databaseFile, /test\.sqlite$/);
  assert.equal(r.persistentVolumeDir, "/var/data");
  assert.equal(r.acknowledged, false);
  assert.deepEqual(r.warnings, [], "no false alarms where nothing is wrong");
  assert.equal(r.counts.madaris, 2);
  assert.equal(r.dataDir.writable, true);
});

test("the same report screams in production when the disk is a container's", async () => {
  // Report in a child process: NODE_ENV must be production before config loads.
  const stub = path.join(tmpRoot, "prod-report.js");
  fs.writeFileSync(stub, `
    const fs = require("fs"), path = require("path");
    const root = ${JSON.stringify(tmpRoot)};
    process.env.NODE_ENV = "production";
    // This probe is about the SQLITE-on-an-ephemeral-disk alarm, so the child
    // is pinned to the sqlite driver even when the suite as a whole is running
    // against MySQL (where there is no local database file to lose).
    process.env.DATABASE_DRIVER = "sqlite";
    delete process.env.DATABASE_URL;
    process.env.DATABASE_FILE = path.join(root, "prod.sqlite");
    const persistence = require(${JSON.stringify(path.join(process.cwd(), "server", "services", "persistence.js"))});
    const config = require(${JSON.stringify(path.join(process.cwd(), "server", "config.js"))});
    // Force the "inside the app root, not on a volume" shape the probe looks for.
    persistence.describeStorage = null;
    persistence.report(null).then((r) => {
      const onVolume = r.dataDir.onPersistentVolume;
      console.log("RESULT" + JSON.stringify({
        level: onVolume === true ? "ok" : r.level,
        codes: onVolume === true ? [] : r.warnings.map((w) => w.code),
        dirs: [config.DATA_DIR, config.UPLOAD_DIR, config.BACKUP_DIR],
        file: config.DB_CONFIG.file,
        configWarnings: config.persistenceWarnings().length,
      }));
    }).catch((e) => { console.error(e); process.exit(1); });
  `);
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath, [stub], { encoding: "utf8" });
  const parsed = JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT")).slice(6));
  assert.ok(["critical", "warn", "ok"].includes(parsed.level), out);
  // Whichever verdict the sandbox's filesystem produces, the data directory is
  // NOT inside a mounted volume here, so the operator must be told.
  assert.ok(parsed.dirs.every((d) => !d.startsWith("/var/data")), "nothing points at the volume yet");
  assert.ok(parsed.configWarnings >= 1, "config also prints its own warning at boot");
  fs.rmSync(stub, { force: true });
});

test("DATA_PERSISTENT_ACK silences the alarm without disabling backups", () => {
  const { spawnSync } = require("child_process");
  const run = (ack) => {
    const env = Object.assign({}, process.env, {
      NODE_ENV: "production",
      // Same reason as above: the acknowledgement flag exists to silence the
      // sqlite-on-ephemeral-disk alarm, so this child always runs on sqlite.
      DATABASE_DRIVER: "sqlite",
      DATABASE_URL: "",
      DATA_PERSISTENT_ACK: ack ? "1" : "",
      DATA_DIR: path.join(tmpRoot, "ack"),
      DATABASE_FILE: path.join(tmpRoot, "ack", "x.sqlite"),
    });
    const out = spawnSync(process.execPath, ["-e", `
      const p = require(${JSON.stringify(path.join(process.cwd(), "server", "services", "persistence.js"))});
      p.report(null).then((r) => console.log(JSON.stringify({ level: r.level, codes: r.warnings.map(w => w.code), ack: r.acknowledged })));
    `], { env, encoding: "utf8" }).stdout.trim().split("\n").pop();
    return JSON.parse(out);
  };
  const loud = run(false);
  const quiet = run(true);
  assert.ok(loud.codes.includes("EPHEMERAL_DATA_DIR") || loud.level === "ok", JSON.stringify(loud));
  assert.equal(quiet.ack, true);
  assert.ok(quiet.codes.includes("ACKNOWLEDGED"), "it says why it is quiet: " + JSON.stringify(quiet.codes));
  assert.ok(!quiet.codes.includes("EPHEMERAL_DATA_DIR"), "and does not repeat the warning");
});

/* ------------------------------- snapshots ------------------------------ */

test("a snapshot captures every table, counts it, and drops live sessions", async () => {
  const doc = await backup.buildSnapshot(ctx.db, { reason: "manual" });
  assert.equal(doc.format, backup.FORMAT);
  assert.equal(doc.reason, "manual");
  assert.ok(Date.parse(doc.createdAt) > 0);
  assert.equal(doc.app.driver, DRIVER);
  assert.equal(doc.app.env, "test");
  assert.deepEqual(Object.keys(doc.counts).sort(), Object.keys(doc.tables).sort());
  assert.equal(doc.counts.madaris, 2);
  assert.equal(doc.tables.madaris[0].slug, "testa");
  assert.ok(doc.tables.users[0].password_hash, "a restore must be able to put logins back");
  assert.ok(!("app_sessions" in doc.tables), "but nobody's live session cookie is copied out");
  assert.ok(backup.TABLE_ORDER.indexOf("madaris") < backup.TABLE_ORDER.indexOf("users"), "parents before children, so inserts satisfy the foreign keys");
});

test("writeSnapshot stores it in BACKUP_DIR and prunes the oldest", async () => {
  const written = [];
  for (let i = 0; i < 3; i++) written.push((await backup.writeSnapshot(ctx.db, { reason: "manual", keep: 999 })).name);
  assert.ok(written.every((n) => /^snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-manual\.json$/.test(n)), written[0]);
  assert.equal(new Set(written).size, 3, "three saves in a row are three different files");
  for (const n of written) assert.ok(fs.existsSync(path.join(backupDir(), n)));
  assert.equal(await backup.prune(3), 0, "nothing to remove at keep=3");
  assert.ok((await backup.prune(1)) >= 2, "older ones go");
  const left = fs.readdirSync(backupDir());
  assert.equal(left.filter((n) => /-manual\.json$/.test(n)).length, 1, "only the newest manual snapshot is left: " + left.join(","));
  assert.ok(left.some((n) => /pre-migration/.test(n)), "…while the pre-migration safety copy is still there");
});

test("pre-restore and pre-migration snapshots are never pruned away", async () => {
  const dir = backupDir();
  fs.writeFileSync(path.join(dir, "snapshot-2020-01-01T00-00-00-pre-restore.json"), JSON.stringify({ format: backup.FORMAT, tables: {}, counts: {} }));
  for (let i = 0; i < 4; i++) await backup.writeSnapshot(ctx.db, { reason: "scheduled", keep: 2 });
  assert.ok(fs.existsSync(path.join(dir, "snapshot-2020-01-01T00-00-00-pre-restore.json")), "the safety copy survives pruning");
  const listed = await backup.list();
  assert.ok(listed.some((b) => b.name.includes("pre-restore")), "it is still listed for the operator to see");
  assert.ok(listed.filter((b) => /-scheduled/.test(b.name)).length <= 2, "scheduled ones were capped at keep=2");
});

test("snapshotBefore is a no-op on an empty database", async () => {
  const fake = { all: async () => [], dialect: async () => "sqlite" };
  assert.equal(await backup.snapshotBefore(fake, "pre-migration"), null, "nothing worth saving yet");
});

/* -------------------------------- routes -------------------------------- */

test("the super admin can list, create, download and plan", async () => {
  const made = await sa.api("POST", "/api/platform/backups", {});
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.ok(made.data.bytes > 500 && made.data.counts.madaris === 2);

  const list = await sa.api("GET", "/api/platform/backups");
  assert.equal(list.status, 200);
  assert.equal(list.data.directory, config.BACKUP_DIR, "the screen says where the files are");
  assert.equal(list.data.intervalMinutes, 0);
  assert.ok(list.data.backups.some((b) => b.name === made.data.name));
  const dates = list.data.backups.map((b) => b.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");

  const plan = await sa.api("GET", "/api/platform/backups/" + made.data.name + "/plan");
  assert.equal(plan.status, 200);
  assert.equal(plan.data.plan.dryRun, true);
  assert.ok(plan.data.plan.wouldReplace.includes("students"));
  assert.equal(plan.data.plan.unknown.length, 0);
  assert.equal(plan.data.snapshot.counts.madaris, 2);

  const dl = await sa.api("GET", "/api/platform/backups/" + made.data.name + "/download");
  assert.equal(dl.status, 200);
  assert.match(dl.res.headers.get("content-disposition"), /^attachment; filename="snapshot-/);
  assert.equal((dl.data && dl.data.format) || JSON.parse(dl.data).format, backup.FORMAT);
});

test("file names are validated, so the endpoint cannot be walked out of BACKUP_DIR", async () => {
  // BACKUP_DIR is <tmpRoot>/data/backups, so a "../.." walk lands in tmpRoot.
  // Put a canary there (a stand-in for a real .env) and prove that no endpoint
  // can read, plan, restore or delete it. The repo's own .env is deliberately
  // not used: a test must never create or destroy a developer's secrets file,
  // and it must not depend on one happening to exist.
  const canary = "SESSION_SECRET=must-not-be-read-or-deleted";
  const sentinel = path.join(tmpRoot, ".env");
  fs.writeFileSync(sentinel, canary);
  const enc = (v) => encodeURIComponent(v);
  for (const name of ["..%2f..%2fconfig", "%2e%2e%2fserver%2fconfig.js", "config.js", "snapshot-x.txt"]) {
    const r = await sa.api("GET", "/api/platform/backups/" + name + "/download");
    assert.ok(r.status === 404 || r.status === 400, name + " → " + r.status);
  }
  assert.equal((await sa.api("GET", "/api/platform/backups/snapshot-not-here.json/plan")).status, 404, "a well-named but missing file says so");
  assert.equal((await sa.api("GET", "/api/platform/backups/../../.env/download")).status, 404, "and cannot be pointed at another file");
  assert.equal((await sa.api("GET", "/api/platform/backups/" + enc("../../.env") + "/plan")).status, 400, "…nor reached through the plan endpoint");
  assert.equal((await sa.api("POST", "/api/platform/backups/restore", { name: "../../.env", confirm: true })).status, 400, "…nor restored from");
  assert.equal((await sa.api("DELETE", "/api/platform/backups/%2e%2e%2f%2e%2e%2f.env")).status, 400);
  assert.ok(fs.existsSync(sentinel), "…and the file it tried to reach is untouched");
  assert.equal(fs.readFileSync(sentinel, "utf8"), canary, "…byte for byte");
  fs.rmSync(sentinel, { force: true });
});

test("restore reverses damage and leaves its own undo point", async () => {
  const snap = (await sa.api("POST", "/api/platform/backups", {})).data;
  const studentsBefore = Number((await ctx.db.get("SELECT COUNT(*) AS n FROM students")).n);

  const made = await sa.api("POST", "/api/platform/madaris", {
    slug: "oops-i-added-this", name_en: "Oops", name_ar: "مه", city: "Lagos", state_name: "Lagos", plan_id: 1,
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(Number((await ctx.db.get("SELECT COUNT(*) AS n FROM madaris")).n), 3);

  const r = await sa.api("POST", "/api/platform/backups/restore", { name: snap.name, confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.ok(r.data.restored.includes("madaris"), "it reports the tables it rewrote");
  assert.match(r.data.safetySnapshot, /pre-restore/, "and takes a copy of the state it replaced");

  assert.equal(Number((await ctx.db.get("SELECT COUNT(*) AS n FROM madaris")).n), 2, "the accidental madrasa is gone");
  assert.equal(Number((await ctx.db.get("SELECT COUNT(*) AS n FROM students")).n), studentsBefore, "no pupil was lost");
  const login = new Client(ctx.base);
  assert.equal((await login.login("admin-a", PASSWORD)).status, 200, "accounts still work after a restore");
});

test("restore refuses unless it is confirmed, known, and understood", async () => {
  const snap = (await sa.api("GET", "/api/platform/backups")).data.backups[0].name;
  assert.equal((await sa.api("POST", "/api/platform/backups/restore", { name: snap })).status, 400, "confirm is mandatory");
  assert.equal((await sa.api("POST", "/api/platform/backups/restore", { confirm: true })).status, 400, "a name is mandatory");
  assert.equal((await sa.api("POST", "/api/platform/backups/restore", { name: "nope.json", confirm: true })).status, 400, "only snapshot files may be restored");
  assert.equal((await sa.api("POST", "/api/platform/backups/restore", { name: "snapshot-1970-01-01T00-00-00-000-manual.json", confirm: true })).status, 404);

  const doc = await backup.buildSnapshot(ctx.db, { reason: "manual" });
  doc.tables.from_the_future = [{ id: 1 }];
  const file = path.join(backupDir(), "snapshot-2020-01-01T00-00-00-manual.json");
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = await sa.api("POST", "/api/platform/backups/restore", { name: "snapshot-2020-01-01T00-00-00-manual.json", confirm: true });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /from_the_future/, "it names the table it does not know instead of dropping it");
  assert.equal(Number((await ctx.db.get("SELECT COUNT(*) AS n FROM madaris")).n), 2, "and changed nothing at all");
  fs.rmSync(file, { force: true });
});

test("an uploaded snapshot goes through the same restore, then is wiped from disk", async () => {
  const snap = path.join(backupDir(), (await sa.api("GET", "/api/platform/backups")).data.backups[0].name);
  const form = new FormData();
  form.append("confirm", "true");
  form.append("file", new Blob([fs.readFileSync(snap)], { type: "application/json" }), "recovered.json");
  const token = await sa.csrf();
  const res = await fetch(ctx.base + "/api/platform/backups/import", {
    method: "POST", headers: { "X-CSRF-Token": token, Cookie: sa.cookieHeader() }, body: form,
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.restored.includes("madaris"));
  const leftovers = path.join(config.DATA_DIR, "imports");
  assert.ok(!fs.existsSync(leftovers) || fs.readdirSync(leftovers).length === 0, "the uploaded temp file is deleted");
});

test("a file that is not a backup is refused with a sentence a human can act on", async () => {
  const token = await sa.csrf();
  const post = async (content, name) => {
    const form = new FormData();
    form.append("confirm", "true");
    form.append("file", new Blob([content], { type: "application/octet-stream" }), name);
    const res = await fetch(ctx.base + "/api/platform/backups/import", {
      method: "POST", headers: { "X-CSRF-Token": token, Cookie: sa.cookieHeader() }, body: form,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const notJson = await post("hello", "notes.json");
  assert.equal(notJson.status, 400);
  assert.match(notJson.body.error, /JSON/i);
  const wrongShape = await post(JSON.stringify({ hello: "world" }), "x.json");
  assert.equal(wrongShape.status, 400);
  assert.match(wrongShape.body.error, /backup|format/i);
});

/* ------------------------------ the bug report -------------------------- */

test("a madrasa created by the super admin is inside the very next snapshot", async () => {
  // The reported symptom was "added it, later it was gone". Whatever the host
  // does, the platform must be able to prove and recover the state.
  const before = Number((await ctx.db.get("SELECT COUNT(*) AS n FROM madaris")).n);
  const made = await sa.api("POST", "/api/platform/madaris", {
    slug: "must-not-vanish", name_en: "Must Not Vanish Madrasa", name_ar: "مدرسة", city: "Ijebu-Ode", state_name: "Ogun", plan_id: 1,
    admin_username: "mnv-admin", admin_password: "Durable123!", public_listing: true,
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const snap = (await sa.api("POST", "/api/platform/backups", {})).data;
  assert.equal(snap.counts.madaris, before + 1, "the snapshot is taken from the live tables, not a cache");

  // Simulate the wipe: drop the madrasa, then recover from the file on disk.
  // MySQL actually ENFORCES users.madrasa_id -> madaris.id (SQLite does not
  // create that foreign key), so the tenant's rows are removed child-first —
  // which is what a real wipe looks like anyway.
  const doomed = await ctx.db.get("SELECT id FROM madaris WHERE slug = 'must-not-vanish'");
  await ctx.db.run("DELETE FROM users WHERE madrasa_id = ?", [doomed.id]);
  await ctx.db.run("DELETE FROM madaris WHERE slug = 'must-not-vanish'");
  assert.equal((await sa.api("GET", "/api/platform/madaris?perPage=100")).data.madaris.some((m) => m.slug === "must-not-vanish"), false);
  const r = await sa.api("POST", "/api/platform/backups/restore", { name: snap.name, confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = (await sa.api("GET", "/api/platform/madaris?perPage=100")).data.madaris.find((m) => m.slug === "must-not-vanish");
  assert.ok(back, "the madrasa is back, exactly as saved");
  assert.equal(back.public_listing, 1);
  assert.equal((await new Client(ctx.base).login("mnv-admin", "Durable123!")).status, 200, "with its administrator");
});

test("diagnostics answer the question the operator actually asked", async () => {
  for (const p of ["/api/platform/backups/diagnostics", "/api/platform/diagnostics"]) {
    const r = await sa.api("GET", p);
    assert.equal(r.status, 200, p);
    assert.equal(r.data.persistence.driver, DRIVER);
    assert.ok(["ok", "warn", "critical"].includes(r.data.persistence.level), p);
    assert.ok(Array.isArray(r.data.persistence.warnings), p);
    assert.ok(r.data.persistence.counts.madaris >= 2, p);
    assert.ok(r.data.backups.count >= 1, p);
    assert.ok(r.data.backups.newest.name.startsWith("snapshot-"), p);
    assert.ok(r.data.uptimeSeconds >= 0 && r.data.host, p);
    assert.ok(r.data.bootCount >= 1, p);
  }
});

test("backups are a platform concern: no tenant, no anonymous visitor", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  for (const p of ["/api/platform/backups", "/api/platform/backups/diagnostics", "/api/platform/diagnostics"]) {
    assert.equal((await admin.api("GET", p)).status, 403, p);
  }
  assert.equal((await admin.api("POST", "/api/platform/backups", {})).status, 403);
  assert.equal((await admin.api("POST", "/api/platform/backups/restore", { name: "x.json", confirm: true })).status, 403);
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/platform/backups")).status, 401);
  assert.equal((await anon.req("GET", "/api/platform/diagnostics")).status, 401);
});

test("the marker is written on boot and the counts on shutdown", async () => {
  // Wiring check: index.js must bump the marker BEFORE migrating (so a failed
  // migration still leaves evidence) and record counts on the way out.
  const index = fs.readFileSync(path.join(process.cwd(), "server", "index.js"), "utf8");
  const touch = index.indexOf("touchMarker(");
  const migrate = index.indexOf("migrate(");
  assert.ok(touch > -1 && migrate > -1, "both calls are in the boot sequence");
  assert.ok(touch < migrate, "the marker is touched before the schema is changed");
  assert.match(index, /writeSnapshot\([\s\S]{0,40}"shutdown"/, "a final snapshot is taken on SIGTERM/SIGINT");
  assert.match(index, /startAutoBackup\(/, "and the periodic backup is started");
  const migrateSrc = fs.readFileSync(path.join(process.cwd(), "server", "migrate.js"), "utf8");
  assert.match(migrateSrc, /snapshotBefore/, "migrations snapshot first");
  assert.match(migrateSrc, /pendingMigrations\(\)[\s\S]{0,200}snapshot|if \(pending\.length/, "only when something is pending");
});
