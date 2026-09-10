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

const DB_CONFIG = {
  driver: DATABASE_DRIVER,
  url: DATABASE_URL,
  // An explicit DATABASE_FILE keeps its historic meaning: absolute paths stay
  // absolute, relative ones resolve against the working directory. When unset,
  // the database lives inside DATA_DIR.
  file: process.env.DATABASE_FILE
    ? path.resolve(process.cwd(), String(process.env.DATABASE_FILE))
    : path.join(DATA_DIR, NODE_ENV === "production" ? "madrasa_platform.sqlite" : "madrasa_platform_dev.sqlite"),
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

const SUPER_ADMIN_USERNAME = String(process.env.SUPER_ADMIN_USERNAME || "admin").trim();
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
    if (!fs.existsSync(DB_CONFIG.file)) {
      warnings.push("No database file yet at " + DB_CONFIG.file + " — a fresh, empty database is being created.");
    }
  }
  return warnings;
}

function isUnder(child, parent) {
  const c = path.resolve(child), p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function validate() {
  const errors = [];
  if (IS_PRODUCTION) {
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
  isUnder,
  persistenceWarnings,
  validate,
  // Helper for generating secure random values (used by seed + docs).
  randomSecret: (bytes = 48) => crypto.randomBytes(bytes).toString("hex"),
};
