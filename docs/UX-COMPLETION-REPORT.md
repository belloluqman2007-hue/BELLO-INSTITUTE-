# BELLO — Complete User Experience + Feature Expansion: Final Report

Date: 2026-09-23 · Branch: `arena/01a0cd07-bello-institute`

## 1. Features present BEFORE this pass (audited, not rebuilt)

Authentication with DB-backed sessions, CSRF double-submit and rate limiting;
the 5 core roles (SUPER ADMIN, INSTITUTION ADMIN, TEACHER, STUDENT, PARENT)
with granular per-user permission overrides; tenant isolation on every row;
audit logging; SQLite + MySQL with 34 migrations, pooling and load tests
(1k/2k/5k users); the complete student lifecycle; the results workflow
(DRAFT→SUBMITTED→UNDER REVIEW→RETURNED/APPROVED→PUBLISHED→LOCKED); fees and
the payment lifecycle (EXPECTED→INITIATED→SUCCESSFUL→VERIFIED→RECONCILED)
including online gateway initiation; payroll, staff leave, library, expenses
and budget; the communication workspace (announcements with audience
targeting, direct messages, notification centre with per-type preferences,
delivery log with retry and real provider status); documents and certificates;
public institution websites, registration and public result checking; the
institution admin dashboard with permission-filtered navigation and global
search; the super-admin platform console.

## 2. Features ADDED in this pass

1. **Teacher workspace at `/teacher`** (was: teachers could not sign in
   anywhere — the login form told them "no administrator dashboard" and ended
   their session). Dashboard with today's classes, next class, pending
   attendance and grading queues and result-workflow counters; my classes
   with rosters; weekly timetable; the attendance register (bulk mark, edit,
   history) — all scoped to the teacher's own assignments; lesson plans;
   assignments with submission tracking and grading; examinations with marks
   entry; the results gradebook with submit-for-review; my leave; my library
   loans; messages; notifications; shared calendar.
2. **Student portal at `/student`**. Role dashboard (today's timetable,
   attendance percentage, pending assignments, upcoming exams, fee balance,
   announcements, events); weekly timetable; lessons; **assignments with
   submission and resubmission while ungraded, scores and teacher feedback**;
   exam timetable; results with printable report cards; attendance history;
   fee statement with receipt downloads; library loans; **Qur'an progress
   (Islamic institutions only)**; messages with teachers/admins;
   notification centre; profile and password self-service.
3. **Parent (family) portal at `/parent`**. Family dashboard covering every
   linked child; a child switcher on every child-scoped page — attendance,
   results, report cards, assignments, timetable, exams, fees, Qur'an
   progress; messages with the children's teachers and the school office;
   notifications; the existing PTM booking flow remains at `/parent/meetings`
   and is linked from the portal.
4. **Login routing** — `/login` now hands each valid account to its own
   workspace (admin → `/admin`, teacher → `/teacher`, student → `/student`,
   parent → `/parent`).
5. **Academic calendar & school events** — tenant-owned events (holidays,
   exam weeks, PTM dates, admission deadlines, activities) with audience
   targeting (everyone / staff / students & parents / parents only /
   specific classes), manageable under Academic → Calendar & Events and
   visible on every portal dashboard.
6. **Platform support tickets** — institutions raise and follow tickets
   (Platform Support section); the super admin works a platform-wide queue
   with status/priority/assignment, public replies and internal notes the
   institution can never see; every action audited.
7. **Question bank** — reusable questions per subject, class level, type,
   difficulty and marks, complementing the existing examinations module.
8. **Staff role templates** — Accountant, Librarian, Admissions Officer,
   Academic Officer, HR Officer and Receptionist, applied to STAFF (teacher)
   accounts as permission bundles through the existing Roles & Permissions
   system. No new roles; the 5 core roles remain the only account types.
9. **Portal self-service endpoints** — `/api/portal/dashboard`,
   `/api/portal/assignments` (+ detail, attachments, own-submission
   download), `/api/portal/exams`, `/api/portal/contacts`,
   `/api/library/my-loans`, `/api/quran-progress/me` (family read-only view),
   `/api/teachers/dashboard`.
10. **Messaging boundary** — student and parent accounts can now only send
    messages to staff (administrators and teachers); anything else is refused
    by the server, not hidden in the UI.

## 3. Features IMPROVED in this pass

- `accessibleStudents()` in the portal now joins the class name, fixing the
  previously always-empty `classEn` field in `/api/portal/results`.
- The parent PTM page links back to the parent portal.
- The public site footer exposes the three portals for discoverability.
- Roles & Permissions gained one-click template application on top of the
  existing per-permission editor.

## 4. Database migrations

One migration, **`035_calendar_support_questionbank`** (dialect-aware, runs on
SQLite and MySQL, additive only — no existing table or column is touched):

- `calendar_events` — tenant-owned, audience + status, indexes on
  `(madrasa_id, start_date, status)` and `(madrasa_id, audience, status)`.
- `support_tickets` — tenant-owned with priority/status/assignment;
  indexes for the tenant view and the platform queue.
- `support_ticket_notes` — public and internal notes, indexed by ticket.
- `question_bank` — subject/class-scoped questions; index on
  `(madrasa_id, subject_id, class_id, status)`.

New permissions: `calendar.view`, `calendar.manage`, `questionbank.view`,
`questionbank.manage`, `support.view`, `support.create` (administrators hold
all; teachers get `calendar.view` and `questionbank.view` by default).

## 5. New tests (all included in `npm test`)

`test/calendar-events.test.js` (CRUD, audience targeting for
student/parent/teacher, permission revocation, tenant isolation, validation) ·
`test/support-tickets.test.js` (institution workflow, tenant isolation,
super-admin queue, assignment validation, internal-note boundary, audit
trail) · `test/question-bank.test.js` (CRUD, filters, permission gates,
teacher ownership, cross-tenant 404s, validation) ·
`test/portal-experience.test.js` (student/parent/teacher dashboards and
scoping, assignment submit/resubmit/grade visibility, cross-child and
cross-tenant 404s, contacts, library self-service, Qur'an family view +
Western-institution gate, family messaging restriction, unassigned-teacher
dashboard) · `test/role-templates.test.js` (six templates, effective
permissions after application, real API effects, audit, guards) ·
`test/portal-ui.test.js` (browser-level: portals served, sign-in, shell
mount, dashboard render for all three roles, parent child switcher,
wrong-role refusal). `test/admin-login.test.js` was updated for the new
login-routing behaviour (teacher/student are handed to their portals and the
session stays open for the portal) — no assertion was weakened.

## 6. Existing test results after this pass

```
npm test          535 tests, 535 pass, 0 fail  (~287 s, SQLite)
bash test/smoke.sh 70 checks, 70 pass, 0 fail   (against the seeded dev server)
```

(The suite was 496 before this pass; 39 tests were added and every
pre-existing test still passes.)

## 7. Known limitations / not built (deliberate)

- **Live chat** remains the existing scoped chat board + direct messages;
  no websocket real-time transport was added.
- **Online exam-taking** by students is not implemented — the question bank
  is a staff-side authoring tool for the existing exams/marks workflow.
- **Mobile apps** are out of scope; the portals are responsive web and reuse
  the admin design system.
- Fee **online payment** in the parent portal is limited to viewing the
  statement/history/receipts; the gateway initiation flow is unchanged
  (a provider must be configured — see §8).
- The super-admin ticket assignment field takes a platform user id; a
  user-picker dropdown can be added when the platform team grows.

## 8. External-provider dependencies (unchanged, never faked)

- **Payment gateway** (Paystack or Flutterwave, `PAYMENT_GATEWAY=none`
  disables): online fee initiation returns a clear 503 until configured.
- **Email/SMS/WhatsApp delivery** (`services/delivery.js`): notifications are
  recorded in-app always; external dispatch only happens with configured
  providers, and failures are reported honestly in the delivery log (retry
  included). No message is ever reported delivered when it was not.
- No other third-party services; charts are hand-built SVG because the CSP
  forbids external scripts.

## 9. Security & performance posture of the new code

Every new endpoint re-validates the session, tenant and relationship
server-side (child links for parents, class membership for students,
assignment scope for teachers, `roles.manage`/`support.*`/`calendar.manage`/
`questionbank.manage` permission gates for staff writes); existence is never
leaked across tenants (404); writes are audited; ticket internal notes are
filtered at the query level; all lists are LIMIT-bounded and indexed; the
portals make no query the admin console does not already make. No client-
supplied id is trusted without re-validation. The admin console's
`data-needs` permission-gate contract still passes its static test.

## 10. Overall status

**Complete.** All five roles now have a full, tested, mobile-responsive
workspace on one design system; the remaining product gaps identified in the
audit (teacher/student/parent workspaces, academic calendar, support tickets,
question bank, staff role templates, portal self-service, family messaging
boundary) are closed on top of — not in place of — the existing platform.
535/535 automated tests and 70/70 smoke checks pass.
