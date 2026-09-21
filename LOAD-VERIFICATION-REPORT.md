# LOAD & SCALABILITY VERIFICATION REPORT

**Date:** 2026-09-21
**Scope:** throughput, latency, concurrency, memory behaviour, multi-instance
operation and login capacity of the Node/Express server, measured against a
real seeded database through the real HTTP API — with the full test suite
re-run after every change made during the campaign.

---

## 1. Environment (and what it means for the numbers)

| | |
|---|---|
| Node | v22.22.3 (`node:sqlite` driver) |
| Host | 2 vCPU, ~3.9 GB RAM — **load generator and server share this host** |
| Database | SQLite, `data/loadtest.sqlite`: 55 madaris, 682 users, 10,900 students, ~200,000 rows |
| Server config | `LISTEN_BACKLOG=4096`, `API_RATE_LIMIT=1000000` (limiter off), `PERF_MONITOR=1` |

Because the driver competes with the server for the same 2 cores, every
throughput number below is **conservative** — production sizing has the whole
machine (or several) for the app alone.

## 2. Method

Driver: `loadtest/run.js` (autocannon-based) — repo scripts
`loadtest:seed` / `loadtest:smoke` / `loadtest:stage`.

- **Real sessions:** every virtual user logs in through `POST /api/auth/login`
  first (real bcrypt, real cookie, real CSRF token) — up to 2,000 concurrent
  authenticated users, no shortcuts.
- **Realistic mix:** weighted scenario pools per role (parent portal reads,
  teacher roster/attendance/register-marking writes, finance reports, admin
  dashboard/search/audit) — not one endpoint hammered.
- **Two pacing modes:** *closed-loop* (users request as fast as the server
  answers — finds the ceiling) and *paced* (each user emits N requests/s —
  measures latency at a controlled offered load).
- **Isolation under load:** after every run, a cross-tenant prober hits other
  tenants' entities using this run's cookies.
- **Server telemetry:** `/api/perf` (super-admin gated) samples event-loop lag
  percentiles, heap, RSS and CPU during the runs.

Two early methodology artifacts are **excluded** from all claims: (a) runs
before session prewarming existed (login storms masquerading as collapse),
and (b) "timeouts" that all fire at exactly t = 60,000 ms with cold
connections — the client's own connect herd hitting the pre-fix 511 accept
queue, not server behaviour. Canonical artifacts live in
`loadtest/results/`; `stage-20.json` / `stage-50.json` predate driver fixes
and are superseded.

## 3. Results (all runs: 0 × 5xx, 0 × 401/403, 0 isolation violations)

| Run | Users | Offered / achieved | p50 | p90 | p99 | Max | Timeouts |
|---|---|---|---|---|---|---|---|
| stage-1000-paced | 1,000 | 500 → **501 rps** | 121 | 319 | **928 ms** | 1,909 | 0 |
| stage-1000 (closed) | 1,000 | → **1,029 rps** | 392 | 587 | 887 | — | 0¹ |
| stage-2000-paced | 2,000 | 700 → **701 rps** | 207 | 567 | 1,187 | 2,086 | 0 |
| **stage-2000-horizontal** (2 instances) | 2,000 | 700 → **703 rps** | **100** | **351** | 1,192 | 2,602 | 0 |
| stage-2000 (closed) | 2,000 | → **1,101 rps** | 386 | 515 | 631 | — | 0¹ |
| stage-5000-paced (300 s soak) | 5,000 | 500 → **501 rps** | 107 | 301 | 667 | 2,544 | 0 |
| stage-5000 (closed, saturation) | 5,000 | → **871 rps** | 5,426 | 7,829 | 12,122 | — | 7² |
| login storm | 200 conns | → **24 logins/s** | 3,405 | 6,257 | 6,766 | — | 0 |

¹ connect-herd client artifact (see §2), not server timeouts.
² 7 timeouts + 69 transport errors out of 156,718 requests (0.04 %) with
5,000 simultaneous connections at 4–5× the saturation point — the box
degrades, it does not crash: **0 × 5xx throughout**.

Isolation probes across all runs: **36,058 cross-tenant checks, 0 violations**
(e.g. 8,498 checks in the 5,000-user soak alone).

The ~30 % non-2xx in the mix are expected validation answers, identical in
every single- and multi-instance run: `400 classId, termId and subjectId are
required` (roster queries with deliberately varied/missing params) and `404`
for out-of-scope ids. Verified directly against the API; they are scenario
variation, not faults. **No 401 (session), no 403 (CSRF/permission), no 5xx
(server) occurred in any canonical run.**

### Sustained throughput ceiling

~**1,000–1,100 req/s** on this shared 2-vCPU host, flat from 250 to 2,000
concurrent connections — CPU-bound (the SQLite driver executes synchronously
on the event loop; the load generator takes the other share). Latency stays
sub-second at the ceiling (p99 631–887 ms). Past ~2,000 connections the box
saturates (throughput decays to ~770–870 rps, latency multi-seconds) —
that is the vertical limit; horizontal scaling (§5) is the answer.

### Memory (5,000 users, 300 s soak) — no leak

RSS flat 154–157 MB across the whole soak; heap cycling 19–48 MB with normal
GC; event-loop lag max 616 ms. The same binary serving 55 tenants and 10,900
students idles at ~90 MB RSS.

### Login capacity — by design

24 logins/s sustained (p50 3.4 s), 0 errors. The ceiling is bcrypt cost 10
(~12.6 verifies/s/core — measured 79.6 ms per compare), not the app. This is
the deliberate security trade-off; lowering the cost was rejected. A school
of 500 users absorbs the morning rush in ~30 s of queueing.

## 4. Root-cause work behind the numbers

- **Event-loop lag up to 8.8 s** (early runs) traced to per-commit WAL fsync
  plus a session-table UPDATE on every request. Fixed: `PRAGMA
  synchronous = NORMAL` + `busy_timeout = 5000` at connect (crash-safe for
  the process; production uses the async MySQL driver), and a 60 s-grace
  read-before-write throttle on session `touch()`. Session-store suite: 12/12.
- **SYN drops at 1,000 simultaneous connects** (client timeouts exactly at
  t = 60 s) traced to Node's 511 accept backlog. `LISTEN_BACKLOG` env (default
  1024, test 4096) wired into `app.listen`.
- **Per-endpoint unloaded baseline** (fresh DB-backed measurement): every
  endpoint in the mix answers in **2–13 ms median** (worst 30 ms). Load
  latency is therefore queueing at the CPU ceiling, not query cost — the
  earlier fees/balance N+1 fix holds at ~6 ms over ~200 students.
- **Stateless check:** `/api/health` alone serves 2,629–2,772 rps at 200–600
  connections.

## 5. Horizontal scaling — verified, no sticky sessions needed

Sessions live in the database (`app_sessions`), not in process memory. Two
server instances (ports 3111/3112) started against the **same** SQLite file
with the same `SESSION_SECRET`, traffic round-robined per request — so most
requests hit an instance that never saw the login:

| 2,000 users, 700 rps offered | 1 instance | 2 instances |
|---|---|---|
| Throughput | 701 rps | 703 rps |
| p50 | 207 ms | **100 ms** |
| p90 | 567 ms | **351 ms** |
| p99 | 1,187 ms | 1,192 ms |
| 401 / 403 / 5xx | 0 / 0 / 0 | **0 / 0 / 0** |

Zero authentication or CSRF failures across 84,367 round-robined requests —
the DB-backed session store (and the throttled `touch()` writing to it)
is share-safe across processes. Throughput does not double because the
**database file** (one SQLite writer on the same disk) is the shared
resource and both instances compete for the same 2 host cores; latency per
instance halves because each handles half the request stream. On MySQL with
a real connection pool this is the supported production shape (see
`docs/DATABASE.md` → pool sizing; `docs/DEPLOYMENT.md` → multi-instance
notes on per-process rate limits and backup timers).

Both instances' `/api/perf` confirmed they served comparable load (p50
event-loop lag ~20 ms each; RSS 88–91 MB after the run).

## 6. Changes made during this campaign

All changes are additive/config-only unless noted; no schema or API contract
changed.

**Server**
- `server/db.js` — SQLite connect-time `PRAGMA synchronous = NORMAL`,
  `busy_timeout = 5000` (documented in-code).
- `server/session-store.js` — throttled `touch()` (read-before-write, 60 s
  grace).
- `server/index.js` — `LISTEN_BACKLOG` wired into `listen()`; session-prune
  timer interval from `SESSION_PRUNE_MINUTES`.
- `server/config.js` — exports `LISTEN_BACKLOG`, `SESSION_PRUNE_MINUTES`,
  `PERF_MONITOR`, `MYSQL_POOL`.
- `server/app.js` — super-admin-only `/api/perf` + `/api/perf/reset`
  diagnostics (gated behind `PERF_MONITOR`, default off).
- `server/routes/attendance.js` — 500-entry batch cap on register saves.

**N+1 removals (behaviour-preserving; covered by existing suites)**
- `server/routes/ptm.js` — teacher/subject lookups batched to one query per
  screen (was one per child and one per teacher); teacher-slot enrolment on
  session create is now one chunked multi-row INSERT (was one INSERT per
  teacher); `GET /mine` fetches all sessions' bookings in one query;
  slot-time refresh after an edit is one `CASE` UPDATE (was up to 400);
  booking confirmation/cancel fetch the single booking row (was the whole
  session's bookings). ptm suites: 31/31.
- `server/routes/portal.js` — `GET /api/portal/me` resolves all children's
  classes in one `IN (...)` query (was one per child).
- `server/services/backup.js` — snapshot writes/prunes are now async I/O
  (was `fs.writeFileSync` of the whole database as JSON on the event loop —
  on a timer, before migrations, on shutdown); backup listing reads only the
  256 KB header of each file (was `readFileSync` + `JSON.parse` of every
  snapshot); `readSnapshot` async. Callers updated (routes, CLI, tests).
  persistence suites: 31/31.

**Tooling & docs**
- `loadtest/` — seed script, 682-account dataset, autocannon driver v3
  (weighted role mix, per-connection session state, paced mode, multi-URL,
  prewarming, driver CPU tracking), isolation prober; canonical results in
  `loadtest/results/`.
- `.env.example`, `docs/DATABASE.md` (pool-sizing table), `docs/DEPLOYMENT.md`
  (multi-instance + `LISTEN_BACKLOG`/`PERF_MONITOR`/`SESSION_PRUNE_MINUTES`).
- `test/sql-compat.test.js` — the two new db.js PRAGMA sites listed in the
  dialect audit set (they sit inside `connectSqlite`, the SQLite branch of
  the dialect fork).

## 7. Test suite

`npm test` (the project's own runner) re-run in full **after all of the
above**:

| | Baseline | Final |
|---|---|---|
| Total | 492 | **495** |
| Passed | 492 | **495** |
| Failed / skipped | 0 / 0 | **0 / 0** |

The three added tests are the session-store save/touch cases; every fix's
targeted suite (sessions 12/12, ptm 31/31, persistence 31/31, sql-compat 3/3,
tenant-isolation + public-portal 47/47) passes individually and in the full
run. No existing test was weakened or deleted.

## 8. Known limitations — read before production

1. **MySQL path NOT verified at runtime.** No MySQL server exists in this
   environment; every number above is SQLite. The MySQL code path is
   statically audited (dialect branches, pool config exported, schema limits
   checked — see `FINAL-VERIFICATION-REPORT.md` → External Blockers), and
   `/api/perf` exposes live pool stats for the real thing, but **a smoke test
   against a real MySQL 8 instance is still required before first
   production deploy.** This is the one reason this report is not a full
   production sign-off.
2. **Single-writer SQLite ceiling.** SQLite serialises writers; the ~1,000
   rps ceiling and the 2-instance latency-only gain reflect that. Production
   multi-instance deployments should use MySQL, where each instance gets its
   own pooled connections.
3. **SMTP STARTTLS path is unaudited at runtime.** `services/delivery.js`
   upgrades the socket to TLS on port 587 and re-attaches its line reader
   without removing the listener on the raw socket; against a real relay this
   could desynchronise the conversation. No SMTP relay is reachable here.
   Verify once with your production relay (or prefer port 465 direct TLS,
   which does not use that path).
4. **Snapshot creation cost on very large databases.** `buildSnapshot` reads
   every table and `JSON.stringify`s it on the event loop (async disk I/O
   now, but the serialisation is still synchronous). Fine at ~200 k rows
   (seconds); a multi-GB production database should rely on MySQL-native
   backups rather than the JSON snapshot timer.
5. **Client-side artifacts** — autocannon's HDR histograms expose no p95 and
   clamp max latency at 10 s; "max" columns for early runs reflect that.
   Load generator and server shared 2 cores (conservative, §1).
6. **Rate limiter disabled during tests** (`API_RATE_LIMIT=1000000`) so the
   numbers measure the app, not the limiter. Production defaults
   (2,000/15 min/IP) are per-process — see `docs/DEPLOYMENT.md`.

## 9. FINAL STATUS

| Dimension | Status |
|---|---|
| Throughput & latency (SQLite, 1–2 instances, ≤ 5,000 concurrent users) | **VERIFIED** |
| Memory stability under 300 s soak | **VERIFIED** (no leak) |
| Tenant isolation under load (36,058 probes) | **VERIFIED** (0 violations) |
| Multi-instance operation without sticky sessions | **VERIFIED** |
| Login capacity (bcrypt cost 10) | **VERIFIED** — 24 logins/s/2 cores, by design |
| Full test suite after changes | **VERIFIED** — 495/495 |
| MySQL production driver at runtime | **NOT FULLY VERIFIED** (static audit only — see §8.1) |

**Overall: VERIFIED on the SQLite dev stack; production MySQL runtime
verification outstanding — the same caveat `FINAL-VERIFICATION-REPORT.md`
already carries.**
