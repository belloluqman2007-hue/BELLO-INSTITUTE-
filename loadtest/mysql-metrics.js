"use strict";
/* ============================================================================
   BELLO-INSTITUTE — MySQL server-side metrics sampler
   ----------------------------------------------------------------------------
   Samples the REAL MySQL server during a load stage so the report can quote
   measured values instead of guesses:

     • Threads_connected / Threads_running  (are HTTP users ≠ connections?)
     • Innodb_row_lock_waits / _time_avg    (lock contention)
     • Innodb_deadlocks (via SHOW ENGINE INNODB STATUS counter when present)
     • Slow_queries                         (against long_query_time)
     • Questions / Com_* deltas             (server-side throughput)
     • mysqld RSS + CPU from /proc          (memory & CPU of the DB process)

   Credentials come from the environment only. Nothing is written to Git.
   ========================================================================== */
const fs = require("fs");

const STATUS_KEYS = [
  "Threads_connected", "Threads_running", "Threads_created", "Connections",
  "Max_used_connections", "Aborted_connects", "Aborted_clients",
  "Slow_queries", "Questions", "Queries",
  "Innodb_row_lock_waits", "Innodb_row_lock_time", "Innodb_row_lock_time_avg",
  "Innodb_row_lock_current_waits", "Innodb_buffer_pool_wait_free",
  "Table_locks_waited", "Created_tmp_disk_tables",
];

function makePool(mysql) {
  return mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 2,
    waitForConnections: true,
  });
}

/** Reads mysqld RSS (KB) and utime+stime (jiffies) from /proc. */
function procStats(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const rss = /VmRSS:\s+(\d+) kB/.exec(status);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(" ");
    return {
      rssKb: rss ? Number(rss[1]) : null,
      cpuJiffies: Number(stat[13]) + Number(stat[14]),
    };
  } catch (e) {
    return { rssKb: null, cpuJiffies: null };
  }
}

async function readStatus(pool) {
  const [rows] = await pool.query("SHOW GLOBAL STATUS");
  const map = {};
  for (const r of rows) {
    const k = r.Variable_name || r.VARIABLE_NAME;
    if (STATUS_KEYS.includes(k)) map[k] = Number(r.Value ?? r.VALUE);
  }
  return map;
}

async function readDeadlocks(pool) {
  try {
    const [rows] = await pool.query("SHOW ENGINE INNODB STATUS");
    const text = rows && rows[0] ? String(rows[0].Status || "") : "";
    // The LATEST DETECTED DEADLOCK section only proves >=1; the reliable
    // cumulative counter lives in information_schema.INNODB_METRICS.
    const m = /LATEST DETECTED DEADLOCK/.test(text);
    let counter = null;
    try {
      const [c] = await pool.query(
        "SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME='lock_deadlocks'"
      );
      if (c && c[0]) counter = Number(c[0].COUNT);
    } catch (e) { /* metric disabled */ }
    return { sawDeadlockSection: m, deadlocks: counter };
  } catch (e) {
    return { sawDeadlockSection: null, deadlocks: null };
  }
}

/**
 * Samples MySQL every `intervalMs` until stop() is called.
 * Returns { stop() -> summary }.
 */
function startSampler({ intervalMs = 1000, mysqldPid = null } = {}) {
  const mysql = require("mysql2/promise");
  const pool = makePool(mysql);
  const samples = [];
  let first = null;
  let firstCpu = null;
  let stopped = false;

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const st = await readStatus(pool);
      const proc = mysqldPid ? procStats(mysqldPid) : { rssKb: null, cpuJiffies: null };
      if (!first) first = st;
      if (firstCpu === null && proc.cpuJiffies !== null) firstCpu = proc.cpuJiffies;
      samples.push({ t: Date.now(), ...st, rssKb: proc.rssKb, cpuJiffies: proc.cpuJiffies });
    } catch (e) { /* server may be intentionally down (recovery test) */ }
  }, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      const dl = await readDeadlocks(pool).catch(() => ({ deadlocks: null }));
      let last = samples[samples.length - 1] || {};
      const num = (k) => samples.map((s) => s[k]).filter((v) => typeof v === "number" && !Number.isNaN(v));
      const max = (k) => (num(k).length ? Math.max(...num(k)) : null);
      const avg = (k) => (num(k).length ? num(k).reduce((a, b) => a + b, 0) / num(k).length : null);
      const HZ = 100;
      const elapsedSec = samples.length > 1 ? (last.t - samples[0].t) / 1000 : null;
      const cpuPercent = (elapsedSec && firstCpu !== null && last.cpuJiffies !== null)
        ? ((last.cpuJiffies - firstCpu) / HZ) / elapsedSec * 100
        : null;
      await pool.end().catch(() => {});
      return {
        samples: samples.length,
        maxThreadsConnected: max("Threads_connected"),
        avgThreadsConnected: avg("Threads_connected"),
        maxThreadsRunning: max("Threads_running"),
        threadsCreated: first && last.Threads_created != null ? last.Threads_created - first.Threads_created : null,
        connectionsOpened: first && last.Connections != null ? last.Connections - first.Connections : null,
        maxUsedConnections: max("Max_used_connections"),
        abortedConnects: first && last.Aborted_connects != null ? last.Aborted_connects - first.Aborted_connects : null,
        slowQueries: first && last.Slow_queries != null ? last.Slow_queries - first.Slow_queries : null,
        questions: first && last.Questions != null ? last.Questions - first.Questions : null,
        rowLockWaits: first && last.Innodb_row_lock_waits != null ? last.Innodb_row_lock_waits - first.Innodb_row_lock_waits : null,
        rowLockTimeMsTotal: first && last.Innodb_row_lock_time != null ? last.Innodb_row_lock_time - first.Innodb_row_lock_time : null,
        rowLockTimeAvgMs: last.Innodb_row_lock_time_avg ?? null,
        maxRowLockCurrentWaits: max("Innodb_row_lock_current_waits"),
        tableLocksWaited: first && last.Table_locks_waited != null ? last.Table_locks_waited - first.Table_locks_waited : null,
        tmpDiskTables: first && last.Created_tmp_disk_tables != null ? last.Created_tmp_disk_tables - first.Created_tmp_disk_tables : null,
        deadlocks: dl.deadlocks,
        mysqldMaxRssMb: max("rssKb") ? Math.round(max("rssKb") / 1024) : null,
        mysqldCpuPercent: cpuPercent !== null ? Number(cpuPercent.toFixed(1)) : null,
      };
    },
  };
}

module.exports = { startSampler, procStats };
