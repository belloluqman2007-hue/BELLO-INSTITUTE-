# EduSphere Rebrand — Verification Report

Date: 2026-09-24 · Branch: `arena/01a0d30d-bello-institute`

The platform formerly known as **BELLO INSTITUTE** is rebranded globally as
**EduSphere — Education Management Platform**. Every institution keeps its own
independently branded public website. Subjects are academic data, not
navigation. The official uploaded EduSphere logo is the only global platform
logo.

---

## 1. Official EduSphere logo

- Source of truth: the uploaded file
  `public/assets/file_00000000593081f8a498c74e1fe3ddf2.png` (1254×1254 PNG),
  registered byte-for-byte as **`public/assets/edusphere-logo.png`**.
- No logo was generated, redrawn, or substituted. The file is always rendered
  with `object-fit: contain` / natural aspect ratio (never stretched, never
  recoloured).
- Used at: main website header + hero, unified login card, password-recovery
  cards, admin console brand (super admin), portal sign-in cards, favicon,
  apple-touch-icon, PWA manifest icon, OG/Twitter images, and as the fallback
  mark where an institution has not uploaded its own logo.
- Old BELLO logo references (`/assets/bello-multi-madrasa-platform-logo.png`,
  which no longer existed on disk anyway) were all replaced. The unused
  `bello-learning-studio.jpg` asset was deleted.

## 2. User-facing BELLO branding changed

Replaced with EduSphere in: `public/index.html` (title/meta/OG/favicon),
`public/js/app.js` (global site header/footer/hero/category pages/Western
Academies page/school-site “Powered by EduSphere” credit/404 copy),
`public/js/dashboard.js` (sign-in, password recovery, sidebar brand, page
titles, admin copy), `public/js/portal.js` + portal role modules (titles,
copy), `public/js/register.js` + `register-academy.js` (titles, brand, terms,
support email), `public/js/my-institution.js` (directory copy, dead
“show subject catalogue publicly” toggle removed), `server/routes/public.js`
(default site title), `server/routes/platform.js` (platform settings default),
`server/routes/auth.js` (password-reset emails), `server/routes/timetable.js`
(printable timetable footer), `server/routes/payment.js` (reference prefix
`EDUSPHERE-…`, fallback email domain), `server/services/delivery.js` (email
Message-ID/boundary), `server/seed.js` (dev banner note, demo student name),
`server/index.js` (startup banner), all module header comments, and the README
title/summary.

## 3. Remaining technical BELLO references (intentionally unchanged)

- `window.Bello*` JS module names (`BelloDashboard`, `BelloPortal`,
  `BelloRegister`, …) — internal code identifiers referenced across the app
  and tests.
- `bello:unauthorized` custom event name (api.js/dashboard.js/portal.js + tests).
- `bello-password-reset-v1` scrypt salt in `server/routes/auth.js` — changing
  it would invalidate in-flight password-reset tokens.
- `bello-data` Render disk name in `render.yaml` (+ deployment test) — renaming
  would orphan the production persistent disk.
- `bello.*.draft` localStorage keys and `belloRegisterStep` history-state keys.
- `BELLO-TEST-*` payment references inside `test/parent-payments.test.js`
  (test fixtures), the `docs/` historical audit reports, `.audit-tools/` and
  `loadtest/` developer tooling (DB names such as `bello_loadtest`), and the
  repository/directory name itself.
None of these are user-facing branding.

## 4. Arabic removed from the global platform

Removed from: homepage hero/footer/choice cards, category marketing pages
(Islamic Schools, Western Academies), the Madrasa registration hero, and every
global navigation/tagline. A source scan confirms **zero Arabic strings** in
`app.js` (global sections), `register.js`, `register-academy.js`,
`dashboard.js`, `portal.js`, and `index.html`.

## 5. Arabic preserved for institution-specific websites

School-configured Arabic still renders on each school’s own public website and
workspace: Arabic school name (`name_ar`), Arabic motto/description, Arabic
class/term/fee/grade-band names, teacher Arabic names, and the Arabic data-entry
fields in the admin console. Verified live: Al-Quraniyya’s
`مدرسة القرونية النموذجية` renders on its own site only.

## 6–7. Subject navigation removed from admin sidebars (Islamic + Western)

- The standalone **Subjects** sidebar section (one item per subject:
  Qur'an, Tajweed, Hadith, Fiqh, … / Mathematics, English, Sciences, …) was
  removed for both categories.
- The standalone **Qur'an / Islamic Education** section (Qur'an Progress,
  Memorization, Revision, Tajweed, Islamic Academic Reports) was removed;
  Islamic institutions now get a single **Hifz Progress Tracker** entry inside
  **Academic**.
- No subject name from either catalogue appears anywhere in the sidebar
  navigation (verified by automated checks for 12 Islamic and 9 Western
  subject names, scoped to the nav element).

## 8. Subject data preserved internally

Nothing was deleted from the database. Teacher-subject and class-subject
relationships, results, exams, assignments, lesson plans, report cards and the
curriculum are untouched. Subjects are now managed through
**Academic → Curriculum & Subjects**, a single workspace that lists every
category (including custom ones) with live counts and opens the exact same
per-category management screens as before. All `subjects/*` and `quran/*`
routes continue to work.

## 9. Public website subject sections removed

- The automatic subject tag list under “Programs & courses” was removed from
  the school public website rendering.
- `/api/public/madaris/:slug` no longer returns the raw subject list.
- The hard-coded subject grid + subject search filter on the global Western
  Academies page were removed.
- The dead `privacy_show_subjects` toggle was removed from settings.
- School-curated content (programmes, teacher profiles, custom pages) is
  unaffected.

## 10. School-specific branding verified

Each institution renders its own logo, name, motto, colours, hero image,
gallery, news and contact details. The admin/portal shells are school-branded
(institution logo + name, with EduSphere as fallback only when no logo was
uploaded). “Powered by EduSphere” appears in the school footer as the platform
credit.

## 11. Tenant isolation verified

Live checks confirm tenant A’s name/Arabic name never appear on tenant B’s
website and vice versa. The existing `tenant-isolation.test.js` suite (part of
the 597 automated tests) continues to pass, covering cross-tenant data,
uploads, news, gallery and contact information.

## 12. Login verified for all five account types

Unified sign-in with no role chooser: Institution Admin → admin dashboard,
Teacher → teacher workspace, Student → student portal, Parent → parent portal,
Super Admin → platform console. All verified against the running server via
`test/rebrand-verification.js`.

## 13. PWA / app branding

- Added `public/manifest.webmanifest` (EduSphere name, icons from the official
  logo, theme colour) and linked it from `index.html`.
- No service worker exists, so nothing is cached across institutions;
  `/app-config.js` (which resolves the tenant for custom domains) is served
  with `Cache-Control: no-store`.
- The school website includes an honest **“Stay Connected With Our School —
  Open School App”** section pointing at the shared web app sign-in. No fake
  Google Play / App Store links exist anywhere.

## 14. Test results

- Full automated suite: **597/597 pass** (`npm test`, including jsdom
  browser-level tests of the public site, admin console and all three
  portals).
- Live rebrand verification (`node test/rebrand-verification.js` against a
  running dev server): **87 checks pass, 0 fail** (83 when the super-admin
  section is skipped for lacking `SUPER_ADMIN_PASSWORD`).

## 15. Remaining limitations

- The public directories at `/islamic-schools` and `/western-schools` are
  still “coming soon” placeholders (as before the rebrand); live institution
  websites work at `/schools/<slug>`.
- Support email `support@edusphere.app` on the registration pages is a
  placeholder address that should be replaced with the operator’s real
  mailbox.
- The technical identifiers listed in §3 remain (safe to keep); a follow-up
  mechanical rename of `window.Bello*` module names is possible but was
  deliberately avoided to protect working functionality.
- The PWA manifest is global (EduSphere); per-tenant manifest serving would
  require additional routing work if desired.
