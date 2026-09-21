"use strict";
/* ============================================================================
   BELLO-INSTITUTE LOAD TEST — scenario driver (autocannon)
   ----------------------------------------------------------------------------
   Realistic concurrent-user simulation — NOT "every user hits the same URL":

     ADMINISTRATOR  ~15%   dashboard, needs-attention, students, teachers,
                           attendance register (+ writes), results, finance,
                           global search (incl. hostile input), audit
     TEACHER        ~30%   login, dashboard, own classes, attendance register
                           GET+POST, students of class, results, homework
     FINANCE        ~10%   fees balance/records/reports, expenses, budget
     PARENT         ~30%   portal profile, results, report card, attendance,
                           announcements, notifications
     PUBLIC VISITOR ~15%   directory, institution page, SPA shell

   Each simulated user logs in for real (bcrypt.compare cost included),
   keeps a session cookie, fetches a CSRF token and presents it on writes.
   Results (latency percentiles, throughput, error mix) plus in-process
   server metrics (event-loop lag, heap, CPU via PERF_MONITOR) are written
   to loadtest/results/.

   Usage (see run-loadtest.sh for the full staged run):
     node loadtest/run.js --stage 1000 --steps 250,500,750,1000 --hold 120 \
          --url http://127.0.0.1:3100 --manage-server
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const autocannon = require("autocannon");

/* ------------------------------ options -------------------------------- */
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const STAGE = Number(arg("stage", 1000));
// Default ramp: +100 connections every step (≈100 new logins per burst — a
// realistic arrival rate on a small host; bigger bursts are login storms).
const stepSize = Number(arg("step-size", 100));
const NO_RAMP = process.argv.includes("--no-ramp");
const stepsArg = arg("steps", "");
const STEPS = (stepsArg ? stepsArg.split(",").map(Number).filter(Boolean)
  : Array.from({ length: Math.ceil(STAGE / stepSize) }, (_, i) => Math.min(STAGE, (i + 1) * stepSize)));
const HOLD_SECONDS = Number(arg("hold", 60));
const STEP_SECONDS = Number(arg("step-seconds", 30));
const PAUSE_SECONDS = Number(arg("pause", 5));
// One or more target instances (comma-separated) — several instances form
// the horizontal-scaling test; metrics then cover the pool as a whole.
const BASES = String(arg("url", "http://127.0.0.1:3100")).split(",").map((u) => u.trim()).filter(Boolean);
const BASE = BASES[0];
const PORT = Number(new URL(BASE).port || 80);
const MANAGE_SERVER = process.argv.includes("--manage-server");
const RUN_ISOLATION = process.argv.includes("--isolation");
// Realistic pacing: cap each virtual user at this many requests/second
// (e.g. 0.5 = one API call every 2s — an actively-clicking staff member).
// Without it autocannon runs closed-loop (zero think time), which measures
// the saturation ceiling rather than user-perceived latency.
const RATE_PER_USER = Number(arg("rate-per-user", 0));
const LOGIN_ONLY = process.argv.includes("--login-storm");
const OUT_DIR = path.join(__dirname, "results");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ACCOUNTS = JSON.parse(fs.readFileSync(path.join(__dirname, "accounts.json"), "utf8"));
const PASSWORD = ACCOUNTS.testPassword;

/* --------------------------- identity pool ------------------------------ */
// Weighted profile mix, drawn round-robin so every stage uses the same mix.
const POOL = [];
function addPool(role, weight) {
  const users = ACCOUNTS.users.filter((u) => u.role === role);
  for (let i = 0; i < weight; i++) POOL.push(...users);
}
addPool("madrasa_admin", 3); // 3/20 ≈ 15%
addPool("teacher", 6);       // 6/20 ≈ 30%
addPool("finance", 2);       // 2/20 ≈ 10%
addPool("parent", 6);        // 6/20 ≈ 30%
POOL.push(...Array(Math.round(POOL.length * 0.1765)).fill({ role: "public" })); // ≈15% public
// Shuffle once so even small stages draw a realistic role mix.
for (let i = POOL.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [POOL[i], POOL[j]] = [POOL[j], POOL[i]]; }
let identityCursor = 0;
function nextIdentity() { return POOL[identityCursor++ % POOL.length]; }

/* Pre-authenticated sessions for steady-state measurement.
   The ramp/hold phases then contain no login bursts — a 1000-user stage
   would otherwise fire 1000 simultaneous bcrypt compares (measured: 79.6ms
   each, 12.6 logins/s/core) and measure the login queue, not the app.
   Login capacity itself is measured separately (--login-storm). */
const prewarmed = [];
async function prewarmSessions(count, concurrency = 12) {
  console.log(`  prewarming ${count} sessions (real logins, ≤${concurrency} parallel ≈ measured login rate) ...`);
  const t0 = Date.now();
  let cursor = 0, ok = 0, failed = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= count) return;
      const user = POOL[i % POOL.length];
      if (user.role === "public") { prewarmed.push({ user, cookie: null, csrf: null }); ok++; continue; }
      try {
        const res = await fetch(BASE + "/api/auth/login", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: user.username, password: PASSWORD }),
        });
        if (res.status !== 200) { failed++; continue; }
        const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
        const tok = await (await fetch(BASE + "/api/csrf-token", { headers: { cookie } })).json();
        prewarmed.push({ user, cookie, csrf: tok.csrfToken });
        ok++;
        if (ok % 200 === 0) process.stdout.write(`    ${ok}/${count} sessions ` + ((Date.now() - t0) / 1000).toFixed(0) + "s\r");
      } catch (e) { failed++; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`  prewarmed ${ok} sessions (${failed} failed) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { ok, failed, seconds: (Date.now() - t0) / 1000 };
}

/* ------------------------------ helpers -------------------------------- */
const SEARCH_TERMS = ["bello", "aisha", "xqzzj", "", "' OR 1=1 --", "Robert'); DROP TABLE students;--", "%", "a".repeat(120), "قُرْآن", "2026"];
let searchCursor = 0;
function nextSearch() { return SEARCH_TERMS[searchCursor++ % SEARCH_TERMS.length]; }
function recentDay(offsetDays) { const d = new Date(); d.setUTCDate(d.getUTCDate() - (offsetDays || 0)); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

/** Builds one request description for a logged-in identity at step k. */
function buildProfileRequest(user, k) {
  const roll = (n) => k % n;
  if (user.role === "public") {
    const slug = ACCOUNTS.slugs[roll(ACCOUNTS.slugs.length)];
    const which = roll(4);
    if (which === 0) return { method: "GET", path: "/api/public/site" };
    if (which === 1) return { method: "GET", path: "/api/public/madaris/" + slug };
    if (which === 2) return { method: "GET", path: "/schools/" + slug };
    return { method: "GET", path: "/" };
  }
  if (user.role === "parent") {
    switch (roll(7)) {
      case 0: return { method: "GET", path: "/api/portal/me" };
      case 1: return { method: "GET", path: "/api/portal/results" };
      case 2: return { method: "GET", path: "/api/portal/announcements" };
      case 3: return { method: "GET", path: "/api/portal/report-card" };
      case 4: return { method: "GET", path: "/api/notifications" };
      case 5: return { method: "GET", path: "/api/announcements" };
      default: {
        const sid = user.studentIds && user.studentIds.length ? user.studentIds[roll(user.studentIds.length)] : 0;
        return { method: "GET", path: "/api/attendance/student/" + sid };
      }
    }
  }
  if (user.role === "teacher") {
    const cid = user.classIds && user.classIds.length ? user.classIds[roll(user.classIds.length)] : 0;
    switch (roll(8)) {
      case 0: return { method: "GET", path: "/api/madrasa/profile" };
      case 1: return { method: "GET", path: "/api/classes" };
      case 2: return { method: "GET", path: "/api/attendance?classId=" + cid + "&date=" + recentDay(roll(3)) };
      case 3: {
        // Real write path: mark a small register (2 students) present.
        const students = (user.classStudents && user.classStudents[cid]) || [];
        if (students.length >= 2) {
          const statuses = {};
          statuses[students[roll(students.length)]] = "present";
          statuses[students[(roll(students.length) + 1) % students.length]] = "late";
          return {
            method: "POST", path: "/api/attendance/mark", csrf: true,
            body: JSON.stringify({ classId: cid, date: recentDay(0), statuses }),
          };
        }
        return { method: "GET", path: "/api/attendance?classId=" + cid + "&date=" + recentDay(0) };
      }
      case 4: return { method: "GET", path: "/api/results/roster?classId=" + cid + (user.termId ? "&termId=" + user.termId : "") + (user.subjectIds && user.subjectIds.length ? "&subjectId=" + user.subjectIds[roll(user.subjectIds.length)] : "") };
      case 5: return { method: "GET", path: "/api/students?classId=" + cid + "&perPage=50" };
      case 6: return { method: "GET", path: "/api/homework" };
      default: return { method: "GET", path: "/api/notifications" };
    }
  }
  if (user.role === "finance") {
    switch (roll(6)) {
      case 0: return { method: "GET", path: "/api/fees/balance" };
      case 1: return { method: "GET", path: "/api/fees/records" };
      case 2: return { method: "GET", path: "/api/fees/reports" };
      case 3: return { method: "GET", path: "/api/expenses" };
      case 4: return { method: "GET", path: "/api/fees/items" };
      default: return { method: "GET", path: "/api/budget/summary" };
    }
  }
  // madrasa_admin
  const cid = user.classIds && user.classIds.length ? user.classIds[roll(user.classIds.length)] : 0;
  switch (roll(12)) {
    case 0: return { method: "GET", path: "/api/admin/needs-attention" };
    case 1: return { method: "GET", path: "/api/madrasa/profile" };
    case 2: return { method: "GET", path: "/api/students?page=" + (roll(3) + 1) + "&perPage=50" };
    case 3: return { method: "GET", path: "/api/teachers" };
    case 4: return { method: "GET", path: "/api/classes" };
    case 5: return { method: "GET", path: "/api/attendance?classId=" + cid + "&date=" + recentDay(roll(2)) };
    case 6: return { method: "GET", path: "/api/results/roster?classId=" + cid + (user.termId ? "&termId=" + user.termId : "") + (user.subjectIds && user.subjectIds.length ? "&subjectId=" + user.subjectIds[roll(user.subjectIds.length)] : "") };
    case 7: return { method: "GET", path: "/api/fees/balance" };
    case 8: return { method: "GET", path: "/api/admin/search?q=" + encodeURIComponent(nextSearch()) };
    case 9: return { method: "GET", path: "/api/admin/audit" };
    case 10: return { method: "GET", path: "/api/sessions" };
    default: return { method: "GET", path: "/api/notifications" };
  }
}

/* ------------------------- autocannon request ---------------------------- */
// One dynamic request entry: each connection logs in once, fetches a CSRF
// token, then loops its profile mix. 401 → re-login. State lives in the
// per-connection `context` — autocannon resets that context every time the
// request array wraps, so setupClient() patches the per-client iterator to
// carry the virtual user's session (identity, cookie, csrf) across wraps.
// Without that, every wrap would silently turn into a fresh login.
function preserveSessionAcrossResets(client) {
  const it = client && client.requestIterator;
  if (!it || !it.resetContext) return;
  const orig = it.resetContext.bind(it);
  it.resetContext = function () {
    const ctx = it.context || {};
    const keep = ctx.cookie || ctx.user ? {
      user: ctx.user,
      cookie: ctx.cookie || null,
      csrf: ctx.csrf || null,
      phase: ctx.cookie ? (ctx.phase === "run" ? "run" : ctx.phase) : "login",
      step: ctx.step || 0,
      relogins: ctx.relogins || 0,
    } : null;
    orig();
    if (keep) Object.assign(it.context, keep);
  };
}

// Round-robin over prewarmed sessions: sequential step/hold instances reuse
// the same server-side sessions (rows stay valid for hours), so a stage needs
// only STAGE prewarmed logins — not one per step.
let prewarmCursor = 0;
function setupRequest(req, context) {
  if (!context.user) {
    const pre = prewarmed.length ? prewarmed[prewarmCursor++ % prewarmed.length] : null;
    if (pre) {
      context.user = pre.user; context.cookie = pre.cookie; context.csrf = pre.csrf;
      context.phase = "run"; context.step = 0; context.relogins = 0;
    } else {
      context.user = nextIdentity(); context.phase = "login"; context.step = 0; context.relogins = 0;
    }
  }
  if (context.phase === "login") {
    req.method = "POST";
    req.path = "/api/auth/login";
    req.headers = { "content-type": "application/json" };
    req.body = JSON.stringify({ username: context.user.username, password: PASSWORD });
    return req;
  }
  if (context.phase === "csrf" && context.user.role !== "public") {
    req.method = "GET";
    req.path = "/api/csrf-token";
    req.headers = context.cookie ? { cookie: context.cookie } : {};
    req.body = undefined;
    return req;
  }
  if (LOGIN_ONLY) { context.phase = "login"; context.step = 0; return setupRequest(req, context); }
  const r = context.user.role === "public" ? buildProfileRequest(context.user, context.step++) : buildProfileRequest(context.user, context.step++);
  req.method = r.method;
  req.path = r.path;
  const headers = context.cookie ? { cookie: context.cookie } : {};
  if (r.csrf) headers["x-csrf-token"] = context.csrf || "";
  if (r.body) headers["content-type"] = "application/json";
  req.headers = headers;
  req.body = r.body;
  return req;
}

function onResponse(status, body, context, headers) {
  if (context.phase === "login") {
    // autocannon's raw response headers keep original casing ("Set-Cookie").
    const sc = headers && (headers["set-cookie"] || headers["Set-Cookie"]);
    if (status === 200 && sc) {
      const raw = Array.isArray(sc) ? sc.join(";") : String(sc);
      context.cookie = raw.split(";")[0];
      context.phase = context.user.role === "public" ? "run" : "csrf";
    } else if (status === 429) {
      context.phase = "login-wait";
    } else {
      context.relogins = (context.relogins || 0) + 1;
    }
    return;
  }
  if (context.phase === "login-wait") { context.phase = "login"; return; }
  if (context.phase === "csrf") {
    if (status === 200) { try { context.csrf = JSON.parse(body).csrfToken; } catch (e) { /* keep going */ } }
    context.phase = "run";
    return;
  }
  if (status === 401 || status === 403) {
    // Session expired mid-run → re-authenticate (exercises the real path).
    context.phase = "login";
    context.cookie = null;
    context.csrf = null;
  }
}

/* ----------------------------- server mgmt ------------------------------ */
let serverProc = null;
async function startServer() {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    DATABASE_DRIVER: "sqlite",
    DATABASE_FILE: process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "loadtest.sqlite"),
    NODE_ENV: "development",
    SESSION_SECRET: process.env.SESSION_SECRET || "loadtest-secret-0123456789abcdef0123456789abcdef",
    SUPER_ADMIN_USERNAME: process.env.SUPER_ADMIN_USERNAME || "ltperf",
    SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD || "LoadPerf#2026!x",
    PERF_MONITOR: "1",
    // Deep accept queue for mass-simultaneous connects during load tests
    // (somaxconn on this host is 4096).
    LISTEN_BACKLOG: "4096",
    // Staging overrides (documented in the report): all simulated users share
    // one client IP, so per-IP ceilings are raised for the load test ONLY.
    // Login brute-force protection is verified separately with default limits.
    API_RATE_LIMIT: "1000000",
    LOGIN_RATE_LIMIT: "1000000",
    PUBLIC_RATE_LIMIT: "1000000",
    BACKUP_INTERVAL_MINUTES: "0",
  });
  serverProc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server", "index.js")], {
    env, stdio: ["ignore", "pipe", "pipe"], detached: false,
  });
  serverProc.stdout.on("data", (d) => process.env.LOADTEST_VERBOSE && process.stdout.write("[server] " + d));
  serverProc.stderr.on("data", (d) => process.stderr.write("[server:err] " + d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not become healthy on " + BASE);
}

/* --------------------------- server metrics ----------------------------- */
let perfCookie = null, perfCsrf = null;
async function perfLogin() {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.SUPER_ADMIN_USERNAME || "ltperf", password: process.env.SUPER_ADMIN_PASSWORD || "LoadPerf#2026!x" }),
  });
  if (res.status !== 200) throw new Error("super-admin login failed: " + res.status);
  perfCookie = (res.headers.get("set-cookie") || "").split(";")[0];
  perfCsrf = (await (await fetch(BASE + "/api/csrf-token", { headers: { cookie: perfCookie } })).json()).csrfToken;
}
let driverLastCpu = null, driverLastAt = 0, driverCpuPercent = 0;
function driverCpuSample() {
  const c = process.cpuUsage();
  const now = process.hrtime.bigint();
  if (driverLastCpu) {
    const wallMs = Number(now - driverLastAt) / 1e6;
    const used = (c.user - driverLastCpu.user) + (c.system - driverLastCpu.system);
    if (wallMs > 0) driverCpuPercent = Math.round(used / 1000 / wallMs * 1000) / 10;
  }
  driverLastCpu = c; driverLastAt = now;
  return driverCpuPercent;
}

async function serverSnapshot() {
  const out = { at: new Date().toISOString(), driverCpuPercent: driverCpuSample() };
  try {
    const r = await fetch(BASE + "/api/perf", { headers: { cookie: perfCookie } });
    if (r.ok) Object.assign(out, await r.json());
  } catch (e) { out.perfError = e.message; }
  if (serverProc && serverProc.pid) {
    try {
      const stat = fs.readFileSync("/proc/" + serverProc.pid + "/stat", "utf8").split(" ");
      out.procUtimeTicks = Number(stat[13]); out.procStimeTicks = Number(stat[14]);
      out.procVsizeBytes = Number(stat[22]); out.procRssPages = Number(stat[23]);
      out.procStartTimeTicks = Number(stat[21]);
    } catch (e) { /* proc gone */ }
  }
  return out;
}

/* ------------------------------- stages --------------------------------- */
async function runAutocannon(connections, seconds, label) {
  const samples = [];
  const sampler = setInterval(async () => {
    try { samples.push(await serverSnapshot()); } catch (e) { /* keep going */ }
  }, 5000);
  if (perfCookie) { try { await fetch(BASE + "/api/perf/reset", { method: "POST", headers: { cookie: perfCookie, "x-csrf-token": perfCsrf } }); } catch (e) { /* ok */ } }

  // Track WHEN each timeout fires relative to instance start: a cold-start
  // connect herd times out at t≈timeout; spread-out timeouts mean sustained
  // queueing. (autocannon counts them but not their timing.)
  const timeoutTimes = [];
  const instance = autocannon({
    url: BASES.length > 1 ? BASES : BASE,
    title: label,
    connections,
    duration: seconds,
    timeout: 60,
    // overallRate caps the TOTAL offered load (rate-per-user × users);
    // autocannon spreads it across connections and corrects latency
    // percentiles for coordinated omission.
    ...(RATE_PER_USER > 0 ? { overallRate: Math.max(1, Math.round(RATE_PER_USER * connections)) } : {}),
    sampleInt: 1000,
    setupClient: preserveSessionAcrossResets,
    requests: [{ setupRequest, onResponse }],
  });
  const t0 = Date.now();
  instance.on("reqError", (e) => { if (String(e && e.message).includes("timed out")) timeoutTimes.push(Date.now() - t0); });
  const result = await instance;
  clearInterval(sampler);
  const last = samples[samples.length - 1] || {};
  return {
    label,
    connections,
    requestedSeconds: seconds,
    result: {
      duration: result.duration,
      totalCompletedRequests: result.totalCompletedRequests,
      requestsPerSecond: result.requests.average,
      latency: {
        average: result.latency.average,
        p50: result.latency.p50, p75: result.latency.p75, p90: result.latency.p90,
        p97_5: result.latency.p97_5, p99: result.latency.p99, p99_9: result.latency.p99_9, max: result.latency.max,
      },
      errors: result.errors, timeouts: result.timeouts, non2xx: result.non2xx,
      timeoutTimingMs: timeoutTimes.slice(0, 50),
      statusCodes: {
        "1xx": result["1xx"], "2xx": result["2xx"], "3xx": result["3xx"], "4xx": result["4xx"], "5xx": result["5xx"],
      },
      statusCodeStats: result.statusCodeStats,
    },
    serverSamples: samples,
    peak: {
      eventLoopLagP95Ms: Math.max(0, ...samples.map((s) => s.eventLoopLagMs ? s.eventLoopLagMs.p95 : 0)),
      eventLoopLagMaxMs: Math.max(0, ...samples.map((s) => s.eventLoopLagMs ? s.eventLoopLagMs.max : 0)),
      heapUsedMb: Math.max(0, ...samples.map((s) => s.heapUsedMb || 0)),
      rssMb: Math.max(0, ...samples.map((s) => s.rssMb || 0)),
      cpuPercent: Math.max(0, ...samples.map((s) => s.cpuPercent || 0)),
      driverCpuPercent: Math.max(0, ...samples.map((s) => s.driverCpuPercent || 0)),
      db: last.db || null,
    },
  };
}

/* -------------------------------- main ---------------------------------- */
(async () => {
  const stageOut = {
    stage: STAGE, url: BASES, startedAt: new Date().toISOString(),
    pacing: RATE_PER_USER > 0 ? { ratePerUser: RATE_PER_USER, offeredLoadRps: Math.round(RATE_PER_USER * STAGE) } : "closed-loop (zero think time)",
    env: {
      node: process.version, cpus: require("os").cpus().length, totalMemMb: Math.round(require("os").totalmem() / 1048576),
      dataset: "55 madaris / 10,900 students / ~200k rows (loadtest.sqlite)",
      note: "server + load generator share this host; see report for implications",
    },
    steps: [], hold: null, isolation: null,
  };
  if (MANAGE_SERVER) {
    console.log("Starting server on :" + PORT + " ...");
    await startServer();
  }
  await perfLogin();
  let prewarmInfo = null;
  if (!LOGIN_ONLY) {
    prewarmInfo = await prewarmSessions(STAGE);
    stageOut.prewarm = prewarmInfo;
  }

  for (const conns of (NO_RAMP ? [] : STEPS)) {
    process.stdout.write(`  ramp ${conns} conns (${STEP_SECONDS}s) ... `);
    const r = await runAutocannon(conns, STEP_SECONDS, "ramp-" + conns);
    stageOut.steps.push(r);
    console.log(`${r.result.requestsPerSecond.toFixed(0)} req/s, p50 ${r.result.latency.p50}ms, p97.5 ${r.result.latency.p97_5}ms, 5xx ${r.result.statusCodes["5xx"] || 0}`);
    if (PAUSE_SECONDS > 0) await new Promise((r2) => setTimeout(r2, PAUSE_SECONDS * 1000));
  }

  if (HOLD_SECONDS > 0) {
    process.stdout.write(`  HOLD ${STAGE} conns for ${HOLD_SECONDS}s${RUN_ISOLATION ? " + isolation probes" : ""} ... `);
    let probe = null;
    if (RUN_ISOLATION) {
      probe = spawn(process.execPath, [path.join(__dirname, "probe-isolation.js"), "--url", BASE, "--duration", String(HOLD_SECONDS)], { stdio: "inherit" });
    }
    const r = await runAutocannon(STAGE, HOLD_SECONDS, "hold-" + STAGE);
    stageOut.hold = r;
    console.log(`${r.result.requestsPerSecond.toFixed(0)} req/s, p50 ${r.result.latency.p50}ms, p90 ${r.result.latency.p90}ms, p97.5 ${r.result.latency.p97_5}ms, p99 ${r.result.latency.p99}ms, max ${r.result.latency.max}ms, 5xx ${r.result.statusCodes["5xx"] || 0}, timeouts ${r.result.timeouts}`);
    if (probe) {
      await new Promise((resolve) => probe.on("exit", resolve));
      try { stageOut.isolation = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "isolation-probe.json"), "utf8")); } catch (e) { stageOut.isolation = { error: "probe output missing" }; }
    }
  }

  const variant = LOGIN_ONLY ? "-login" : (RATE_PER_USER > 0 ? "-paced" : "");
  const outPath = path.join(OUT_DIR, "stage-" + STAGE + variant + ".json");
  fs.writeFileSync(outPath, JSON.stringify(stageOut, null, 2));
  console.log("Results → " + outPath);

  if (MANAGE_SERVER && serverProc) {
    serverProc.kill("SIGTERM");
    setTimeout(() => serverProc.kill("SIGKILL"), 5000).unref();
    await new Promise((r) => serverProc.on("exit", r));
  }
  const errors = (stageOut.hold ? stageOut.hold.result.errors : 0) || 0;
  process.exit(0);
})().catch((e) => {
  console.error(e);
  if (serverProc) serverProc.kill("SIGKILL");
  process.exit(1);
});
