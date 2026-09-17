"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — configuration
   Reads and validates environment variables. This is the ONLY place where
   environment is interpreted. No old production values exist in this project.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config();

const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
// Render sets RENDER=true for every runtime. We use this documented signal for
// the strict disk guard below; other hosts retain the diagnostic warning unless
// their deployment policy elects to enforce an equivalent check.
const IS_RENDER = ["1", "true", "yes"].includes(String(process.env.RENDER || "").trim().toLowerCase());
const PORT = Number(process.env.PORT || 3000);

/* ---------------------------------------------------------------------------
   DATABASE
   driver: "sqlite" (development, zero-config) or "mysql" (production).
   The app only ever opens the database configured here.
--------------------------------------------------------------------------- */
const DATABASE_DRIVER = String(process.env.DATABASE_DRIVER || "sqlite").trim().toLowerCase();
if (!["sqlite", "mysql"].includes(DATABASE_DRIVER)) {
  console.error(`FATAL: DATABASE_DRIVER must be "sqlite" or "mysql" (got "${DATABASE_DRIVER}").`);
  process.exit(1);
}

let DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
// Accept mysql://, mysql2:// and mariadb:// schemes uniformly.
DATABASE_URL = DATABASE_URL.replace(/^mysql2:\/\//, "mysql://").replace(/^mariadb:\/\//, "mysql://");

/* ---------------------------------------------------------------------------
   DATA / BACKUPS
   Everything the app writes to disk (the dev SQLite file, upload images and
   JSON backups) lives under DATA_DIR unless an explicit path is given.
   On hosts with an ephemeral filesystem (Render without a persistent disk,
   Fly without a volume, most Docker runs) anything outside a mounted volume
   is WIPED on every deploy/restart — that is what makes "I added a madrasa
   and later it was gone" happen. PERSISTENT_VOLUME_DIR points at the mounted
   volume so the app can tell the operator, loudly, when it is writing to a
   throwaway directory. See docs/PERSISTENCE.md.
--------------------------------------------------------------------------- */
const DATA_DIR = path.resolve(process.cwd(), String(process.env.DATA_DIR || "./data"));
const BACKUP_DIR = path.resolve(process.cwd(), String(process.env.BACKUP_DIR || path.join(DATA_DIR, "backups")));
const PERSISTENT_VOLUME_DIR = path.resolve(String(process.env.PERSISTENT_VOLUME_DIR || "/var/data"));
// How often (minutes) a JSON snapshot of the whole database is written to
// BACKUP_DIR. 0 disables the timer. `npm run backup` writes one on demand.
const BACKUP_INTERVAL_MINUTES = Number(process.env.BACKUP_INTERVAL_MINUTES || 360);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 10);
// Set to 1 when the host's disk is known to survive restarts (a VPS with the
// data directory on the machine's own volume). Silences the ephemeral-storage
// warnings — it does NOT disable backups.
const DATA_PERSISTENT_ACK = ["1", "true", "yes"].includes(String(process.env.DATA_PERSISTENT_ACK || "").toLowerCase());
// When a boot finds a COMPLETELY EMPTY database but a snapshot with real rows
// in BACKUP_DIR, restore that snapshot instead of staying empty. That is what
// puts "the madrasa I added" back after the host wiped the file — or after the
// app booted on the wrong one. The restore takes its own `pre-restore`
// snapshot first, so it can always be undone. Set to 0 to disable.
const AUTO_RESTORE_ON_EMPTY_DB = !["0", "false", "no"].includes(String(process.env.AUTO_RESTORE_ON_EMPTY_DB || "1").toLowerCase());

/* ---------------------------------------------------------------------------
   WHICH SQLITE FILE?  (this is where "my madrasa disappeared" used to come from)
   The file name used to depend on NODE_ENV: production read
   `madrasa_platform.sqlite`, everything else read `madrasa_platform_dev.sqlite`.
   Switching NODE_ENV — or running a CLI in a shell that does not carry the
   service's env — therefore did NOT fail: it silently created a brand-new,
   EMPTY database next to the real one, and every madrasa, user and result
   "vanished" (until the next boot with the other NODE_ENV, when they were back
   again). The name must never depend on anything the operator has to remember.

   Resolution order (deterministic, data-preserving):
     1. an explicit DATABASE_FILE always wins (relative paths resolve against cwd);
     2. the canonical DATA_DIR/madrasa_platform.sqlite if it exists;
     3. otherwise a legacy, env-suffixed file that already exists — so an
        existing installation keeps its data instead of booting on an empty one;
     4. otherwise the canonical path (a genuinely new database).
   Any other *.sqlite found alongside is reported, never opened.
--------------------------------------------------------------------------- */
const SQLITE_FILE_BASENAME = "madrasa_platform.sqlite";
/** File names older builds of this app picked, per environment. */
const SQLITE_LEGACY_BASENAMES = [
  "madrasa_platform_dev.sqlite",           // every non-production NODE_ENV
  "madrasa_platform_test.sqlite",
  "madrasa_platform_production.sqlite",
  "madrasa_platform_prod.sqlite",
];

/**
 * Pure + injectable so it can be unit-tested without touching the real disk.
 * Returns { file, reason, usedLegacy, otherFiles }.
 */
function resolveSqliteDatabaseFile(options = {}) {
  const opts = options || {};
  const fsImpl = opts.fs || fs;
  const dataDir = path.resolve(opts.dataDir || DATA_DIR);
  const nodeEnv = String(opts.nodeEnv || NODE_ENV || "development").toLowerCase();
  const cwd = opts.cwd || process.cwd();
  const explicit = opts.explicit !== undefined ? opts.explicit : process.env.DATABASE_FILE;

  const listDir = (dir) => {
    try { return fsImpl.readdirSync(dir); } catch (e) { return []; }
  };
  const statOf = (full) => {
    try { return fsImpl.statSync(full); } catch (e) { return null; }
  };
  const describe = (dir, names) => names.map((name) => {
    const st = statOf(path.join(dir, name));
    return { name, bytes: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0 };
  });

  if (explicit) {
    const file = path.resolve(cwd, String(explicit));
    const dir = path.dirname(file);
    const others = describe(dir, listDir(dir).filter((n) => /\.sqlite$/i.test(n) && path.join(dir, n) !== file));
    return { file, reason: "explicit DATABASE_FILE", usedLegacy: false, otherFiles: others };
  }

  const canonical = path.join(dataDir, SQLITE_FILE_BASENAME);
  const present = listDir(dataDir).filter((n) => /\.sqlite$/i.test(n));
  const legacy = present.filter((n) => n !== SQLITE_FILE_BASENAME && SQLITE_LEGACY_BASENAMES.includes(n));
  const others = describe(dataDir, present.filter((n) => n !== SQLITE_FILE_BASENAME && !legacy.includes(n)));

  if (present.includes(SQLITE_FILE_BASENAME)) {
    const legacyOthers = describe(dataDir, legacy);
    return { file: canonical, reason: "canonical file in DATA_DIR", usedLegacy: false, otherFiles: others.concat(legacyOthers) };
  }
  if (legacy.length) {
    // Prefer the file an older build would have used for THIS environment, then
    // the most recently written one. Never create a new empty database while a
    // populated legacy file sits in the same directory.
    const preferred = nodeEnv === "production" ? "" : "madrasa_platform_dev.sqlite";
    const ranked = describe(dataDir, legacy).sort((a, b) => {
      const pa = a.name === preferred ? 0 : 1;
      const pb = b.name === preferred ? 0 : 1;
      return pa - pb || b.mtimeMs - a.mtimeMs;
    });
    const chosen = ranked[0];
    return {
      file: path.join(dataDir, chosen.name),
      reason: "legacy database file (no " + SQLITE_FILE_BASENAME + " here yet)",
      usedLegacy: true,
      otherFiles: ranked.slice(1).concat(others),
    };
  }
  return { file: canonical, reason: "new database in DATA_DIR", usedLegacy: false, otherFiles: others };
}

const SQLITE_DB = resolveSqliteDatabaseFile();

const DB_CONFIG = {
  driver: DATABASE_DRIVER,
  url: DATABASE_URL,
  // An explicit DATABASE_FILE keeps its historic meaning: absolute paths stay
  // absolute, relative ones resolve against the working directory. When unset,
  // the database lives inside DATA_DIR — under ONE name for every environment.
  file: SQLITE_DB.file,
  host: String(process.env.DB_HOST || "").trim(),
  port: Number(process.env.DB_PORT || 3306),
  user: String(process.env.DB_USER || "").trim(),
  password: String(process.env.DB_PASSWORD || "").trim(),
  name: String(process.env.DB_NAME || "").trim(),
  ssl: String(process.env.DB_SSL || "false").toLowerCase() !== "false",
};

/* ---------------------------------------------------------------------------
   AUTH / SECRETS
--------------------------------------------------------------------------- */
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_HOURS || 12) * 60 * 60 * 1000;

// Usernames are stored and compared in lower case (POST /api/auth/login
// lower-cases whatever is typed). A configured "Admin"/"ADMIN" would therefore
// create an account NOTHING can ever match — the login form would reject the
// only credentials that exist, silently. Normalise here, once.
const SUPER_ADMIN_USERNAME = String(process.env.SUPER_ADMIN_USERNAME || "admin").trim().toLowerCase();
const SUPER_ADMIN_PASSWORD = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();

/* ---------------------------------------------------------------------------
   PUBLIC URL / API BASE / CORS
--------------------------------------------------------------------------- */
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
// Base URL of the API as seen by the BROWSER.
//   blank  -> same-origin "/api" (the normal case: this server serves the UI)
//   e.g.   -> https://api.your-new-domain for a separately hosted API
const API_BASE_URL = String(process.env.API_BASE_URL || "").trim().replace(/\/+$/, "");
const EFFECTIVE_API_BASE = API_BASE_URL || "/api";
const PAYSTACK_SECRET_KEY = String(process.env.PAYSTACK_SECRET_KEY || "").trim();
const PAYSTACK_PUBLIC_KEY = String(process.env.PAYSTACK_PUBLIC_KEY || "").trim();
const FLUTTERWAVE_SECRET_KEY = String(process.env.FLUTTERWAVE_SECRET_KEY || "").trim();
const FLUTTERWAVE_PUBLIC_KEY = String(process.env.FLUTTERWAVE_PUBLIC_KEY || "").trim();
const PAYMENT_GATEWAY = ["paystack", "flutterwave", "none"].includes(String(process.env.PAYMENT_GATEWAY || "none").toLowerCase()) ? String(process.env.PAYMENT_GATEWAY || "none").toLowerCase() : "none";
const PAYMENT_CALLBACK_URL = String(process.env.PAYMENT_CALLBACK_URL || "").trim();
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

/* ---------------------------------------------------------------------------
   RATE LIMITING
--------------------------------------------------------------------------- */
const LOGIN_RATE_LIMIT = Number(process.env.LOGIN_RATE_LIMIT || 10);
// Development gets room to breathe: the end-to-end smoke script and a dev
// clicking around must not be throttled by a limit meant for the internet.
const API_RATE_LIMIT = Number(process.env.API_RATE_LIMIT || (IS_PRODUCTION ? 300 : 5000));

/* ---------------------------------------------------------------------------
   UPLOADS
--------------------------------------------------------------------------- */
// Uploads default to DATA_DIR/uploads so that ONE mounted volume covers the
// dev database, the images and the backups (see docs/PERSISTENCE.md).
const UPLOAD_DIR = path.resolve(process.cwd(), String(process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads")));
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);

/* ---------------------------------------------------------------------------
   OPTIONAL: AI (opt-in, disabled unless AI_API_KEY is set)
--------------------------------------------------------------------------- */
const AI = {
  apiKey: String(process.env.AI_API_KEY || "").trim(),
  baseUrl: String(process.env.AI_BASE_URL || "").trim().replace(/\/+$/, ""),
  model: String(process.env.AI_MODEL || "").trim(),
  get enabled() { return !!(this.apiKey && this.baseUrl); },
};

/**
 * Production validation.
 * A misconfigured production database must fail loudly at boot instead of
 * silently writing to a throwaway file — the single most common way tenants
 * "disappear" is an ephemeral SQLite file being wiped on the next deploy.
 */
/* ---------------------------------------------------------------------------
   PERSISTENCE CHECK (dev + production)
   Returns human-readable warnings about storage that will not survive a
   restart. Deliberately warnings (not fatal): taking a live site down is
   worse than a loud log line + the banner the UI shows from
   GET /api/platform/diagnostics.
--------------------------------------------------------------------------- */
function persistenceWarnings() {
  const warnings = [];
  const externalDb = DATABASE_DRIVER === "mysql";
  if (externalDb && !DATABASE_URL && !(DB_CONFIG.host && DB_CONFIG.user && DB_CONFIG.name)) {
    warnings.push("DATABASE_DRIVER=mysql but no DATABASE_URL / DB_* is set — the app cannot reach a database.");
  }
  if (!externalDb) {
    const onVolume = isUnder(DB_CONFIG.file, PERSISTENT_VOLUME_DIR);
    if (!onVolume && !DATA_PERSISTENT_ACK) {
      warnings.push(
        "SQLite database \"" + DB_CONFIG.file + "\" is NOT under the persistent volume (" + PERSISTENT_VOLUME_DIR + "). " +
        "On hosts with an ephemeral filesystem (Render without a disk, Railway/Fly without a volume, Docker) every " +
        "madrasa, user and result you create is DELETED on the next deploy or restart. " +
        "Fix: attach a persistent disk and set DATA_DIR (and DATABASE_FILE) to it, or point DATABASE_URL at MySQL. " +
        "See docs/PERSISTENCE.md."
      );
    }
    if (SQLITE_DB.usedLegacy) {
      warnings.push(
        "Using the existing database file \"" + path.basename(DB_CONFIG.file) + "\" in " + DATA_DIR + " because there is no " +
        SQLITE_FILE_BASENAME + " yet. Your data was found; rename the file to " + SQLITE_FILE_BASENAME +
        " (stop the app first) or set DATABASE_FILE to pin it."
      );
    }
    if (SQLITE_DB.otherFiles && SQLITE_DB.otherFiles.length) {
      warnings.push(
        "Other SQLite files in " + path.dirname(DB_CONFIG.file) + " that this app does NOT open: " +
        SQLITE_DB.otherFiles.map((f) => f.name + " (" + Math.round(f.bytes / 1024) + " KB)").join(", ") +
        ". If your madaris seem missing, they may be in one of those — run " +
        "\"npm run backup -- --list\" to inspect them or set DATABASE_FILE. Never two at once: keep one file."
      );
    }
    if (!fs.existsSync(DB_CONFIG.file)) {
      const snap = newestSnapshotFile();
      warnings.push(
        "No database file yet at " + DB_CONFIG.file + " — a fresh, empty database is being created." +
        (snap
          ? " Snapshots DO exist in " + BACKUP_DIR + " (newest: " + snap + "); the app will restore it automatically " +
            "on this boot if the new database is empty, or run \"npm run backup -- --restore " + snap + "\"."
          : "")
      );
    }
  }
  return warnings;
}

/** Newest snapshot name in BACKUP_DIR, or null. Names sort chronologically. */
function newestSnapshotFile(dir) {
  try {
    const names = fs.readdirSync(dir || BACKUP_DIR).filter((n) => /^snapshot-.*\.json$/.test(n)).sort();
    return names.length ? names[names.length - 1] : null;
  } catch (e) {
    return null;
  }
}

function isUnder(child, parent) {
  const c = path.resolve(child), p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * Production must never silently create a SQLite database on Render's
 * container filesystem. Checking only the configured path is insufficient:
 * `/var/data` can be an ordinary directory on the container root when an
 * operator skipped the Render disk. Ask the storage probe which mount actually
 * backs the SQLite file's directory before migrations or seeds can write any
 * records.
 *
 * The optional probe makes the decision easy to exercise in unit tests. A
 * null/unknown answer is left as a warning so non-Linux hosts are not rejected
 * merely because they cannot expose mount information.
 */
function sqlitePersistenceError(probe) {
  // Render's container filesystem is always disposable. On other production
  // hosts the existing diagnostics stay visible, but we cannot safely infer a
  // host's persistence policy from one mount-table shape alone.
  if (!IS_RENDER || DATABASE_DRIVER !== "sqlite" || DATA_PERSISTENT_ACK) return null;
  if (!isUnder(DB_CONFIG.file, PERSISTENT_VOLUME_DIR)) {
    return "SQLite database \"" + DB_CONFIG.file + "\" is outside PERSISTENT_VOLUME_DIR (" +
      PERSISTENT_VOLUME_DIR + "). Attach a persistent disk and set DATA_DIR/DATABASE_FILE to its mount, " +
      "or set DATABASE_DRIVER=mysql with DATABASE_URL.";
  }

  let storage = probe;
  if (!storage) {
    try {
      // Lazy import avoids a config <-> persistence module cycle while this
      // file is first being evaluated. validate() runs after config exports.
      storage = require("./services/persistence").describeStorage(path.dirname(DB_CONFIG.file));
    } catch (e) {
      return null;
    }
  }
  if (storage && storage.onPersistentVolume === false) {
    const mount = storage.mountPoint || "/";
    const type = storage.fsType || "unknown";
    return "SQLite database \"" + DB_CONFIG.file + "\" is on non-persistent storage (mount \"" +
      mount + "\", type \"" + type + "\"). Refusing to start production because a Render redeploy would " +
      "erase every madrasa. Attach the Render disk at " + PERSISTENT_VOLUME_DIR +
      " and keep DATA_DIR there, or configure DATABASE_DRIVER=mysql and DATABASE_URL.";
  }
  return null;
}

function validate() {
  const errors = [];
  if (IS_PRODUCTION) {
    // Fail before migrations, seed data or a state marker can create a new
    // empty SQLite file on an ephemeral Render container. This turns the old
    // "institutions disappeared after deploy" symptom into an actionable
    // deployment failure instead of permanent data loss.
    const sqliteStorageError = sqlitePersistenceError();
    if (sqliteStorageError) errors.push(sqliteStorageError);
    for (const w of persistenceWarnings()) console.warn("WARNING: " + w);
    if (SESSION_SECRET.length < 32) errors.push("SESSION_SECRET must be at least 32 characters in production.");
    if (DATABASE_DRIVER === "mysql" && !DATABASE_URL && !(DB_CONFIG.host && DB_CONFIG.user && DB_CONFIG.password && DB_CONFIG.name)) {
      errors.push("MySQL production requires DATABASE_URL or DB_HOST+DB_USER+DB_PASSWORD+DB_NAME.");
    }
    if (SESSION_SECRET === "CHANGE_ME__generate_a_long_random_string__at_least_32_chars") {
      errors.push("SESSION_SECRET still has the template value — generate a real secret.");
    }
    if (SUPER_ADMIN_PASSWORD === "CHANGE_ME__choose_a_strong_password") {
      errors.push("SUPER_ADMIN_PASSWORD still has the template value.");
    }
  }
  if (errors.length) {
    console.error("FATAL: invalid configuration:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  return true;
}

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  IS_RENDER,
  PORT,
  DATABASE_DRIVER,
  DATABASE_URL,
  DB_CONFIG,
  API_BASE_URL,
  EFFECTIVE_API_BASE,
  SESSION_SECRET,
  SESSION_MAX_AGE_MS,
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_PASSWORD,
  PUBLIC_URL,
  CORS_ORIGINS,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY,
  FLUTTERWAVE_SECRET_KEY,
  FLUTTERWAVE_PUBLIC_KEY,
  PAYMENT_GATEWAY,
  PAYMENT_CALLBACK_URL,
  LOGIN_RATE_LIMIT,
  API_RATE_LIMIT,
  UPLOAD_DIR,
  MAX_UPLOAD_MB,
  AI,
  DATA_DIR,
  BACKUP_DIR,
  BACKUP_INTERVAL_MINUTES,
  BACKUP_KEEP,
  PERSISTENT_VOLUME_DIR,
  DATA_PERSISTENT_ACK,
  AUTO_RESTORE_ON_EMPTY_DB,
  SQLITE_FILE_BASENAME,
  SQLITE_LEGACY_BASENAMES,
  SQLITE_DB,
  resolveSqliteDatabaseFile,
  isUnder,
  sqlitePersistenceError,
  persistenceWarnings,
  newestSnapshotFile,
  validate,
  // Helper for generating secure random values (used by seed + docs).
  randomSecret: (bytes = 48) => crypto.randomBytes(bytes).toString("hex"),
};
