# BELLO INSTITUTE — MySQL 8 Runtime Verification Report

**MYSQL 8 RUNTIME TEST = EXECUTED**

Every number below was produced by running BELLO against a **real, live MySQL
8.0.36 server**. Nothing is estimated, extrapolated, or carried over from the
earlier SQLite verification. Where a metric could not be measured, it is
marked `not measured` rather than filled in.

---

## 1. Test environment

| Item | Value |
|---|---|
| MySQL version | **8.0.36** (built from source in the test sandbox) |
| Server binary | `/opt/mysql8/bin/mysqld`, port **3307**, datadir `/opt/mysql-test/data` |
| `sql_mode` | `ONLY_FULL_GROUP_BY, STRICT_TRANS_TABLES, NO_ZERO_IN_DATE, NO_ZERO_DATE, ERROR_FOR_DIVISION_BY_ZERO, NO_ENGINE_SUBSTITUTION` (MySQL 8 defaults — **not** relaxed) |
| `max_connections` | 300 |
| `innodb_buffer_pool_size` | 512 MB |
| `long_query_time` | 0.5 s (slow log on) |
| Character set | `utf8mb4` / `utf8mb4_unicode_ci` |
| Host | Debian 12, **2 vCPU, 3.9 GB RAM** — app server, load generator and MySQL all share this one box |
| Node | v22.22.3, `mysql2` ^3.14.0 |

**Isolation.** A dedicated server instance on a non-standard port with a
dedicated database and a dedicated low-privilege user. Credentials live in
`/opt/mysql-test/secrets/env.sh` (mode 600, outside the repo) and are read
from environment variables only — **no credential is hard-coded or committed**.
No production database was touched at any point.

Databases used: `bello_fresh_migrate` (migration proof), `bello_loadtest`
(seeded load-test data), and one throwaway `mmtest_<pid>_<n>` schema per test
file, dropped automatically on teardown.

---

## 2. Connection, pool and timeout configuration

Verified that the connection is fully env-var driven (`server/config.js`
→ `DB_CONFIG`, `MYSQL_POOL`) and that the pool honours it:

| Setting | Env var | Default | Verified |
|---|---|---|---|
| Pool size | `MYSQL_POOL_SIZE` | 10 | yes — connection count never exceeded it |
| Queue limit | `MYSQL_QUEUE_LIMIT` | 0 (unbounded, `waitForConnections: true`) | yes — requests queue, never error |
| Connect timeout | `MYSQL_CONNECT_TIMEOUT_MS` | 10000 | yes |
| Idle timeout | `MYSQL_IDLE_TIMEOUT_MS` | 60000 | yes |
| Max idle | `MYSQL_MAX_IDLE` | = pool size | yes |

`connect()` fail-fasts with `SELECT 1 AS ok`. Connections are released on both
the success and error paths (verified by the leak tests in §8).

---

## 3. Migrations on an empty database

`npm run migrate` against a **completely empty** `bello_fresh_migrate`:

```
35 / 35 migrations applied, 0 errors, exit 0  (~6.6 s)
```

`bello_loadtest` was migrated the same way: 35/35, exit 0. Re-running is a
no-op (`Database is up to date`), so the runner is idempotent. The upgrade
path (migrating a database created by an older revision) was also exercised.

**All schema changes in this work went through migrations** — specifically the
new `034_mysql_index_audit`. No table was altered by hand.

---

## 4. Schema verification

Read back from `information_schema` on the freshly migrated MySQL schema:

| Check | Result |
|---|---|
| Base tables | **87** |
| Storage engine | InnoDB on all 87 |
| Charset/collation | `utf8mb4` / `utf8mb4_unicode_ci` on all 87 |
| Primary keys | present on all **87/87** |
| Distinct indexes | **233** |
| Duplicate/redundant indexes | **0** (7 removed by migration 034) |
| Tenant tables indexed on `madrasa_id` | **81 / 81** |
| Timestamps | `created_at`/`updated_at` default `CURRENT_TIMESTAMP` |
| Numeric money columns | `DECIMAL(≤12,2)` throughout |

One deliberate exclusion: `madrasa_registrations.madrasa_id` is a *public
registration code* (varchar), not a tenant foreign key, so it is correctly not
indexed as one.

**Observation (not a defect, flagged for the record):** the live MySQL schema
declares only **one** foreign key (`users.madrasa_id → madaris.id`). BELLO
enforces referential integrity in the application layer; the migrations emit
FK clauses only for that one relationship. This is a deliberate existing design
choice, left unchanged — adding 80+ FKs would be a redesign, which was out of
scope. It is worth a follow-up decision.

---

## 5. Seeded multi-tenant dataset

`npm run loadtest:seed` against `bello_loadtest`:

```
55 madaris (institutions)   10,900 students      128,920 attendance rows
43,600 results              10,900 fee assignments   7,782 fee payments
4,400 activity-log rows      2,200 library books    1,375 library loans
825 admission requests         440 announcements    1,650 notifications
683 user accounts across 55 public slugs
```

Realistic multi-tenant data spread across many institutions, which is what
makes the isolation and EXPLAIN work below meaningful.

---

## 6. Full test suite — **DATABASE = MYSQL 8**

```
source /opt/mysql-test/secrets/env.sh && TEST_DB_DRIVER=mysql npm test
```

| Run | Pass | Fail | Result |
|---|---|---|---|
| 1 | 464 / 514 | 50 | bugs found |
| 2 | 491 / 514 | 23 | bugs found |
| 3 | 513 / 514 | 1 | bug found |
| 4 | 514 / 514 | 0 | green |
| **Final (after all fixes)** | **514 / 514** | **0** | **EXIT=0**, 0 skipped, 583 s |

**No test was deleted, skipped, weakened, or marked `todo`.** The suite grew
from 495 (SQLite) to 514 because of the new MySQL-only runtime suite.

**SQLite regression: 496 / 496 pass, 0 fail, exit 0.** SQLite remains the
default driver and is fully intact.

Domain coverage re-confirmed individually on MySQL:

- `result-lifecycle`, `payroll`, `attendance-late`, `delivery-retry-library` → **52/52**
- `auth-security`, `tenant-isolation`, `sql-compat`, `mysql-runtime` → **65/65**

Both required lifecycles pass on MySQL:
- **Results:** `draft → submitted → under_review → returned|approved → published → locked`, including the frozen-state and permission rules.
- **Fees:** `expected → initiated → successful → verified → reconciled`, in that order only.

---

## 7. Bugs found and fixed

Seven real defects that **only** appear on MySQL. Each was diagnosed to root
cause, fixed, retested, and regression-checked on SQLite.

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | Dates rendered as `"Tue Sep 22 2026..."`, `RangeError: Invalid time value` | mysql2 hydrates DATE/DATETIME into JS `Date`; `node:sqlite` returns strings | `dateStrings: true` |
| 2 | Money arithmetic broken, strict equality failing | mysql2 returns DECIMAL as **string** (`'120000.00'`) | `decimalNumbers: true` (safe: all money is `DECIMAL(≤12,2)`) |
| 3 | `ER_PARSE_ERROR` in payroll | `MAX(a,b)`/`MIN(a,b)` are scalar in SQLite but **aggregate-only** in MySQL | 3 sites rewritten as portable `CASE WHEN` |
| 4 | `ER_TRUNCATED_WRONG_VALUE` on writes | raw `new Date().toISOString()` (`T`/`Z` form) into DATETIME | 6 call sites fixed + `normalizeMysqlParams()` safety net |
| 5 | Persistence tests asserted SQLite internals | test-side assumption | made driver-aware (no coverage lost) |
| 6 | **HTTP 500 on attendance & teacher CSV export** | MySQL 8 enforces `ONLY_FULL_GROUP_BY`; SQLite silently picks an arbitrary row | 2 queries in `exports.js` given complete `GROUP BY` lists |
| 7 | Load-test seeding crashed | `INSERT OR IGNORE` is SQLite-only; and `bulkInsert` wrote via the global pool while reads used the transaction handle — **different connections on MySQL**, so rows were invisible mid-transaction | routed through `db.insertIgnore()`; `bulkInsert` now takes the transaction handle |
| 8 | **`ER_DUP_ENTRY` 500s under concurrency** (found at 1,000 users) | `getGradingConfig()` did check-then-insert; two concurrent requests both insert, loser hits the UNIQUE key | idempotent `insertIgnore` + re-read |

Bug #8 is the kind of defect only a real concurrent load test against a real
server can surface — it is invisible in single-threaded tests.

A codebase-wide `ONLY_FULL_GROUP_BY` audit (`.audit-tools/only-full-group-by.js`)
now reports **no remaining risks**.

---

## 8. Transactions, concurrency and connection pooling

`test/mysql-runtime.test.js` — **19/19 pass** against the live server:

- commit and rollback both durable and correct;
- constraint violation mid-transaction rolls the whole unit back;
- **concurrent counter updates produce no lost updates**;
- concurrent unique-key inserts: exactly one winner, loser fails cleanly;
- pool never exceeds its configured bound;
- **no connection leak** after success, after error, or after rollback;
- SQL-level cross-tenant isolation;
- utf8mb4 (Arabic text) round-trips byte-exact.

**HTTP users ≠ MySQL connections — measured, not assumed:**

| HTTP users | Max MySQL connections | Pool size |
|---|---|---|
| 20 | 26 | 25 |
| 1,000 | **26** | 25 |
| 2,000 | **26** | 25 |
| 5,000 | **26** | 25 |

5,000 concurrent HTTP users were served by **26 MySQL connections** (25 pooled
+ 1 metrics sampler) out of 300 available. `threadsCreated: 0` during the
steady-state stages confirms connections are reused, not churned.

---

## 9. Load tests against MySQL — real measured metrics

App, load generator and MySQL share **2 vCPU / 3.9 GB RAM**, so these numbers
are a floor, not a ceiling.

### Paced (realistic think time — 0.1 req/user/s)

| Users | rps | p50 | p90 | p97.5 | p99 | max | timeouts | 5xx |
|---|---|---|---|---|---|---|---|---|
| 5,000 | 500 | 213 ms | 481 ms | 747 ms | **1,128 ms** | 3,231 ms | **0** | **0** |
| 1,000 (15-min soak) | 496 | 203 ms | 814 ms | 1,461 ms | 2,302 ms | 9,907 ms | **0** | **0** |

### Closed-loop (zero think time — deliberate saturation)

| Users | rps | p50 | p90 | p99 | max | timeouts | 5xx |
|---|---|---|---|---|---|---|---|
| 1,000 | 1,979 | 61 ms | 96 ms | 13,929 ms | 56,674 ms | 14 | **0** |
| 2,000 | 1,738 | 103 ms | 159 ms | 20,640 ms | 59,951 ms | 1,523 | **0** |
| 5,000 | 1,757 | 72 ms | 123 ms | 18,372 ms | 60,002 ms | 6,386 | **0** |

Closed-loop with zero think time is an overload probe: 5,000 users with no
pause offer far more load than 2 vCPUs can absorb, so requests queue and the
tail explodes. The important result is that **the system degrades by queueing,
never by failing** — 0 HTTP 5xx and no crash in every single stage.

### Server-side and MySQL metrics

| Metric | 5,000 paced | 15-min soak |
|---|---|---|
| Event-loop lag (p50 / p99 / max) | 22.8 / 53.6 / 91.2 ms | 22.2 / 60.5 / 104.5 ms |
| App RSS | ~194 MB | 193.7 → **194.1 MB** (flat) |
| App heap used | — | 72.8 → 56.1 MB (max 91) |
| mysqld RSS | 1,298 MB | 800 MB |
| mysqld CPU | 47.1 % | 51.6 % |
| MySQL questions | 481,162 | **2,247,571** |
| **Slow queries (>0.5 s)** | **0** | 2 |
| **Deadlocks** | **0** | **0** |
| Row-lock waits | 215 (avg 3 ms) | 762 (avg 2 ms) |
| Lock-wait timeouts / table-lock waits | 0 | 0 |
| Tmp disk tables | 0 | 0 |
| Aborted connects | 0 | 0 |

**Zero deadlocks across every stage** — including 2.25 M queries in the soak.

---

## 10. EXPLAIN-driven query audit

`.audit-tools/explain-audit.js` runs EXPLAIN against the **seeded** database
(real volume) for the hottest tenant-scoped queries:

| Query | type | Key used | Rows |
|---|---|---|---|
| students: tenant list page | ref | `idx_students_directory` | 111 |
| students: admission_no lookup | const | PK/unique | 1 |
| attendance: student history | ref | `madrasa_id` (backward index scan) | 12 |
| attendance: class register for a day | ref | `idx_attendance_reporting` | 1 |
| results: student term results | ref | `madrasa_id` | 1 |
| results: class broadsheet | ref | `idx_results_workflow` | 1 |
| fee_assignments: outstanding | ref | `madrasa_id` | 120 |
| fee_payments: recent | ref | `idx_fee_payments_reporting` | 79 |
| users: login by username | const | unique | 1 |
| users: tenant staff list | ref | `idx_users_tenant_role` | 1 |
| activity_log: tenant audit trail | ref | `idx_activity_log_audit` | 80 |
| library_loans: active | ref | `idx_library_loans_active` | 1 |
| announcements: tenant feed | ref | `idx_announcements_delivery` | 8 |
| notifications: unread | ref | `idx_notifications_recipient` | 1 |

**Result: no full table scans, no unindexed lookups, no plan over budget.**
Worst case examines 120 rows. This is consistent with the 0 slow queries
measured under load.

Index work was done via migration `034_mysql_index_audit` (7 redundant indexes
dropped, 1 missing tenant index added) — **no duplicate indexes, nothing
optimised blindly, no data removed.**

---

## 11. SQL-compatibility regression sweep

Swept the whole `server/` tree for dialect hazards. Every remaining occurrence
is correctly guarded by a `db.dialect()` branch:

| Hazard | Status |
|---|---|
| `INSERT OR IGNORE` / `INSERT OR REPLACE` | guarded (`db.insertIgnore`, or explicit `dialect === "sqlite" ? ... : "INSERT IGNORE"`) |
| `ON CONFLICT ... DO UPDATE` | guarded — MySQL branch uses `ON DUPLICATE KEY UPDATE` (fees, madrasa, platform, quran-progress, session-store) |
| `RETURNING` | not used |
| SQLite date functions (`strftime`, `julianday`, `date('now')`) | guarded — `analytics.js` uses `DATE_FORMAT` on MySQL |
| Boolean assumptions | verified — 0/1 integers work identically on both |
| Scalar `MAX()`/`MIN()` | **eliminated** (Bug #3) |
| ISO-8601 datetime params | **eliminated** + safety net (Bug #4) |
| `ONLY_FULL_GROUP_BY` | **eliminated**, audited clean (Bug #6) |
| Dynamic SQL / unvalidated `ORDER BY` / `LIMIT` | **safe** — all three sort sites (`students`, `classes`, `teachers`) resolve through an allowlist map with a safe default; direction is a binary `ASC`/`DESC`; `LIMIT`/`OFFSET` are bound parameters |

`test/sql-compat.test.js` (static scanner) passes on MySQL.

---

## 12. Cross-tenant isolation

Targeting **zero** leaks:

| Source | Checks | Violations |
|---|---|---|
| Isolation probe during 1,000-user run | 5,670 | **0** |
| Isolation probe during 2,000-user run | 6,076 | **0** |
| Isolation probe during 2,000-user rerun | 5,712 | **0** |
| Isolation probe during 5,000-user run | 4,312 | **0** |
| `test/tenant-isolation.test.js` on MySQL | 47 subtests | **0** |
| SQL-level isolation in `mysql-runtime` | — | **0** |
| **Total under live concurrent load** | **21,770** | **0** |

**0 cross-tenant leaks.** Isolation holds under real MySQL concurrency, not
just in single-threaded tests.

---

## 13. Security regression

`test/auth-security.test.js` + `test/tenant-isolation.test.js` on MySQL:
**65/65 pass**, including authentication, session handling, CSRF, permission
enforcement (e.g. a teacher cannot approve/publish/lock; a revoked permission
is honoured), and cross-institution access rejection.

The load generator deliberately fires SQL-injection payloads
(`' OR 1=1 --`, `Robert'); DROP TABLE students;--`, `%`, 120-char strings,
Arabic text) as search terms throughout every run: **0 HTTP 5xx across all
stages** and the schema was intact afterwards — parameterised queries hold on
MySQL.

Rate limiting is real: when the app was run with production defaults the login
probe correctly received **HTTP 429**. The load-test harness raises those
ceilings deliberately (all simulated users share one IP) — brute-force
protection is verified separately with default limits.

**No security control was weakened and no tenant isolation was bypassed.**

---

## 14. MySQL failure and recovery

`.audit-tools/mysql-failure-recovery.js` — **7/7 checks pass**:

| Scenario | Result |
|---|---|
| Baseline request | HTTP 200 |
| All pooled connections killed server-side (`KILL CONNECTION`) | app does **not** crash |
| Request during outage | fails **cleanly and fast** (no hang, no 60 s stall) |
| Error body | **no stack trace leaked** to the client |
| Automatic recovery | HTTP 200 again, **without restarting the app** |
| Data durability | 11,020 → 11,020 students, intact |
| Pool health after recovery | **10/10** requests OK |

**Harder test — full `mysqld` shutdown and restart:**

- the app logged `Server shutdown in progress` (`errno 1053`) and **stayed alive**;
- the process never crashed or needed a restart;
- after mysqld came back: login **HTTP 200**, authenticated reads **15/15 OK**.

The pool self-heals across a complete database restart.

---

## 15. Sustained memory / resource test

15-minute continuous hold, 1,000 concurrent users, paced:

| Metric | Start | End | Verdict |
|---|---|---|---|
| App RSS | 193.7 MB | **194.1 MB** | flat — **no leak** |
| App heap used | 72.8 MB | **56.1 MB** | ended *lower* (GC healthy) |
| Event-loop lag p99 | — | 60.5 ms | stable |
| MySQL connections | 25 pooled | 25 pooled | no growth |
| Queries served | — | **2,247,571** | — |
| Deadlocks | — | **0** | — |
| Timeouts / 5xx | — | **0 / 0** | — |

No memory growth, no connection growth, no file-descriptor growth over 2.25 M
queries.

---

## 16. SQLite vs MySQL comparison

| Dimension | SQLite | MySQL 8.0.36 |
|---|---|---|
| Full test suite | 496 / 496 pass | **514 / 514 pass** |
| Suite duration | ~275 s | ~583 s |
| Migrations on empty DB | 35 / 35 | 35 / 35 |
| Tables / indexes | 87 | 87 / 233 (0 duplicates) |
| Foreign keys enforced | no (app layer) | 1 declared + app layer |
| 5,000 users paced — rps | 501 | **500** |
| 5,000 users paced — p50 | 107 ms | 213 ms |
| 5,000 users paced — p99 | 667 ms | 1,128 ms |
| 5,000 users paced — max | 2,544 ms | 3,231 ms |
| 5,000 users paced — timeouts / 5xx | 0 / 0 | **0 / 0** |
| 1,000 closed-loop — rps | 1,029 | **1,979** |
| 2,000 closed-loop — rps | 1,101 | **1,738** |
| 5,000 closed-loop — rps | 871 | **1,757** |
| 5,000 closed-loop — p50 | 5,426 ms | **72 ms** |
| Concurrent writes | single-writer lock | row-level (InnoDB), 0 deadlocks |
| Deadlocks observed | n/a | **0** |
| Cross-tenant leaks | 0 | **0** |
| Strictness | permissive (silently accepts bad `GROUP BY`) | strict — caught 6 latent bugs |

**Reading this fairly:** at realistic paced load the two are equivalent
(~500 rps, bounded by 2 shared vCPUs). Under saturation MySQL is decisively
better — **2× the throughput at 5,000 users and a p50 75× lower** (72 ms vs
5,426 ms), because SQLite serialises writes on a single lock while InnoDB uses
row-level locking. MySQL's per-query latency is slightly higher at low load
(network round-trip vs in-process), which is the expected and acceptable
trade.

---

## 17. Scope discipline

- BELLO was **not** redesigned; the DB architecture was **not** replaced.
- **SQLite support is fully intact and remains the default** (496/496 green).
- No test deleted, skipped or weakened; the suite **grew** by 19 tests.
- No security control weakened; no tenant isolation bypassed.
- All schema changes went through a migration (`034_mysql_index_audit`).
- No duplicate indexes; no blind optimisation; no data removed.
- No deadlock error was suppressed — the concurrency bug (#8) was fixed at its
  root (check-then-act race), not silenced.
- No credentials hard-coded or committed; env vars only.
- No production database was used.

## 18. Honest limitations

- All three roles (app, load generator, MySQL) share **2 vCPU / 3.9 GB RAM**.
  Absolute throughput numbers would be materially higher on separate hosts;
  they are a floor.
- MySQL 8.0.36 was **built from source** in the sandbox because no package
  mirror or container registry was reachable. It is a genuine MySQL 8 server
  running with default strict `sql_mode`, but it is not a vendor-packaged build.
- Replication, failover to a replica, and TLS-encrypted connections were not
  tested — no second host was available.
- The closed-loop 5,000-user stage is an overload probe, not a capacity claim.

---

## Verdict

- Live MySQL 8.0.36, strict default `sql_mode` — **executed, not simulated**
- Migrations on an empty database — **35/35, exit 0**
- Schema, PKs, indexes, tenant coverage — **verified, 0 duplicate indexes**
- Full suite on MySQL — **514/514, 0 fail, 0 skipped, EXIT=0**
- SQLite regression — **496/496, still the default**
- Transactions, rollback, concurrency, pooling, leaks — **19/19**
- 1,000 / 2,000 / 5,000 users on MySQL — **all executed, 0 HTTP 5xx everywhere**
- Deadlocks — **0**; slow queries under paced load — **0**
- EXPLAIN audit — **no full scans, no unindexed lookups**
- Cross-tenant isolation — **21,770 live checks, 0 leaks**
- Security regression — **65/65**
- Failure/recovery incl. full mysqld restart — **7/7, self-healing**
- Sustained 15-min soak — **no leak, 2.25 M queries, 0 timeouts**
- Eight real MySQL-only bugs — **found, root-caused, fixed, regression-tested**

**PASS — MYSQL 8 FULL VERIFICATION PASSED**
