"use strict";
/* ============================================================================
   Render deployment contract
   ---------------------------------------------------------------------------
   This is deliberately a source-level test: a skipped disk, a SQLite fallback,
   or an unsupported Blueprint key is a data-loss bug, not merely a docs typo.
   ========================================================================== */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const envVars = (service) => Object.fromEntries(service.envVars.map((entry) => [entry.key, entry]));

function productionEnv(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-render-config-"));
  return {
    env: Object.assign({}, process.env, {
      NODE_ENV: "production",
      DATABASE_DRIVER: "mysql",
      DATABASE_URL: "mysql://user:password@db.example.test:3306/madrasa",
      SESSION_SECRET: "x".repeat(48),
      SUPER_ADMIN_PASSWORD: "A-strong-production-password!",
      DATA_DIR: path.join(dir, "data"),
      DATABASE_FILE: path.join(dir, "data", "madrasa_platform.sqlite"),
      PERSISTENT_VOLUME_DIR: path.join(dir, "data"),
      UPLOAD_DIR: path.join(dir, "data", "uploads"),
      BACKUP_DIR: path.join(dir, "data", "backups"),
      BACKUP_INTERVAL_MINUTES: "0",
    }, overrides),
    dir,
  };
}

function runConfig(script, overrides) {
  const { env, dir } = productionEnv(overrides);
  try {
    return spawnSync(process.execPath, ["-e", script], { cwd: ROOT, env, encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the Render Blueprint requests durable storage and an explicit MySQL database", () => {
  const doc = yaml.load(read("render.yaml"));
  assert.ok(Array.isArray(doc.services) && doc.services.length === 1, "one explicit production service");
  const service = doc.services[0];
  assert.equal(service.type, "web");
  assert.equal(service.runtime, "node");
  assert.equal(service.plan, "starter", "persistent disks need a paid Render service");
  assert.equal(service.numInstances, 1, "a Render disk cannot be shared by scaled instances");
  assert.deepEqual(service.disk, { name: "bello-data", mountPath: "/var/data", sizeGB: 1 });
  assert.equal(service.nodeVersion, undefined, "nodeVersion is not a valid Render Blueprint field");

  const vars = envVars(service);
  assert.equal(vars.NODE_VERSION.value, "22.22.3");
  assert.equal(vars.NODE_ENV.value, "production");
  assert.equal(vars.DATABASE_DRIVER.value, "mysql", "production must not fall back to SQLite");
  assert.equal(vars.DATABASE_URL.sync, false, "Render must request a real database URL at deploy time");
  assert.equal(vars.DATA_DIR.value, "/var/data");
  assert.equal(vars.UPLOAD_DIR.value, "/var/data/uploads");
  assert.equal(vars.BACKUP_DIR.value, "/var/data/backups");
  assert.equal(vars.PERSISTENT_VOLUME_DIR.value, "/var/data");
});

test("Node is pinned with Render-supported settings rather than an invalid Blueprint field", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(read(".node-version").trim(), "22.22.3");
  assert.equal(pkg.engines.node, ">=22.22.3 <23.0.0");
});

test("production rejects SQLite when the configured data mount is actually ephemeral", () => {
  // Override the storage probe in a subprocess. This isolates the test from
  // the CI machine's own mount layout while exercising config.validate(), the
  // exact guard that runs before migrations and seed data at server boot.
  const result = runConfig(`
    const config = require("./server/config");
    require("./server/services/persistence").describeStorage = () => ({
      onPersistentVolume: false, mountPoint: "/", fsType: "overlay"
    });
    config.validate();
  `, { RENDER: "true", DATABASE_DRIVER: "sqlite", DATABASE_URL: "" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Refusing to start production/i);
  assert.match(result.stderr, /Render disk|persistent disk/i);
});

test("production accepts the explicit MySQL DATABASE_URL without a local SQLite fallback", () => {
  const result = runConfig(`require("./server/config").validate();`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /SQLite database/i);
});
