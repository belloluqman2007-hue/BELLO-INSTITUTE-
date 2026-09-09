"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — configuration
   Reads and validates environment variables. This is the ONLY place where
   environment is interpreted. No old production values exist in this project.
   ========================================================================== */
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

const DB_CONFIG = {
  driver: DATABASE_DRIVER,
  url: DATABASE_URL,
  file: path.resolve(process.cwd(), String(process.env.DATABASE_FILE || "./data/madrasa_platform_dev.sqlite")),
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
const API_RATE_LIMIT = Number(process.env.API_RATE_LIMIT || 300);

/* ---------------------------------------------------------------------------
   UPLOADS
--------------------------------------------------------------------------- */
const UPLOAD_DIR = path.resolve(process.cwd(), String(process.env.UPLOAD_DIR || "./uploads"));
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

function validate() {
  const errors = [];
  if (IS_PRODUCTION) {
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
  validate,
  // Helper for generating secure random values (used by seed + docs).
  randomSecret: (bytes = 48) => crypto.randomBytes(bytes).toString("hex"),
};
