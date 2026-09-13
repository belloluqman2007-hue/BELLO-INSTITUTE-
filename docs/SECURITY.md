# Security Audit

Date: 2026-09-09. Scope: the whole new codebase. Method: code review +
automated tests (`npm test`, 47 tests) + live end-to-end probes
(`test/smoke.sh`, 29 checks) against a running server with two tenant
madaris. **All checks pass.** Bugs found during this audit are listed at the
bottom with their fixes.

## 1. Authentication

- Passwords hashed with **bcrypt (cost 10)** — `bcryptjs`; no plaintext or
  reversible storage anywhere.
- Login compares hashes; response does not leak whether the username exists
  differently from a wrong password (both → `401 Invalid username or
  password.`).
- Sessions: `express-session` with a long random `SESSION_SECRET` (≥32 chars
  enforced in production). Cookie `mm_session` is `httpOnly`, `sameSite:
  lax`, `secure` in production, 12-hour lifetime.
- Login brute-force protection: rate limit **per (IP + username)** — 10
  attempts / 15 min default. Verified: 25 rapid failed logins → `429`.
- Account lifecycle: deactivated users are rejected at login (`403`);
  suspended madaris' users are rejected (`403`), verified by test.
- Password change requires the current password and rotates the session.
- **The admin sign-in page (`/login`) is a real password gate**: it renders
  the form even when the visitor's session cookie is still valid (a live
  session only adds a *"you are already signed in"* notice with an explicit
  Continue action — never silent, passwordless entry into the super-admin
  console). Verified by browser-level test (`test/admin-login.test.js`).
- A session that ends server-side (logged out elsewhere, expired,
  deactivated) makes the next authenticated API call answer `401`; the SPA
  then drops its in-memory session state and falls back to the sign-in page
  instead of rendering an admin shell from stale state. Same test file.

## 2. Authorization (role boundaries)

Every route is guarded by `requireAuth` + role checks; the tenant middleware
resolves the caller's madrasa. Verified by test:

- Madrasa admin → `/api/platform/*` : **403**
- Student → student list : **403**; student → results save : **403**
- Teacher → results only in **assigned** class+subject; unassigned class →
  **404**; another madrasa's class → **404**
- Student detail by id: **staff-only** (403 for student/parent)
- Super admin is the only role with `/api/platform/*` access

## 3. Tenant isolation (the critical requirement)

Enforcement model: `requireTenant` sets the effective `madrasa_id` from the
**authenticated user's own record** — never from the request. Every
tenant-owned query filters by it. A forged `madrasa_id` in the request body
is ignored (the tenant middleware does not read it).

Verified Madrasa-A → Madrasa-B attempts (all must — and do — fail):

| Attack | Result |
| ------ | ------ |
| `GET /api/students?classId=<B's class>` | 0 rows |
| `GET /api/students/<B's student id>` | 404 |
| `PUT /api/students/<B's student>/status` | 404 |
| `GET /api/results/report-card/<B's student>/<B's term>` | 404 |
| `POST /api/results/compute` with B's class | 404 |
| `DELETE /api/announcements/<B's announcement>` | 404 |
| `PUT /api/results` grading a B-class student | 404 (row not touched) |
| `POST /api/students` with `class_id` from B | 400 (rejected) |
| `POST /api/students` with forged `madrasa_id: B` | created in **A** (forgery ignored) |

Same-tenant scoping also verified: teacher sees only assigned-class
students; parent sees only linked children (unlinked child → 400); student
sees only own records.

## 4. Injection & input validation

- **SQLi:** all queries use parameterized statements (`?` placeholders); no
  string interpolation of user input into SQL. Verified: SQLi payloads in
  login are rejected and create no session.
- **Body validation:** numeric ids parsed with `toNum()` (non-numeric → 0 →
  not-found); enums (roles, statuses, genders) checked against allow-lists;
  strings length-capped. Malformed JSON → 400.
- **XSS:** report-card HTML and all API JSON responses escape user content
  where rendered; frontend renders data via `textContent`/escaping helpers.
- **Uploads:** multer with file-type + size limits; filenames are
  regenerated (original names not used on disk); stored under `uploads/`.

## 5. CSRF

Double-submit token bound to the session: `GET /api/auth/csrf-token` returns
the session token; mutating requests must echo it in `x-csrf-token`.
Verified: mutation without token → **403**; with valid token → 200; token
from a *different session* → 403.

## 6. API & transport security

- **Helmet** security headers on all responses.
- **CORS:** same-origin by default; `CORS_ORIGINS` env allow-list only when
  explicitly configured.
- **Rate limiting:** global per-IP API limiter (300/15 min) + stricter
  login limiter (see §1). Verified 429s in tests.
- **Unauthenticated access:** every protected route returns 401 without a
  session (verified for `/api/grading`, student list, etc.).
- **No secret material in code or repo:** `.env` and `.dev-credentials.txt`
  are git-ignored; `.env.example` holds placeholders only; production boot
  fails if template values remain.

## 7. Bugs found & fixed during this audit

| # | Finding | Fix |
| - | ------- | --- |
| 1 | `GET /api/students/:id` allowed a student to read *any* same-madrasa student's record by id | endpoint restricted to staff roles; students/parents use `/api/portal/*` |
| 2 | Teacher student-list ignored the `?classId=` filter (returned whole assigned class even for a non-assigned class) | requested class is now intersected with the teacher's assigned classes; empty → no rows |
| 3 | `grading_config` lazy-insert had a column/value count mismatch (8 values / 7 columns) — 500 on any madrasa without a pre-seeded config | INSERT fixed; covered by grading tests |
| 4 | Login rate limit was per-IP only — one office IP could starve other users | keyed per (IP + username) |

Reproduce: `npm test` (47/47) and `bash test/smoke.sh` (29/29) against a
running dev server.

## 8. Known limitations / not in scope

- No OAuth/SSO (not needed; sessions suffice) — architecture allows adding
  it later.
- No real payment gateway (per requirement).
- Password *reset* via email is not implemented (no email service
  connected); admins can re-issue accounts.
