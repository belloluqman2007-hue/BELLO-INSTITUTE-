# Multi-Madrasa Management Platform

A completely independent, multi-tenant SaaS platform for managing Islamic
madaris in Ijebu-Ode, Ogun State, Nigeria — students, teachers, classes,
subjects, academic sessions & terms, results with printable report cards,
attendance, fees, and announcements. Bilingual (English + العربية), with
proper RTL rendering, mobile-first.

> **Independence statement:** this project is a fresh codebase. It contains
> **no** reference to the old single-school result system — no old database,
> credentials, domains, hosting projects, keys, or identities. The old
> production system is untouched and this platform never connects to it.
> See [`docs/ISOLATION-AUDIT.md`](docs/ISOLATION-AUDIT.md) for the full audit
> trail and [`docs/SECURITY.md`](docs/SECURITY.md) for the security audit.

---

## Quick start (development)

Requirements: **Node.js >=22.22.3 and <23** (the Render runtime is pinned to
22.22.3; uses the built-in `node:sqlite` for the dev database — no external DB
server needed).

```bash
npm install
npm run dev        # migrate + serve on http://localhost:3000
```

First run creates the dev SQLite database (`data/madrasa_platform.sqlite`)
and one super-admin account.

**The first boot always prints how to sign in.** If `SUPER_ADMIN_PASSWORD` is
not set (the normal state of a fresh clone), the seed generates a password
rather than skipping account creation, and prints it as a banner:

```
──────────────────────────────────────────────────────────────
  SUPER_ADMIN_PASSWORD was not set, so a development super
  admin was created with a generated password:
      username: admin
      password: Dev-xxxxxxxxxxxx!
  (also written to .dev-credentials.txt — git-ignored)
──────────────────────────────────────────────────────────────
```

Set `SUPER_ADMIN_PASSWORD` in `.env` before the first boot to choose your own.
Usernames are **case-insensitive** (`Admin` and `admin` are the same account).

```bash
npm run seed -- --demo   # optional: add 2 demo madaris with users, classes, results,
                         #            timetables, published results and public-site flags
npm test                 # automated suite (isolated temp database, 215 tests —
                         # includes browser-level checks that drive public/js/app.js in jsdom)
bash test/smoke.sh       # end-to-end checks against a running dev server (70 checks)
```

### "I type my username and password and nothing happens"

Almost always one of these — the sign-in form now names each one on screen
instead of failing silently:

| What the form says | What it means | Fix |
| ------------------ | ------------- | --- |
| *This platform has no accounts yet…* | The database is empty — the super admin was never created (e.g. `SUPER_ADMIN_PASSWORD` was unset on a host that skipped seeding, or the data directory was wiped). | `npm run reset-admin-password` with `SUPER_ADMIN_PASSWORD` set |
| *Invalid username or password.* | The account exists; the credentials are wrong. | `npm run reset-admin-password` to set a known password |
| *Those details are correct, but the … account has no administrator dashboard* | A teacher/student/parent account — correct password, no admin console. | Sign in with an admin account |
| *Too many sign-in attempts…* | Rate limit (`LOGIN_RATE_LIMIT`, default 10 per 15 min). | Wait, or raise the limit |

### Demo logins (after `npm run seed -- --demo`)

| Role          | Username                  | Password      |
| ------------- | ------------------------- | ------------- |
| Super Admin   | `admin`                   | see `.dev-credentials.txt` (local only, git-ignored) |
| Madrasa Admin (Quraniyya) | `demo-quraniyya-admin` | `Demo1234!` |
| Madrasa Admin (Fatihah)   | `demo-fatihah-admin`   | `Demo1234!` |
| Teacher       | `demo-quraniyya-ust1`     | `Demo1234!`   |
| Parent        | `demo-quraniyya-parent1`  | `Parent1234!` |
| Student       | `demo-quraniyya-stu1`     | `Student1234!`|

(`demo-fatihah-…` accounts exist for the second madrasa as well. Parent 1 is
linked to two children, demonstrating the multi-child parent portal.)

Demo data is generated **relative to the date you run the seed** — the academic
session spans the current September→August year, attendance covers the last 20
weekdays, and fee payments are spread over the last few months. The dashboards
and analytics windows are therefore always populated, whenever you seed.

---

## Roles & permissions (enforced on the backend)

**Admin sign-in** lives at **`/login`** (the `Login` link on every public
page). It **always asks for a username and password** — a still-valid session
never opens the console on its own; it only adds a *"you are already signed
in as …"* notice with an explicit **Continue** action. **`/admin`** is the
admin section's own address (it falls back to the sign-in page when the
visitor is not authenticated), and Islamic School, Western Academy and
platform administrators all use the same form — BELLO routes each one to the
right dashboard. If a session ends server-side while a dashboard is open, the
next request bounces the tab back to the sign-in page instead of painting a
console whose every call fails.

| Role | Access |
| ---- | ------ |
| **SUPER ADMIN** | All madaris: create/suspend, plans (FREE / BASIC / PREMIUM with student & teacher limits and feature flags), platform stats **and platform-wide analytics**, activity log, platform settings. |
| **MADRASA ADMIN** | Everything *within their own madrasa*: students, teachers, classes, subjects (Arabic + English names — not hard-coded), sessions, terms, results, attendance, fees, announcements, **analytics dashboards**, school profile/logo/settings, grading config (CA max, exam max, pass mark, grade bands, promotion rules). |
| **TEACHER** | Only classes/subjects assigned to them: view those rosters, enter/save results and attendance for them. |
| **STUDENT** | Own profile, own results (all terms), own printable report card, announcements. |
| **PARENT** | Linked children only: profiles, results, report cards, announcements. |

Tenant isolation is enforced by server-side middleware on every route: each
request is scoped to `req.user.madrasa_id`, and every tenant-owned query
filters by it. A Madrasa A account can never reach Madrasa B data via URL,
ID, query parameter, or forged form fields — verified by automated tests
(see `docs/SECURITY.md`).

## Project structure

```
server/            Express API (Node 22, no framework magic)
  config.js        env parsing + production validation (fails fast on bad config)
  db.js            node:sqlite (dev) / mysql2 (production) — same query API
  migrate.js       idempotent migrations (run automatically on boot)
  seed.js          super-admin bootstrap + --demo data
  middleware/      auth (sessions), tenant scoping, uploads, rate limiting
  routes/          auth, platform, madrasa, students, teachers, classes/
                   subjects/sessions/grading, results, attendance, fees,
                   announcements, portal, public (logged-out site),
                   admissions, timetable, payroll, leave (staff leave),
                   exports, backups
  services/        grading engine (configurable per madrasa), admissions,
                   analytics (dashboard aggregates, tenant- and platform-wide),
                   persistence (storage probe), backup (snapshot/restore),
                   csv (Excel-safe exports), tokens (short-lived public links)
  backup.js        `npm run backup` — snapshot / --list / --restore / --import
public/            static mobile-first SPA (hash routing, EN/AR, RTL,
                   light/dark theme, public site rendered without a session)
test/              npm test suite + smoke.sh end-to-end
docs/              isolation audit, database, deployment, security docs
render.yaml        NEW Render service definition (production)
```

## Key features (as delivered)

- **Results engine, fully configurable per madrasa** — CA structure & max,
  exam max, pass mark, grade boundaries, remarks, competition positions,
  promotion rules (minimum average and/or required pass). Term results,
  class-wide computation, per-student summaries.
- **Professional printable report cards** — madrasa logo/name/motto/address,
  student photo/name/admission number/class/session/term, per-subject scores,
  totals, average, grade, remarks, position, attendance, teacher & admin
  comments, promotion status. Arabic + RTL when Arabic names are present.
- **Student & parent portals** — login, profiles, results history,
  download/print report cards, announcements.
- **Admission numbers** — per-madrasa prefix (from settings or slug),
  sequential 4-digit suffix.
- **Photos & logo uploads** — validated file types/size, stored under
  `uploads/` (outside the API surface).
- **Arabic + English everywhere** — UI language toggle, per-record Arabic
  names, RTL layout for Arabic.
- **Public site, before login** — a landing page with live totals, a searchable
  madrasa directory, and per-school public pages (profile, notices, result
  checking, online admission form) at `#/madrasa`, `#/madrasa/<slug>`,
  `#/results-check`, `#/apply/<slug>`. Every section is switched on by the
  school itself (`public_listing` / `public_results` / `public_admissions`) and
  a platform-wide kill switch; results only ever come from *published* term
  summaries, printable cards use a 15-minute signed link, applications are
  rate-limited, honeypotted and de-duplicated. No session is created for
  anonymous visitors.
- **Timetables** — weekly grid per class (Mon–Sat × periods, subject/teacher/
  room), replace-all save inside a transaction, copy one class's week onto
  others, a standalone printable sheet, and a `My week` view for students,
  parents and teachers.
- **Admission queue** — public applications arrive in `Admissions` for review
  (approve / hold / reject, with a note); approving creates the student record
  with the next admission number and, optionally, the pupil's and guardian's
  portal accounts. Applicants track their own request with a reference number
  plus the phone they gave.
- **CSV exports** — students, results, term summary, attendance, fees and the
  admission queue, as UTF-8 BOM + CRLF files Excel opens correctly, with
  formula-injection guards on every cell.
- **Backups, snapshots and storage diagnostics** — the platform writes a JSON
  snapshot of every table before each migration, on shutdown and on a timer,
  and tells the operator in plain words when the host's filesystem is
  throwaway (the reason records used to disappear). `Platform → Backups &
  storage`, `npm run backup`, [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md).
- **Dark mode** — light/dark themes from CSS custom properties, chosen
  automatically from the operating system and remembered per browser.
- **Analytics dashboards** — enrolment trends, students per class, gender and
  age distribution, daily attendance rate, fee collection trends and method
  mix, grade distribution, per-class and per-term averages, and a "needs
  attention" watch list (below pass mark and/or low attendance). Selectable
  6/12/24-month and 14/30/60/90-day windows. Charts are hand-built inline SVG
  in `public/js/charts.js` — no chart library, because the app's
  `script-src 'self'` CSP forbids one. Aggregates are read-only over the
  existing schema (no new tables, no migration) and every query is filtered by
  `madrasa_id`. A separate platform-wide view for the super admin covers tenant
  growth, plan mix, largest madaris and activity volume.

- **Per-school share links** — every registered madrasa gets its own link
  (`/s/<slug>`, with `/school/<slug>` and `/m/<slug>` aliases) that opens
  that school's own public page directly instead of the platform landing.
  The link is shown with a copy button on the school's public page and in
  `School Settings`, and on the super-admin's madrasa detail screen.
- **Complete administrator workspaces** — every tenant-admin sidebar item
  opens a working, tenant-scoped screen rather than a placeholder: institution
  profile/contact/appearance/page copy/gallery, student profiles/groups/portal
  accounts, teacher recruitment and teaching assignments, class rosters and
  timetables, staff and student attendance, lessons and assignments, grade
  bands, score entry, calculated/published report cards, sessions and terms,
  admission review/settings, announcements/messages/parent communication,
  fee items/payments/balances/reports, account security and saved notification
  preferences. Every counter and chart comes from current tenant data.
- **Live institution share pages** — `/s/<slug>` renders each institution’s
  real public profile, public announcements, subject/classes information,
  admission form and status checker, and published-result verification. Public
  page copy saved by the administrator is allow-listed before it is exposed;
  operational settings are never sent to visitors.

## Future SaaS roadmap (designed for, NOT built)

Subscriptions and public payment, provider-backed SMS/WhatsApp/email delivery,
certificates, ID cards, library, expenses and a native mobile app.
(Timetables, online admissions, assignments, public result checking, payroll
and staff leave are now built; public *payment* of fees is not.) The schema and routes are shaped so
these can be added without re-architecture — no payment gateway is connected.
