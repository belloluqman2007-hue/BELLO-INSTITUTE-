"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — "which database am I about to touch?"
   ----------------------------------------------------------------------------
   Every command-line entry point (migrate, seed, backup, reset-admin-password)
   used to open whatever SQLite file its own NODE_ENV implied, in silence. A
   shell that did not carry the service's environment therefore created a fresh,
   EMPTY database beside the real one — and the next boot of the app appeared to
   have lost every madrasa. These helpers make the target explicit and refuse
   to invent a database nobody asked for.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const config = require("./config");

/** One-line description of the resolved target, for `console.log` in CLIs. */
function describeTarget() {
  if (config.DATABASE_DRIVER !== "sqlite") {
    return "mysql — " + (config.DATABASE_URL ? maskUrl(config.DATABASE_URL) : [config.DB_CONFIG.host, config.DB_CONFIG.name].filter(Boolean).join("/"));
  }
  let bytes = "does not exist yet";
  try { bytes = (fs.statSync(config.DB_CONFIG.file).size / 1024).toFixed(1) + " KB"; } catch (e) { /* new file */ }
  return "sqlite — " + config.DB_CONFIG.file + " (" + bytes + "; " + config.SQLITE_DB.reason + ")";
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "••••";
    return u.toString();
  } catch (e) {
    return String(url).replace(/:[^:@/]*@/, ":••••@");
  }
}

/** Other *.sqlite files in the same directory — i.e. other people's data. */
function siblingDatabaseFiles() {
  if (config.DATABASE_DRIVER !== "sqlite") return [];
  const dir = path.dirname(config.DB_CONFIG.file);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names
    .filter((n) => /\.sqlite$/i.test(n) && path.join(dir, n) !== config.DB_CONFIG.file)
    .map((n) => {
      let st = null;
      try { st = fs.statSync(path.join(dir, n)); } catch (e) { /* ignore */ }
      return { name: n, bytes: st ? st.size : 0, file: path.join(dir, n) };
    });
}

/**
 * Stops a command that would otherwise build an EMPTY database beside the real
 * one — the mistake that turns into "I added a madrasa and later it was gone".
 * A restore is always allowed (that is how you get the data back).
 */
function requireExistingDatabase({ forceFlag = "--force" } = {}) {
  if (process.argv.includes(forceFlag)) return false;
  if (config.DATABASE_DRIVER !== "sqlite") return true;
  if (fs.existsSync(config.DB_CONFIG.file)) return true;
  console.error("FATAL: there is no database at " + config.DB_CONFIG.file + ".");
  console.error("Refusing to create an empty one: on this platform an empty database is usually a WRONG");
  console.error("database — the app opening another file is exactly how \"my madrasa disappeared\" starts.");
  console.error("Compare DATA_DIR / DATABASE_FILE / NODE_ENV with what the running service uses (its boot log");
  console.error("prints its own \"Database file:\" line).");
  const siblings = siblingDatabaseFiles();
  if (siblings.length) {
    console.error("Other SQLite files in the same directory that the app is NOT reading:");
    for (const s of siblings) console.error("  - " + s.file + " (" + Math.round(s.bytes / 1024) + " KB)  ← try DATABASE_FILE=<this>");
  }
  const snap = config.newestSnapshotFile();
  if (snap) console.error("Snapshots exist in " + config.BACKUP_DIR + " — newest: " + snap + ". Put the data back with: npm run backup -- --restore " + snap);
  console.error("If you really do mean to start from nothing, re-run with " + forceFlag + ".");
  process.exit(1);
}

/** Prints the target + any sibling-file warning; optionally refuses an absent database. */
function announce({ allowCreate = true, forceFlag = "--force" } = {}) {
  console.log("Database: " + describeTarget());
  const siblings = siblingDatabaseFiles();
  if (siblings.length) {
    console.warn("WARNING: this directory holds other SQLite databases that this command will NOT read:");
    for (const s of siblings) console.warn("  - " + s.file + " (" + Math.round(s.bytes / 1024) + " KB)");
    console.warn("If your data is in one of those, re-run with DATABASE_FILE=<that file>. See docs/PERSISTENCE.md.");
  }
  if (!allowCreate) requireExistingDatabase({ forceFlag });
  else if (config.DATABASE_DRIVER === "sqlite" && !fs.existsSync(config.DB_CONFIG.file) && !process.argv.includes(forceFlag)) {
    console.warn("NOTE: there is no database at " + config.DB_CONFIG.file + " yet — a new, empty one will be created.");
  }
  return siblings;
}

module.exports = { describeTarget, siblingDatabaseFiles, announce, requireExistingDatabase, maskUrl };
