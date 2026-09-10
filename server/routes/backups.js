"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — backup & restore (super admin only)
   ----------------------------------------------------------------------------
     GET    /api/platform/backups                 list snapshots on this host
     POST   /api/platform/backups                 write one now
     GET    /api/platform/backups/:name/download    download a snapshot
     GET    /api/platform/backups/:name/plan        what a restore would change
     POST   /api/platform/backups/restore           restore a snapshot (confirmed)
     POST   /api/platform/backups/import            restore from an uploaded file
     DELETE /api/platform/backups/:name             delete a snapshot file
     GET    /api/platform/diagnostics               storage + persistence verdict

   These endpoints exist because "the madrasa I created vanished" is a storage
   problem, not a form problem: on a host with an ephemeral filesystem the
   database file is deleted on the next deploy. Diagnostics say so in plain
   words, and backups make it survivable.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db");
const config = require("../config");
const backup = require("../services/backup");
const persistence = require("../services/persistence");
const { asyncHandler, err, ok } = require("../util");
const { requireSuperAdmin } = require("../middleware/auth");
const { fileUploader } = require("../middleware/upload");

const router = express.Router();
router.use(requireSuperAdmin);

const jsonUploader = fileUploader("imports", "file", {
  dir: config.DATA_DIR,
  extensions: [".json"],
  mimeTypes: ["application/json", "text/json", "application/octet-stream"],
  maxMb: 60,
});

router.get("/", asyncHandler(async (req, res) => {
  ok(res, {
    backups: backup.listSync(),
    directory: config.BACKUP_DIR,
    intervalMinutes: Number(config.BACKUP_INTERVAL_MINUTES || 0),
    keep: Number(config.BACKUP_KEEP || 10),
    onPersistentVolume: persistence.describeStorage(config.BACKUP_DIR).onPersistentVolume,
  });
}));

router.post("/", asyncHandler(async (req, res) => {
  const info = await backup.writeSnapshot(db, { reason: "manual" });
  ok(res, Object.assign({ ok: true }, info));
}));

router.get("/:name/download", asyncHandler(async (req, res) => {
  const name = path.basename(String(req.params.name || ""));
  const file = path.join(config.BACKUP_DIR, name);
  if (!/^snapshot-[A-Za-z0-9._-]+\.json$/.test(name) || !fs.existsSync(file)) return err(res, 404, "Backup not found.");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.sendFile(file);
}));

router.get("/:name/plan", asyncHandler(async (req, res) => {
  let snapshot;
  try { snapshot = backup.readSnapshot(req.params.name); } catch (e) { return err(res, e.status || 400, e.message); }
  const plan = await backup.restore(db, snapshot, { dryRun: true });
  ok(res, {
    plan,
    snapshot: { createdAt: snapshot.createdAt, counts: snapshot.counts, reason: snapshot.reason, app: snapshot.app },
  });
}));

/** Errors thrown deep in the engine keep the status the route must answer with. */
function routeError(res, e) {
  if (e && e.status) return err(res, e.status, e.message);
  console.error("Backup operation failed:", e);
  return err(res, 500, "That backup operation could not be completed. The current database was left untouched.");
}

router.post("/restore", asyncHandler(async (req, res) => {
  const name = (req.body && req.body.name) || "";
  if (!name) return err(res, 400, "A backup file name is required.");
  if (req.body && req.body.confirm !== true) return err(res, 400, "Type the confirmation to restore — this replaces all current data.");
  try {
    const snapshot = backup.readSnapshot(name);
    ok(res, await backup.restore(db, snapshot));
  } catch (e) {
    return routeError(res, e);
  }
}));

router.post("/import", jsonUploader, asyncHandler(async (req, res) => {
  const cleanup = () => { try { if (req.file) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } };
  if (!req.file) return err(res, 400, "Upload a .json backup file.");
  if (req.body && req.body.confirm !== "true" && req.body.confirm !== true) { cleanup(); return err(res, 400, "Confirm the restore — this replaces all current data."); }
  let parsed;
  try {
    parsed = backup.parseJson(fs.readFileSync(req.file.path, "utf8"));
  } catch (e) {
    cleanup();
    return err(res, e.status || 400, e.message);
  }
  try {
    const result = await backup.restore(db, parsed);
    cleanup();
    return ok(res, result);
  } catch (e) {
    cleanup();
    return routeError(res, e);
  }
}));

router.delete("/:name", asyncHandler(async (req, res) => {
  const name = path.basename(String(req.params.name || ""));
  if (!/^snapshot-[A-Za-z0-9._-]+\.json$/.test(name)) return err(res, 400, "Invalid backup name.");
  const file = path.join(config.BACKUP_DIR, name);
  if (!fs.existsSync(file)) return err(res, 404, "Backup not found.");
  fs.unlinkSync(file);
  ok(res, { ok: true });
}));

/** Storage verdict + row counts. This is what answers "why did it disappear?". */
router.get("/diagnostics", asyncHandler(async (req, res) => {
  const report = await persistence.report(db);
  const backups = backup.listSync();
  ok(res, {
    persistence: report,
    backups: {
      directory: config.BACKUP_DIR,
      count: backups.length,
      newest: backups[0] || null,
      intervalMinutes: Number(config.BACKUP_INTERVAL_MINUTES || 0),
      onPersistentVolume: persistence.describeStorage(config.BACKUP_DIR).onPersistentVolume,
    },
    uptimeSeconds: Math.round(process.uptime()),
    bootedAt: report.marker ? report.marker.lastBootAt : null,
    bootCount: report.marker ? report.marker.bootCount : null,
    host: require("os").hostname(),
  });
}));

module.exports = { router, jsonUploader };
