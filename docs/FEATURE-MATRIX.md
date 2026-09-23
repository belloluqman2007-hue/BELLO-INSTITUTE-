# BELLO — Feature Matrix (UX Completion Pass, 2026-09-23)

Legend: ✅ present before this pass · 🆕 added in this pass · ♻️ extended in this pass

## Foundation (verified by the existing suite — NOT rebuilt)

| # | User | Feature | Backend | API | Frontend | Permissions | Tests | Status |
|---|------|---------|---------|-----|----------|-------------|-------|--------|
| 1 | All | Auth (login/logout/me/password/CSRF/sessions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | All | 5 core roles + granular permissions + overrides | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | All | Tenant isolation on every row | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | All | Audit log | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | Ops | SQLite + MySQL + 35→36 migrations + pooling + load tests | ✅ | — | — | — | ✅ | ✅ |
| 6 | All | Security (CSRF, rate limits, upload hardening, XSS, path traversal) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | Admin | Students lifecycle, classes, subjects, groups, health, ID cards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Admin | Teachers lifecycle, applications, profiles | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | Admin | Results lifecycle (draft→…→locked) + report cards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10 | Admin | Fees/payments (lifecycle incl. online gateway) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Admin | Payroll / Leave / Library / Expenses / Documents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 12 | Admin | Communication (announcements, messages, notifications, delivery log) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 13 | Admin | Public website management + global search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 14 | Super Admin | Platform console (stats, madaris, registrations, plans, analytics, activity, backups, settings) | ✅ | ✅ | ✅ | role | ✅ | ✅ |
| 15 | Parent | PTM booking flow (double-booking prevented server-side) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 16 | Public | Marketing site, school pages, registration, result checking | ✅ | ✅ | ✅ | — | ✅ | ✅ |

## Added or completed in this pass

| # | User | Feature | Backend | API | Frontend | Permissions | Tests | Status |
|---|------|---------|---------|-----|----------|-------------|-------|--------|
| 17 | Teacher | **Workspace at `/teacher`** — dashboard (today's classes, pending attendance, grading queue, result counters), classes + rosters, timetable, attendance register (bulk mark, duplicate-safe save), lesson plans (draft/published/completed), assignments (publish, deadline, submission tracking, grading), exams + marks, results gradebook + submit-for-review, leave self-service, library self-service, messages, notifications, calendar | ♻️ reuse | 🆕 `/api/teachers/dashboard` | 🆕 `public/js/portal-teacher.js` | ✅ server-enforced scopes | 🆕 portal-ui + portal-experience | ✅ |
| 18 | Student | **Portal at `/student`** — dashboard, timetable, lessons, assignments (view/submit/resubmit until graded, feedback), exam timetable, results + report cards, attendance, fees + receipts, library, Qur'an progress (Islamic only), messages, notifications, account | ♻️ reuse | 🆕 `/api/portal/dashboard`, `/portal/assignments(+/ :id/attachments)`, `/portal/exams`, `/portal/contacts`, `/library/my-loans`, `/quran-progress/me` | 🆕 `public/js/portal-student.js` | ✅ own-record only | 🆕 portal-ui + portal-experience | ✅ |
| 19 | Parent | **Family portal at `/parent`** — dashboard with all children, child switcher (server-validated per request), attendance/results/report cards/assignments/timetable/exams/fees per child, PTM link, Qur'an progress, messages, notifications | ♻️ reuse | 🆕 (same as student, `?studentId=` validated via parent_links) | 🆕 `public/js/portal-parent.js` | ✅ linked children only | 🆕 portal-ui + portal-experience | ✅ |
| 20 | All | Login routing: `/login` hands each account to its own workspace | — | — | ♻️ `dashboard.js` | ✅ | ♻️ admin-login | ✅ |
| 21 | All | Portal shell + notification centre (shared, reuses dash-* design system) | — | ✅ existing | 🆕 `public/js/portal.js`, `public/css/portal.css` | ✅ | 🆕 portal-ui | ✅ |
| 22 | Admin | Academic calendar & school events (audience targeting, per-tenant) | 🆕 `calendar_events` (migration 035) | 🆕 `/api/calendar` CRUD | 🆕 Academic → Calendar & Events + portal widgets | 🆕 `calendar.view/manage` | 🆕 calendar-events | ✅ |
| 23 | Admin | Platform support tickets (institution side) | 🆕 `support_tickets` + notes (migration 035) | 🆕 `/api/support/*` | 🆕 Platform Support section | 🆕 `support.view/create` | 🆕 support-tickets | ✅ |
| 24 | Super Admin | Support ticket queue (status/priority/assignment, public + internal notes) | ♻️ same tables | 🆕 `/api/platform/tickets*` | 🆕 Platform → Support Tickets | super-admin only | 🆕 support-tickets | ✅ |
| 25 | Admin | Question bank | 🆕 `question_bank` (migration 035) | 🆕 `/api/academic/questions*` | 🆕 Academic → Question Bank | 🆕 `questionbank.view/manage` | 🆕 question-bank | ✅ |
| 26 | Admin | Staff role templates (Accountant, Librarian, Admissions Officer, Academic Officer, HR Officer, Receptionist) — permission bundles on STAFF accounts, no new roles | ♻️ user_permissions | 🆕 `/api/admin/permissions/templates` + apply | ♻️ Roles & Permissions "Apply template" | ✅ roles.manage + audited | 🆕 role-templates | ✅ |
| 27 | Family | Messaging restriction: student/parent accounts can only write to staff | ♻️ messages | ♻️ `POST /communication/messages` guard | — | ✅ | 🆕 portal-experience | ✅ |
| 28 | Family | Fee + timetable + attendance + announcement views (existing endpoints verified through the portals) | ✅ | ✅ | 🆕 portal pages | ✅ | 🆕 portal-experience | ✅ |

## Preservation notes

- The 5 core account roles are unchanged; "staff roles" are **permission bundles** on
  teacher-role accounts (the existing Roles & Permissions system is the source of truth).
- Fee, result, payment, message-delivery and PTM lifecycles are untouched — the portals
  read/write through the existing endpoints.
- Islamic/Western modes: portals theme by the institution category and only offer the
  Qur'an module when the backend reports an Islamic institution (which also 404s the
  endpoint for Western tenants, server-side).
- No duplicate modules: the portals share one shell (`portal.js`) and the admin's design
  system (`dashboard.css`); the PTM booking flow remains the single implementation.
