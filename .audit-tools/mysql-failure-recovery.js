#!/usr/bin/env node
/**
 * MySQL failure / recovery test.
 *
 * Verifies what the app does when the database goes away underneath it, and
 * that it recovers on its own once MySQL comes back — without a restart.
 *
 *   1. Baseline: the app serves requests normally.
 *   2. Kill every pooled connection server-side (KILL CONNECTION on each of
 *      the app's threads). This is what a MySQL restart, a failover, or an
 *      idle-timeout reaper looks like to the client.
 *   3. While broken, requests must fail CLEANLY (HTTP 5xx / JSON error), not
 *      hang forever and not leak a stack trace to the user.
 *   4. After the kill, subsequent requests must succeed again as mysql2
 *      re-establishes pooled connections.
 *   5. Data written before the failure must still be readable afterwards
 *      (nothing silently lost, no half-committed state).
 *
 * Usage:
 *   source /opt/mysql-test/secrets/env.sh
 *   DB_NAME=bello_loadtest BASE=http://127.0.0.1:3100 \
 *     node .audit-tools/mysql-failure-recovery.js
 */
"use strict";

const mysql = require("mysql2/promise");

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const ACCOUNTS = require("../loadtest/accounts.json");
const PASSWORD = ACCOUNTS.testPassword;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function admin() {
  return mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

async function login() {
  const user = ACCOUNTS.users.find((u) => u.role !== "public");
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user.username, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error("login failed: " + res.status);
  // Node's fetch folds multiple Set-Cookie headers; getSetCookie() is the only
  // way to read them reliably (headers.get("set-cookie") can return null).
  const raw = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie") || ""];
  const cookie = raw.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("login succeeded but returned no session cookie");
  return cookie;
}

// A cheap authenticated read that definitely touches MySQL.
async function probe(cookie) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + "/api/students?limit=5", {
      headers: { cookie },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    return { status: res.status, ms: Date.now() - t0, body: body.slice(0, 200) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: String(e.message) };
  }
}

async function main() {
  const cookie = await login();

  // 1. Baseline.
  const before = await probe(cookie);
  check("baseline request succeeds", before.status === 200, `HTTP ${before.status} in ${before.ms}ms`);

  // Record a row count so we can prove durability across the failure.
  const conn = await admin();
  const [[{ n: countBefore }]] = await conn.query("SELECT COUNT(*) AS n FROM students");

  // 2. Kill the app's connections server-side.
  const [threads] = await conn.query(
    "SELECT ID FROM information_schema.PROCESSLIST WHERE USER = ? AND ID <> CONNECTION_ID()",
    [process.env.DB_USER]
  );
  let killed = 0;
  for (const t of threads) {
    try { await conn.query(`KILL CONNECTION ${Number(t.ID)}`); killed++; } catch (e) { /* already gone */ }
  }
  check("killed the app's pooled MySQL connections", killed > 0, `${killed} connection(s) killed`);

  // 3. Requests during/just after the outage must fail cleanly, never hang.
  const during = await probe(cookie);
  const cleanFailure =
    during.status === 200 || // pool may have transparently reconnected already
    (during.status >= 500 && during.status < 600);
  check(
    "request during outage fails cleanly (no hang, no crash)",
    cleanFailure && during.ms < 15000,
    `HTTP ${during.status} in ${during.ms}ms`
  );
  const leaksStack = /at\s+\w+\s+\(|\/home\/user\/|node:internal/.test(during.body);
  check("outage response does not leak a stack trace", !leaksStack, leaksStack ? during.body.slice(0, 120) : "clean error body");

  // 4. Recovery without restarting the app.
  let recovered = null;
  for (let i = 0; i < 20; i++) {
    recovered = await probe(cookie);
    if (recovered.status === 200) break;
    await sleep(500);
  }
  check("app recovers automatically after MySQL connections return", recovered.status === 200, `HTTP ${recovered.status} in ${recovered.ms}ms`);

  // 5. Durability: data is intact and the app is fully functional again.
  const conn2 = await admin();
  const [[{ n: countAfter }]] = await conn2.query("SELECT COUNT(*) AS n FROM students");
  check("data intact across the failure", countAfter === countBefore, `${countBefore} -> ${countAfter} students`);

  // Several consecutive successes: the pool is genuinely healthy, not a fluke.
  let consecutive = 0;
  for (let i = 0; i < 10; i++) {
    const r = await probe(cookie);
    if (r.status === 200) consecutive++;
  }
  check("pool fully healthy after recovery", consecutive === 10, `${consecutive}/10 requests OK`);

  await conn.end().catch(() => {});
  await conn2.end().catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
