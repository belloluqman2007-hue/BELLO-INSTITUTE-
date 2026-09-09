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

Requirements: **Node.js ≥ 22** (uses the built-in `node:sqlite` for the dev
database — no external DB server needed).

```bash
npm install
npm run dev        # migrate + serve on http://localhost:3000
```

First run creates the dev SQLite database (`data/madrasa_platform_dev.sqlite`)
and one super-admin account.

```bash
npm run seed -- --demo   # optional: add 2 demo madaris with users, classes, results
npm test                 # automated suite (isolated temp database, 47 tests)
bash test/smoke.sh       # end-to-end checks against a running dev server (29 checks)
```

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

---

## Roles & permissions (enforced on the backend)

| Role | Access |
| ---- | ------ |
| **SUPER ADMIN** | All madaris: create/suspend, plans (FREE / BASIC / PREMIUM with student & teacher limits and feature flags), platform stats, activity log, platform settings. |
| **MADRASA ADMIN** | Everything *within their own madrasa*: students, teachers, classes, subjects (Arabic + English names — not hard-coded), sessions, terms, results, attendance, fees, announcements, school profile/logo/settings, grading config (CA max, exam max, pass mark, grade bands, promotion rules). |
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
                   announcements, portal
  services/        grading engine (configurable per madrasa), admissions
public/            static mobile-first SPA (hash routing, EN/AR, RTL)
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

## Future SaaS roadmap (designed for, NOT built)

Subscriptions & payment, SMS/WhatsApp/email notifications, timetables,
certificates, ID cards, online admissions, online exams, assignments,
library, expenses, payroll, analytics, native mobile app. The schema and
routes are shaped so these can be added without re-architecture — none are
implemented now, and no payment gateway is connected.
