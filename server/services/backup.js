"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — backups (JSON snapshots) & one-click restore
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
   Data that "disappears" is data written to storage the host is allowed to
   throw away (see services/persistence.js). Snapshots are the safety net:

     • the whole database is exported to one portable JSON document — works
       identically on SQLite and MySQL, and can be downloaded to a laptop
     • a snapshot is written before every migration, on a timer, on graceful
       shutdown and on demand from Platform → Backups
     • restoring is explicit (super admin, confirmed) and takes its own
       "before restore" snapshot first, so a restore can always be undone

   Format: { format: "madrasa-platform-backup/1", createdAt, counts, tables }
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const config = require("../config");

const FORMAT = "madrasa-platform-backup/1";

/* Restore order: parents before children (MySQL enforces FKs even in a
   transaction), and the tenant table before anything that references it. */
const TABLE_ORDER = [
  "schema_migrations", "plans", "madaris", "users", "academic_sessions", "terms",
  "classes", "subjects", "class_subjects", "teacher_assignments", "students",
  "parent_links", "fee_items", "fee_payments", "grading_config", "results",
  "term_summaries", "attendance", "announcements", "settings", "platform_settings",
  "admission_requests", "timetable_slots", "activity_log",
];
/* Never part of a snapshot: login state is not data. */
const SKIP_TABLES = new Set(["app_sessions"]);

function stamp(d = new Date()) {
  // Milliseconds are part of the name on purpose: two snapshots taken in the
  // same second (a manual one right after the pre-migration one, a restore
  // safety copy followed by another) would otherwise overwrite each other and
  // silently lose one of them.
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 23);
}
function fileName(d, reason) {
  return "snapshot-" + stamp(d) + "-" + String(reason || "manual").replace(/[^a-z0-9-]/gi, "") + ".json";
}
function ensureDir() {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  return config.BACKUP_DIR;
}

/** All user tables in the live database (dialect-aware discovery). */
async function discoverTables(db) {
  const dialect = await db.dialect();
  let names;
  if (dialect === "sqlite") {
    const rows = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    names = rows.map((r) => r.name);
  } else {
    const rows = await db.all("SHOW TABLES");
    names = rows.map((r) => Object.values(r)[0]);
  }
  const known = names.filter((n) => !SKIP_TABLES.has(n));
  const ordered = TABLE_ORDER.filter((t) => known.includes(t));
  const extra = known.filter((t) => !TABLE_ORDER.includes(t)).sort();
  return ordered.concat(extra);
}

/** Builds the snapshot object (also used for the download endpoint). */
async function buildSnapshot(db, meta = {}) {
  const tables = await discoverTables(db);
  const out = {};
  const counts = {};
  for (const t of tables) {
    const rows = await db.all("SELECT * FROM " + t);
    out[t] = rows;
    counts[t] = rows.length;
  }
  return {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    reason: meta.reason || "manual",
    app: {
      driver: await db.dialect(),
      env: config.NODE_ENV,
      node: process.version,
      host: require("os").hostname(),
    },
    counts,
    tables: out,
  };
}

/** Writes a snapshot to BACKUP_DIR and prunes old ones. Returns its name. */
async function writeSnapshot(db, { reason = "manual", keep = config.BACKUP_KEEP } = {}) {
  const snapshot = await buildSnapshot(db, { reason });
  const dir = ensureDir();
  const name = fileName(new Date(), reason);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(snapshot));
  prune(keep);
  return { name, path: path.join(dir, name), bytes: fs.statSync(path.join(dir, name)).size, counts: snapshot.counts };
}

/** Keeps the newest `keep` snapshots (never deletes a "pre-restore"/"pre-migration"). */
function prune(keep = config.BACKUP_KEEP) {
  const dir = ensureDir();
  const all = listSync();
  const prunable = all.filter((f) => !/pre-(restore|migration)/.test(f.name));
  let removed = 0;
  for (const f of prunable.slice(Math.max(0, keep))) {
    try { fs.unlinkSync(path.join(dir, f.name)); removed++; } catch (e) { /* ignore */ }
  }
  return removed;
}

function safeName(name) {
  const n = path.basename(String(name || ""));
  if (!/^snapshot-[A-Za-z0-9._-]+\.json$/.test(n)) return null;
  return n;
}

/** Newest first. */
function listSync() {
  const dir = ensureDir();
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (e) { return []; }
  return entries
    .filter(safeName)
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      let counts = null;
      let createdAt = st.mtime.toISOString();
      // Reading the header of every file is cheap for small snapshots.
      try {
        const raw = fs.readFileSync(path.join(dir, name), "utf8");
        if (raw.length < 40 * 1024 * 1024) {
          const parsed = JSON.parse(raw);
          counts = parsed.counts || null;
          createdAt = parsed.createdAt || createdAt;
        }
      } catch (e) { /* fall back to file times */ }
      return { name, bytes: st.size, createdAt, counts, path: path.join(dir, name) };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function readSnapshot(name) {
  const n = safeName(name);
  if (!n) throw Object.assign(new Error("Invalid backup file name."), { status: 400 });
  const file = path.join(config.BACKUP_DIR, n);
  if (!fs.existsSync(file)) throw Object.assign(new Error("Backup file not found."), { status: 404 });
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || parsed.format !== FORMAT) throw Object.assign(new Error("Unrecognised backup format."), { status: 400 });
  return parsed;
}

/**
 * Replaces the whole database with a snapshot.
 * `dryRun` returns what WOULD change. Restoring takes a safety snapshot first.
 */
async function restore(db, source, { dryRun = false } = {}) {
  const snapshot = typeof source === "string" ? readSnapshot(source) : source;
  if (!snapshot || snapshot.format !== FORMAT) throw Object.assign(new Error("Unrecognised backup format."), { status: 400 });
  const liveTables = await discoverTables(db);
  const wanted = Object.keys(snapshot.tables || {});
  const plan = {
    wouldReplace: wanted.filter((t) => (snapshot.tables[t] || []).length),
    wouldClear: liveTables.filter((t) => !(t in (snapshot.tables || {}))),
    unknown: wanted.filter((t) => !liveTables.includes(t)),
    counts: snapshot.counts || {},
  };
  if (dryRun) return Object.assign({ ok: true, dryRun: true }, plan);

  if (plan.unknown.length) {
    // A backup from a newer app version may contain tables this build does not
    // know about; refuse rather than silently dropping that data.
    throw Object.assign(new Error("Backup contains tables this version does not know: " + plan.unknown.join(", ")), { status: 409 });
  }

  const safety = await writeSnapshot(db, { reason: "pre-restore", keep: 50 });

  // Order: delete children first, insert parents first.
  const deleteOrder = liveTables.slice().reverse();
  const insertOrder = TABLE_ORDER.filter((t) => wanted.includes(t)).concat(wanted.filter((t) => !TABLE_ORDER.includes(t)).sort());
  const dialect = await db.dialect();

  // Table order keeps referential integrity satisfied without disabling FK
  // checks: children are cleared before parents, parents refilled first.
  await db.transaction(async (tx) => {
    for (const t of deleteOrder) await tx.run("DELETE FROM " + t);
    for (const t of insertOrder) {
      const rows = snapshot.tables[t] || [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const vals = cols.map((c) => (row[c] && typeof row[c] === "object" && !(row[c] instanceof Date) ? JSON.stringify(row[c]) : row[c] instanceof Date ? row[c].toISOString().slice(0, 19).replace("T", " ") : row[c]));
        const ph = cols.map(() => "?").join(",");
        const quoted = dialect === "mysql" ? cols.map((c) => "`" + c + "`") : cols.map((c) => '"' + c + '"');
        await tx.run(`INSERT INTO ${t} (${quoted.join(",")}) VALUES (${ph})`, vals);
      }
    }
  });

  return { ok: true, restored: plan.wouldReplace, cleared: plan.wouldClear, safetySnapshot: safety.name, counts: snapshot.counts };
}

/** Imports a snapshot document from disk/JSON text without touching the DB. */
function parseJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw Object.assign(new Error("That file is not valid JSON."), { status: 400 }); }
  if (!parsed || parsed.format !== FORMAT) {
    throw Object.assign(new Error("Not a platform backup (expected format " + FORMAT + ")."), { status: 400 });
  }
  return parsed;
}

/* ------------------------------- timers --------------------------------- */
let timer = null;

/** Starts the periodic snapshot + snapshot-on-shutdown behaviour. */
function startAutoBackup(db) {
  const minutes = Number(config.BACKUP_INTERVAL_MINUTES || 0);
  if (minutes > 0 && !timer) {
    timer = setInterval(() => {
      writeSnapshot(db, { reason: "scheduled" })
        .then((r) => console.log("Backup written: " + r.name + " (" + r.bytes + " bytes)"))
        .catch((e) => console.error("Scheduled backup failed:", e.message));
    }, minutes * 60 * 1000);
    if (timer.unref) timer.unref();
  }
  return () => stopAutoBackup();
}

function stopAutoBackup() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Snapshot taken before migrations (and whenever we are about to mutate data). */
async function snapshotBefore(db, reason) {
  try {
    // Nothing worth saving in a database that has no tables yet.
    const tables = await discoverTables(db).catch(() => []);
    if (!tables.length) return null;
    return await writeSnapshot(db, { reason, keep: 20 });
  } catch (e) {
    console.error("Snapshot (" + reason + ") failed:", e.message);
    return null;
  }
}

module.exports = {
  FORMAT,
  TABLE_ORDER,
  buildSnapshot,
  writeSnapshot,
  snapshotBefore,
  listSync,
  readSnapshot,
  restore,
  parseJson,
  prune,
  discoverTables,
  startAutoBackup,
  stopAutoBackup,
};
