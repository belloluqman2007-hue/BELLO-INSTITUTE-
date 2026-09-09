"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — database access layer
   ----------------------------------------------------------------------------
   One async API over two drivers:
     • sqlite — Node's built-in node:sqlite (development, zero config)
     • mysql  — mysql2 promise pool (production, NEW database only)

   The connection is built ONLY from server/config.js (environment variables).
   There is no fallback to any other database and no hardcoded credentials.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const config = require("./config");

let driver = null;

async function connect() {
  if (driver) return driver;
  if (config.DB_CONFIG.driver === "sqlite") driver = connectSqlite();
  else driver = await connectMysql();
  return driver;
}

/* ----------------------------- SQLite ---------------------------------- */
function connectSqlite() {
  const { DatabaseSync } = require("node:sqlite");
  const file = config.DB_CONFIG.file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");

  return {
    dialect: "sqlite",
    async all(sql, params = []) {
      return raw.prepare(sql).all(...normalizeSqliteParams(params));
    },
    async get(sql, params = []) {
      return raw.prepare(sql).get(...normalizeSqliteParams(params)) ?? null;
    },
    async run(sql, params = []) {
      const info = raw.prepare(sql).run(...normalizeSqliteParams(params));
      return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
    },
    // Runs fn inside a SQLite transaction; rolls back on throw.
    async transaction(fn) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(api);
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        try { raw.exec("ROLLBACK"); } catch (_) { /* already rolled back */ }
        throw err;
      }
    },
    async close() { raw.close(); },
    _raw: raw,
  };
}

function normalizeSqliteParams(params) {
  // node:sqlite accepts a spread of individual bind values.
  // Arrays/objects are JSON-encoded so callers can pass JSON columns easily.
  return (Array.isArray(params) ? params : [params]).map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p === "object") return JSON.stringify(p);
    return p;
  });
}

/* ----------------------------- MySQL ----------------------------------- */
async function connectMysql() {
  const mysql = require("mysql2/promise");
  const ssl = config.DB_CONFIG.ssl ? { rejectUnauthorized: false } : undefined;
  let pool;
  if (config.DATABASE_URL) {
    pool = mysql.createPool(Object.assign({ uri: config.DATABASE_URL }, { ssl, connectionLimit: 10 }));
  } else {
    const { host, port, user, password, name } = config.DB_CONFIG;
    pool = mysql.createPool({
      host, port, user, password, database: name,
      ssl, connectionLimit: 10,
      namedPlaceholders: false,
    });
  }

  const db = {
    dialect: "mysql",
    _pool: pool,
    async all(sql, params = []) {
      const [rows] = await pool.query(sql, normalizeMysqlParams(params));
      return rows;
    },
    async get(sql, params = []) {
      const [rows] = await pool.query(sql, normalizeMysqlParams(params));
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async run(sql, params = []) {
      const [result] = await pool.execute(sql, normalizeMysqlParams(params));
      return { changes: result.affectedRows ?? 0, lastInsertRowid: result.insertId ?? 0 };
    },
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const api = {
          dialect: "mysql",
          _conn: conn,
          async all(sql, p = []) { const [r] = await conn.query(sql, normalizeMysqlParams(p)); return r; },
          async get(sql, p = []) { const [r] = await conn.query(sql, normalizeMysqlParams(p)); return Array.isArray(r) && r.length ? r[0] : null; },
          async run(sql, p = []) { const [r] = await conn.execute(sql, normalizeMysqlParams(p)); return { changes: r.affectedRows ?? 0, lastInsertRowid: r.insertId ?? 0 }; },
        };
        const result = await fn(api);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() { await pool.end(); },
  };
  // Fail fast with a clear message if the (new) database is unreachable.
  await db.get("SELECT 1 AS ok");
  return db;
}

function normalizeMysqlParams(params) {
  const arr = Array.isArray(params) ? params : [params];
  return arr.map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p === "object") return JSON.stringify(p);
    return p;
  });
}

/* ----------------------------- Shared API ------------------------------ */
const api = {
  /** Returns all matching rows. */
  async all(sql, params) { const d = await connect(); return d.all(sql, params || []); },
  /** Returns the first matching row or null. */
  async get(sql, params) { const d = await connect(); return d.get(sql, params || []); },
  /** Executes a write. Returns { changes, lastInsertRowid }. */
  async run(sql, params) { const d = await connect(); return d.run(sql, params || []); },
  /** INSERT that silently skips on unique-key conflict (dialect-aware). */
  async insertIgnore(table, columns, values) {
    const d = await connect();
    const ph = values.map(() => "?").join(",");
    const sql = d.dialect === "sqlite"
      ? `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${ph})`
      : `INSERT IGNORE INTO ${table} (${columns}) VALUES (${ph})`;
    return d.run(sql, values);
  },
  /** Runs fn(sql, params) inside a transaction. */
  async transaction(fn) {
    const d = await connect();
    if (d.transaction) return d.transaction(fn);
    throw new Error("Driver does not support transactions");
  },
  /** Dialect string: "sqlite" | "mysql" */
  async dialect() { const d = await connect(); return d.dialect; },
  async close() { if (driver && driver.close) await driver.close(); driver = null; },
};

module.exports = api;
