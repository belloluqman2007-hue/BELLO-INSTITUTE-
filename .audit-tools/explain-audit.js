#!/usr/bin/env node
/**
 * EXPLAIN audit for the hottest tenant-scoped queries.
 *
 * Runs EXPLAIN against the live MySQL load-test database (which holds the real
 * seeded volume: 55 madaris, ~10.9k students, ~129k attendance rows, ~44k
 * results) and flags any plan that would not scale:
 *
 *   - type = ALL            -> full table scan
 *   - key  = NULL           -> no index used
 *   - rows examined > ROW_BUDGET for a single-tenant lookup
 *
 * Read-only: it never modifies data or schema. Schema changes belong in
 * migrations, not here.
 *
 * Usage:
 *   source /opt/mysql-test/secrets/env.sh
 *   DB_NAME=bello_loadtest node .audit-tools/explain-audit.js
 */
"use strict";

const mysql = require("mysql2/promise");

const ROW_BUDGET = 20000; // ~2x the per-tenant student count; generous.

// Each query is shaped like the real route that issues it.
const QUERIES = [
  ["students: tenant list page",
    "SELECT id, admission_no, first_name, last_name FROM students WHERE madrasa_id = ? AND status = 'active' ORDER BY id DESC LIMIT 50", [1]],
  ["students: admission_no lookup",
    "SELECT * FROM students WHERE madrasa_id = ? AND admission_no = ?", [1, "ADM-0001"]],
  ["attendance: student history",
    "SELECT * FROM attendance WHERE madrasa_id = ? AND student_id = ? ORDER BY day DESC LIMIT 100", [1, 1]],
  ["attendance: class register for a day",
    "SELECT * FROM attendance WHERE madrasa_id = ? AND class_id = ? AND day = ?", [1, 1, "2026-01-15"]],
  ["results: student term results",
    "SELECT * FROM results WHERE madrasa_id = ? AND student_id = ? AND term_id = ?", [1, 1, 1]],
  ["results: class broadsheet",
    "SELECT * FROM results WHERE madrasa_id = ? AND class_id = ? AND term_id = ?", [1, 1, 1]],
  ["fee_assignments: outstanding balances",
    "SELECT * FROM fee_assignments WHERE madrasa_id = ? AND status <> 'reconciled' LIMIT 100", [1]],
  ["fee_payments: recent payments",
    "SELECT * FROM fee_payments WHERE madrasa_id = ? ORDER BY id DESC LIMIT 50", [1]],
  // The real login path (server/routes/auth.js) looks users up by username.
  ["users: login by username",
    "SELECT * FROM users WHERE username = ?", ["nobody"]],
  ["users: tenant staff list",
    "SELECT id, full_name, role FROM users WHERE madrasa_id = ? AND is_active = 1 LIMIT 100", [1]],
  ["activity_log: tenant audit trail",
    "SELECT * FROM activity_log WHERE madrasa_id = ? ORDER BY id DESC LIMIT 50", [1]],
  ["library_loans: active loans",
    "SELECT * FROM library_loans WHERE madrasa_id = ? AND status = 'active' LIMIT 100", [1]],
  ["announcements: tenant feed",
    "SELECT * FROM announcements WHERE madrasa_id = ? ORDER BY id DESC LIMIT 20", [1]],
  ["notifications: unread for a user",
    "SELECT * FROM notifications WHERE madrasa_id = ? AND recipient_user_id = ? AND read_at IS NULL LIMIT 50", [1, 1]],
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const findings = [];
  const rows = [];

  for (const [label, sql, params] of QUERIES) {
    let plan;
    try {
      const [r] = await conn.query("EXPLAIN " + sql, params);
      plan = r;
    } catch (e) {
      rows.push({ label, error: e.message });
      findings.push(`${label}: EXPLAIN failed -- ${e.message}`);
      continue;
    }
    for (const p of plan) {
      rows.push({
        label,
        table: p.table,
        type: p.type,
        key: p.key,
        rows: p.rows,
        filtered: p.filtered,
        extra: p.Extra,
      });
      // Derived/materialised rows have no base table to index.
      if (!p.table || String(p.table).startsWith("<")) continue;
      if (p.type === "ALL") findings.push(`${label}: FULL SCAN on ${p.table}`);
      else if (p.key === null) findings.push(`${label}: no index used on ${p.table} (type=${p.type})`);
      if (Number(p.rows) > ROW_BUDGET) findings.push(`${label}: examines ${p.rows} rows on ${p.table} (> ${ROW_BUDGET})`);
    }
  }

  const pad = (s, n) => String(s === null || s === undefined ? "-" : s).slice(0, n).padEnd(n);
  console.log(`EXPLAIN audit against ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT}\n`);
  console.log(pad("QUERY", 36), pad("TABLE", 18), pad("TYPE", 8), pad("KEY", 26), pad("ROWS", 8), "EXTRA");
  console.log("-".repeat(130));
  for (const r of rows) {
    if (r.error) { console.log(pad(r.label, 36), "ERROR:", r.error); continue; }
    console.log(pad(r.label, 36), pad(r.table, 18), pad(r.type, 8), pad(r.key, 26), pad(r.rows, 8), r.extra || "");
  }

  console.log("");
  if (findings.length) {
    console.log(`${findings.length} finding(s):`);
    for (const f of findings) console.log("  - " + f);
  } else {
    console.log("No full scans, unindexed lookups, or over-budget plans found.");
  }
  await conn.end();
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
