# FINAL VERIFICATION REPORT

## Environment

- **Node** v22.22.3 (matches `engines: >=22.22.3 <23.0.0` and `.node-version`)
- **npm** 10.9.8
- **Install** `npm ci` from the committed lockfile — clean, 144 packages, **0 vulnerabilities**. The lockfile was not regenerated.
- **Database** SQLite (`node:sqlite`) for dev/test; MySQL2 pool for production, selected in `server/db.js` by `DATABASE_DRIVER`/`DATABASE_URL`.
- **Startup** Verified twice from an empty `DATA_DIR`: the boot creates the database, applies all 34 migrations, creates the super admin and listens. Also verified booting against an already-migrated database ("no pending migrations"). The ephemeral-storage warning it prints is correct and intentional behaviour, not a fault.

## Tests

Command: `npm test` (`node --test "test/*.test.js"`), the project's own runner.

| | Baseline (start of audit) | Final |
|---|---|---|
| Total | 465 | **492** |
| Passed | 465 | **492** |
| Failed | 0 | **0** |
| Skipped | 0 | **0** |
| Todo | 0 | **0** |
| Duration | ~287 s | ~286 s |

27 tests were added. No existing test was deleted, skipped, `.only`'d, weakened, or had assertions removed.

Each new suite was verified to **fail when its fix is reverted**, so it guards behaviour rather than restating the implementation:

- revert the permission gate on `/api/payroll/structures` → `module-permission-enforcement` fails
- revert the MIME-derived extension → `upload-hardening` fails
- revert the attendance tenant check → `tenant-isolation` fails

Beyond the suite, the repository's own end-to-end script `test/smoke.sh` was run against a real seeded dev server: **70 passed, 0 failed**.

## Application

Audited by driving the real HTTP API and the real database, not by reading code alone.

- **Multi-tenant isolation** — 103-probe horizontal sweep across every tenant-owned module: **0 cross-tenant reads, 0 cross-tenant mutations, 0 5xx**. Tenant id always comes from the session via `effectiveTenantId`; cross-tenant access resolves to 404. Bulk operations (`bulk-status`, `bulk-promote`) were specifically checked with mixed-tenant id lists and did not touch the neighbouring tenant.
- **Authn / authz** — unauthenticated 401; wrong password rejected; deactivated account cannot log in; session dies on logout; role boundaries hold (teacher/student/parent/madrasa_admin/super_admin).
- **Granular permissions** — all **42** probed permissions now return 403 when revoked (see *Remaining Problems* for what this looked like before). Overrides are per-request, cannot cross a tenant boundary, and cannot be self-applied.
- **Audit log** — `activity_log` records the workflow transitions; snapshots are redacted and capped; verified to contain **no password material**.
- **Result workflow** — full lifecycle exercised: draft → submitted → under review → returned → resubmitted → approved → published → locked → unlocked → unpublished. All six illegal transitions from `draft` are refused with 409; a teacher cannot approve; published and locked results are frozen against edits; 10 audit rows written.
- **Payment lifecycle** — expected → initiated → successful → verified → reconciled; duplicate `reference` rejected; negative amounts rejected; repeat reconcile is idempotent.
- **Payroll** — structures, periods, payslip generation, approval. Duplicate period refused; regeneration after approval refused; `net = gross − deductions` holds; net never negative; a teacher cannot read salary structures.
- **Leave** — request, self-approval refused, admin approval, double-approval refused.
- **Library** — issuing the last copy takes availability to 0, further issue is refused, return restores it, double-return is refused; no book can reach an impossible availability.
- **Communication / retry** — bulk send, delivery log, retry accounting never regresses, cross-tenant retry 404s.
- **Student lifecycle** — status change writes history; invalid status refused.
- **Admin dashboard / needs-attention / global search** — all 200; empty and 5000-character queries handled; search never crosses the tenant boundary.
- **Islamic vs Western** — `islamic`, `western` and `dual` each surface correctly to the client and render the dashboard. The category-neutral BELLO homepage was not given Islamic styling.
- **Public websites** — `/schools/:slug`, the directory and the public profile all serve; an unknown slug 404s; no private fields in the public payload.
- **Migrations** — fresh build of all 34 applies cleanly; ids are unique; a second run is a clean no-op. An **upgrade path** was simulated (install pinned at migration 030, populated with real rows, then upgraded): **zero row loss**, new tables/columns added, no FK violations. `foreign_key_check` and `integrity_check` both clean.
- **Frontend** — all 21 `public/js` files pass `node --check`. The SPA was loaded in jsdom against the live server (`/`, `/login`, `/register`, `/register-academy`, and the dashboard): **no JS errors**. No `console.log`, `debugger` or stray `alert` left behind. My Institution is present, there is **no** separate top-level Website menu, and there is **no** duplicate Admin Settings section.
- **Security** — CSRF enforced (missing *and* forged tokens rejected); SQL injection attempts across `search`, `sort` and `direction` neutralised with the tables intact; path traversal cannot reach `/etc/passwd` via the API or `/uploads`; CSP still `script-src 'self'` (not weakened); `nosniff` present, `x-powered-by` absent; no endpoint leaks `password_hash`.
- **Performance** — with 2,000 students and 20,000 attendance rows, the nine hottest endpoints all respond in **5–46 ms**. `EXPLAIN QUERY PLAN` confirms `idx_students_search` and `idx_attendance_tenant_day` are used: **no full table scans on hot paths**. No premature optimisation was applied.
- **TODO / placeholder sweep** — no real TODO, FIXME, stub or "coming soon" screen. The five grep hits are the word "placeholder" used legitimately (SQL bind placeholders, a `<select>` prompt, certificate field placeholders). Nothing was deleted merely to make the search look clean.
- **Dead routes** — `public/js/public.js` is an intentional, documented placeholder module and is still asserted by `smoke.sh` ("public site bundle present"), so it was **not** removed.

## Major Modules

| Module | Result |
|---|---|
| Multi-tenant isolation | Pass — 103 probes, 0 leaks |
| Authentication & sessions | Pass |
| Granular permissions | **Fixed** — 42/42 now enforce |
| Audit log | Pass |
| Admin dashboard / search | Pass |
| Student lifecycle | Pass |
| Result workflow | Pass — all transitions + all illegal ones |
| Payment lifecycle | Pass |
| Payroll | Pass |
| Leave | Pass |
| Communication / retry | Pass |
| Library | Pass |
| Documents / ID cards / certificates | Pass |
| My Institution / public websites | Pass |
| Islamic vs Western | Pass |
| Admissions | Pass |
| Uploads | **Fixed** — stored XSS closed |
| UI / UX / frontend JS | Pass |
| API security | Pass |
| Performance / indexes | Pass |
| Migrations (fresh + existing) | Pass |
| SQLite / MySQL compatibility | Pass (static — see External Blockers) |
| Startup | Pass |

## Files Changed

**Security and correctness fixes**

- `server/middleware/upload.js` — derive the stored extension from the validated MIME type instead of the client-supplied file name; mark upload rejections as client errors.
- `server/app.js` — central error handler returns 413/400 for upload rejections instead of reporting them as server crashes.
- `server/routes/attendance.js` — teacher report 404s on a teacher id from another tenant.
- `server/routes/fees.js` — choose the upsert by dialect rather than by matching on a driver error message.

**Permission enforcement** (`requireStaffPermission` wiring)

- `server/services/permissions.js` — added `requireStaffPermission` / `requireAnyStaffPermission`; extended `TEACHER_DEFAULTS` so existing teacher access is preserved.
- `server/routes/` — `academic.js`, `admissions.js`, `announcements.js`, `classes.js`, `communication.js`, `documents.js`, `expenses.js`, `exports.js`, `extras.js`, `fees.js`, `institution.js`, `leave.js`, `library.js`, `madrasa.js`, `payroll.js`, `results.js`.

**Tests**

- `test/module-permission-enforcement.test.js` (new, 19 tests)
- `test/upload-hardening.test.js` (new, 6 tests)
- `test/tenant-isolation.test.js` (extended, +2 tests)

Not changed: `db.js` abstraction, middleware structure, routes/APIs, dashboard and sidebar structure, the design system, the Islamic/Western differentiation, the public institution website system, authentication, and multi-tenant behaviour.

## Database Changes

**None.** No migration was added, edited or removed; the schema is untouched. All 34 existing migrations still apply to both a fresh and an existing database.

## Remaining Problems

None outstanding. For the record, the defects found and fixed during this audit were:

1. **Granular permissions were advisory, not enforced.** ~17 routers were guarded only by role, so revoking a permission in the admin UI changed the menu but not the API. A `madrasa_admin` with `payroll.view` revoked could still read the entire payroll. This is the most consequential finding: the permission screen promised an isolation it did not deliver, which is the kind of control an operator trusts.
2. **Stored XSS through uploaded file names.** The on-disk extension was taken from the client's file name while only the equally client-supplied MIME was checked, so `filename="evil.html"` + `Content-Type: image/png` was stored as `.html` and served same-origin as `text/html` — which also defeats the `script-src 'self'` CSP rather than being caught by it.
3. **Upload rejections reported as 500.** Correctly refused uploads told the client the server had crashed and hid the real reason.
4. **Cross-tenant attendance filter returned 200.** A foreign teacher id produced an empty report rather than 404, making it indistinguishable from a teacher with no attendance marked.
5. **Dialect detection by error-message matching** in the fees upsert, which could swallow genuine failures.

Two items were investigated and deliberately **not** changed, with reasons:

- `GET /api/library/books?id=…` ignores an unrecognised `id` parameter. This is not a filter the API defines and the frontend never sends it; ignoring unknown query parameters is normal and leaks nothing (verified: returns the caller's own tenant rows only).
- `public/js/public.js` is an intentional placeholder module, still asserted by `smoke.sh`. Per the standing instruction not to delete unused code without confirming obsolescence, it stays.

Also noted, deliberately left alone: `server/migrate.js` has two migrations sharing the `025` prefix (`025_payroll`, `025_online_fee_payments`) and one `027` ordered after `028`. Migrations are applied in **array order** and tracked by unique id in `schema_migrations`, so ordering is well-defined and correct. Renaming applied migration ids would break every existing installation. This is cosmetic, and fixing it would be the actual risk.

## External Blockers

- **MySQL could not be exercised at runtime.** No MySQL or MariaDB server is available in this environment, so the MySQL path was **not** verified by execution and I am not claiming that it was. In its place I performed a static compatibility audit: every dialect-specific construct in `server/` was enumerated and checked. All are properly branched on `db.dialect()` — `AUTOINCREMENT`/`AUTO_INCREMENT`, `INSERT OR IGNORE`/`INSERT IGNORE`, `ON CONFLICT`/`ON DUPLICATE KEY`, `strftime`/`DATE_FORMAT`, `PRAGMA table_info`/`SHOW COLUMNS`, `sqlite_master`/`SHOW TABLES`, and the partial indexes that MySQL lacks (compensated by route-level guards, as the code comments state). The generated schema was additionally checked for MySQL-specific limits: no index name exceeds 64 characters, and no `TEXT`/`BLOB` column is indexed without a prefix length or given a default (the two apparent hits are `TIMESTAMP NULL` on MySQL and only `TEXT` on SQLite). One error-message-based dialect branch was found and replaced with a proper `db.dialect()` check. **A short smoke test against a real MySQL 8 instance is still advisable before the first production deploy.**
- No `.env` is committed (correctly — it is gitignored). A local one was created for the live smoke run and **removed afterwards**; the working tree contains no credentials. Real `SESSION_SECRET` and `SUPER_ADMIN_PASSWORD` values must be supplied at deploy time.
- The persistence warning at startup is accurate: production must attach a persistent disk and point `DATA_DIR`/`DATABASE_FILE` at it, or use MySQL.

## FINAL STATUS

PASS — ALL VERIFICATIONS PASSED

---

## Addendum — Load & Scalability Verification (2026-09-21)

A follow-up campaign load-tested the running server against a seeded
55-tenant / 10,900-student / ~200k-row database: staged concurrency to
5,000 authenticated users, paced load, a 300 s memory soak, a login storm,
and a two-instance horizontal-scaling run with no sticky sessions. The suite
grew to **495/495 passing** after the performance and correctness changes
made during that work (session touch throttling, SQLite PRAGMAs, listen
backlog, PTM/portal N+1 removal, async backup writes; full detail, numbers
and remaining caveats in [`LOAD-VERIFICATION-REPORT.md`](LOAD-VERIFICATION-REPORT.md)).
The one standing caveat is unchanged: **the MySQL driver is statically
audited but not runtime-verified** — smoke-test it against a real MySQL 8
instance before the first production deploy.
