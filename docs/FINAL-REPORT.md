# BELLO — Final Report (Auth & Delivery Pass, 2026-09-23)

This report closes the 23-part engagement on the **existing** BELLO
multi-madrasa platform. Nothing was rebuilt: the architecture, database
abstraction, payment system, permission system and design language are the
ones the repository already had. Work was limited to inspection, gap-filling,
bug fixes and regression tests.

---

## 1. What existed before this pass (preserved, verified)

- **Auth & multi-tenancy** — server-side sessions (cookie + DB), bcrypt
  hashing, CSRF tokens, rate limiting, security headers/CSP, audit log,
  tenant scoping on every row (see `docs/SECURITY.md`,
  `docs/ISOLATION-AUDIT.md`).
- **Five account types** — SUPER_ADMIN, MADRASA_ADMIN (institution), TEACHER,
  STUDENT, PARENT — plus granular permissions and staff *templates*
  (Accountant, Librarian, …) as permission bundles, not hard-coded roles.
- **Portals** — teacher workspace `/teacher`, student portal `/student`,
  parent portal `/parent` with child switcher, all server-scoped.
- **Academics** — classes, subjects, groups, timetable, attendance, lesson
  plans, assignments, exams & marks, results lifecycle, report cards,
  question bank, academic calendar.
- **Fees & payments** — fee structures, invoices, the full
  Expected→Initiated→Successful→Verified→Reconciled payment lifecycle with
  Paystack/Flutterwave support and webhook verification.
- **Operations** — admissions, payroll, leave, library, expenses, documents,
  announcements, messaging, notifications, PTM booking, public website,
  platform console (madaris, plans, analytics, backups, support).
- **Database** — one abstraction: `node:sqlite` (dev) / `mysql2` (prod),
  35 migrations, now 38.
- **Tests** — 535 automated tests (API, isolation, browser-level via jsdom,
  load, MySQL-8 runtime opt-in).

## 2. What changed in this pass (by part)

| Parts | Change |
|-------|--------|
| 1–3 (login) | `/login` became the **single unified form for all five account types** — no role chooser. Optional **Remember me** (longer cookie, same account). Show/hide password, inline validation, branded card, keyboard/mobile/a11y polish. The server returns the role; the page hands off to the right workspace (admin dashboards, `/teacher`, `/student`, `/parent`). |
| 4–5 (audit) | Full auth/tenant audit re-run; **one real bug found and fixed** (below). Tenant isolation of every new endpoint is regression-tested. |
| 6–8 (auth flows) | Secure logout everywhere; **complete forgot/reset password flow**: generic answers (no account enumeration), single-use tokens with expiry (hashed at rest), old tokens and **all existing sessions invalidated on reset**, rate-limited, admin-visible reset links for schools without email. |
| 9–14 (delivery) | Teacher workspace gained **online examination management**; student portal gained the **exam runner**; parent portal gained **per-child exam visibility** and **online fee payment**; exam publish/release push notifications through the existing system. |
| 15–17 | Verified super-admin console and staff templates already satisfied the requirements; Islamic/Western category behaviour preserved (Qur'an module only for Islamic institutions, server-enforced). |
| 18–20 | No new abstraction, no duplicate payment system. Two migrations (036, 037) written dialect-aware for both SQLite and MySQL with tenant + lookup indexes; queries batched to avoid N+1. |
| 21–22 | **Four new test suites (46 tests)**; full suite run and green. Failures were fixed, never skipped or weakened. |
| 23 | This report + `docs/FEATURE-MATRIX.md` update. |

### Bugs found and fixed (not papered over)

1. **`POST /api/payments/initiate` answered 503 “gateway not configured”
   before authorization** — an unlinked parent, a cross-tenant fee item or an
   invalid amount all got the misleading 503 instead of 403/404/400. The
   gateway check now runs **after** tenant/child-link/amount validation.
2. **MySQL-unsafe datetime writes** — two new inserts used
   `toISOString()` (UTC + `Z`), which is not the schema's datetime
   convention and is unsafe for MySQL `DATETIME`/`TIMESTAMP` columns.
   Normalized to `YYYY-MM-DD HH:MM:SS` (server-local), matching
   `CURRENT_TIMESTAMP` semantics everywhere else.
3. **Exam-runner intervals** now self-clear when the student navigates away
   (no detached-page timers).

## 3. What was added

- **Migration 036 `password_reset_tokens`** — token hash, user, expiry,
  used-at, requested-by IP; indexes on token and user.
- **Migration 037 online examinations** — `online_exams` (class, subject,
  title, instructions, duration, start/end, status, total marks, release
  flag), `online_exam_questions` (type, prompt, options, correct answer,
  explanation, marks, order), `exam_attempts` (status, started, expires,
  submitted, score), `exam_answers` (attempt, question, response, auto
  score, teacher score); tenant + class + attempt indexes.
- **Auth API** — `/api/auth/forgot-password`, `/api/auth/reset-password`,
  `/api/auth/reset-requests` (admin).
- **Exams API** — `/api/academic/online-exams*`: create, update, publish
  (gate: has questions, no timetable conflict), question CRUD + bank import,
  attempts queue, grade (subjective, over-award guarded), release.
- **Portal API** — `/portal/online-exams*`: list, start (server-issued
  deadline), save, submit, review (answers/explanations only after release).
- **Frontend** — `/forgot-password` + `/reset-password` pages; login card
  upgrades; Teacher → Online Exams manager; Student → Online Exams runner
  (navigator, autosave, submit confirm, timer); Parent → Pay-online +
  receipts; exam notifications in the bell.

## 4. Incomplete / limitations (truthful)

- **No live payment gateway is connected in this environment** —
  `paymentGateway: none`. The initiate path is fully implemented and
  authorized; with no provider configured it returns 503 *after*
  validation. Tests verify every authorization, validation and
  no-client-side-success rule up to the provider boundary; provider
  callback/webhook signature flows reuse the existing (tested) architecture.
- **No MySQL server exists in this sandbox.** The MySQL runtime suite is
  opt-in (`TEST_DB_DRIVER=mysql` + live server) and skips by design here.
  SQLite parity is fully tested; migrations 036/037 are dialect-aware and
  datetime formats were normalized specifically for MySQL correctness.
- **Email delivery requires a configured provider.** Without one, password
  reset links are not emailed but are always visible to the institution's
  administrators — a deliberate, safe fallback for offline schools.
- Demo/sandbox data only; no production deployment was performed.

## 5. Test results

- **Full suite: 581/581 pass, 0 fail, 0 skipped** (~286 s):
  - 535 pre-existing tests — still green, none weakened, deleted or skipped.
  - 🆕 `test/password-reset.test.js` — 14 (no enumeration, expiry,
    single-use, session invalidation, rate limit, admin links).
  - 🆕 `test/online-exams.test.js` — 13 (permission gating, publish gates,
    question lifecycle + bank import, answer-leak prevention, attempt
    locking, duplicate-submit prevention, expiry auto-finalize, grading +
    release, class/tenant isolation, parent follow-only, notifications).
  - 🆕 `test/parent-payments.test.js` — 9 (authorization, linked-child and
    tenant scoping, amount validation, **no client path to success**,
    webhook signature, status scoping, fee breakdowns, callback contract).
  - 🆕 `test/unified-login-ui.test.js` — 10 (jsdom: one form, no role
    chooser, show/hide + a11y states, remember-me, hand-off for teacher /
    student / admin, wrong-credential UX, forgot/reset pages, online-exam
    nav, pay-online button).
- Live boot checks: `/login`, `/forgot-password`, `/reset-password`,
  `/teacher` all serve 200; login/forgot/reset verified over HTTP against a
  real server; `seed.js --demo` runs clean on the new migrations.

## 6. Security results (re-verified)

- Role and tenant **always** come from the server session — never query,
  body or hidden fields. Verified for every new endpoint by tests
  (cross-tenant → 404/403 for admin, teacher, student, parent).
- Correct answers/explanations are **never** sent to students before
  release — asserted across list, start and review payloads.
- Payment status is **never** changed from the client: PATCH/PUT/POST
  verify/webhook paths all rejected; only the signed webhook/callback can.
- Password reset: no enumeration, single-use expiring tokens (hashed),
  sessions invalidated, rate-limited, CSRF-protected, audited.
- Existing protections untouched: bcrypt, session regeneration, CSRF,
  rate limits, security headers/CSP, audit log, `no-store` on auth APIs.

## 7. Database compatibility

- Single abstraction (dev SQLite / prod mysql2) — unchanged.
- Migrations 036/037 written for both dialects with the same migration
  runner; tenant and lookup indexes included.
- All datetime writes now use `YYYY-MM-DD HH:MM:SS` (server-local),
  matching the existing convention; mysql2 reads with `dateStrings: true`,
  so expiry comparisons are consistent string comparisons.

## 8. Exact login flow (all five account types)

1. **Any user** opens **`/login`** — one form: email/username + password,
   optional *Remember me*, *Forgot password?* link. No role selection.
2. On submit the SPA `POST /api/auth/login` (CSRF token included).
3. The **server** verifies credentials + rate limit, loads the user with
   role, madrasa and permissions, rotates the session, audits the login,
   and returns the workspace target.
4. The page shows a short *Opening your workspace…* hand-off and routes:
   - **SUPER_ADMIN** → `/admin` platform console (all madaris).
   - **MADRASA_ADMIN** → `/admin` dashboard scoped to their institution
     (server-side madrasa_id).
   - **TEACHER** → `/teacher` workspace (own classes/subjects only).
   - **STUDENT** → `/student` portal (own records only).
   - **PARENT** → `/parent` family portal (linked children only, validated
     per request).
5. Wrong credentials → one generic message, username preserved, audited,
   rate-limited per IP+account.
6. *Forgot password?* → generic confirmation; single-use link (email if
   provider configured, otherwise the admin queue) → `/reset-password?…` →
   new password → old sessions and tokens die immediately.
7. Portals also serve their own sign-in card at `/teacher`, `/student`,
   `/parent` — same server flow, same guarantees.

## 9. Files touched in this pass

`server/migrate.js` · `server/config.js` · `server/middleware/ratelimit.js`
· `server/routes/auth.js`, `academic.js`, `portal.js`, `payment.js`,
`fees.js` · `public/js/app.js`, `api.js`, `dashboard.js`, `portal.js`,
`portal-student.js`, `portal-teacher.js`, `portal-parent.js`,
`academic-admissions.js` · `public/css/dashboard.css`, `portal.css` ·
`test/password-reset.test.js`, `test/online-exams.test.js`,
`test/parent-payments.test.js`, `test/unified-login-ui.test.js`,
`test/helpers.js` · `.env.example` · `README.md` · `docs/FEATURE-MATRIX.md`
· this report.
