# Database

This platform uses a **brand-new database**. It does not open, reference, or
migrate the old production database (the old database identity is
inventoried and delisted in `ISOLATION-AUDIT.md`). The old database is never
contacted by this codebase.

## Two drivers, one code path

`server/db.js` exposes a single query API over two interchangeable drivers:

| Driver | When | Connection source |
| ------ | ---- | ----------------- |
| `sqlite` (Node built-in `node:sqlite`) | development | file path `DATABASE_FILE` (default `./data/madrasa_platform_dev.sqlite`) |
| `mysql` (`mysql2`) | production | `DATABASE_URL` or `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` |

The driver is selected by `DATABASE_DRIVER`. The app **only ever opens the
database configured here**. There is no code path that reaches the old
database.

## Choosing a NEW production database

1. **Create a new, empty MySQL/MariaDB database** with a name that is
   *not* the old one (e.g. `madrasa_platform_prod`), and a **new** dedicated
   user with a strong password.
2. Point the app at it:

   ```
   DATABASE_DRIVER=mysql
   DATABASE_URL=mysql://NEW_USER:NEW_PASSWORD@NEW_HOST:3306/NEW_DB_NAME
   ```

   Do **not** reuse any host, user, password, or database name from the old
   system.

## Migrations

Migrations live in `server/migrate.js` and are **idempotent** — they run on
every boot (`server/index.js` calls them before serving) and only create what
is missing. They are written to be safe on both SQLite and MySQL (dialect is
branched where the two differ, e.g. `ON CONFLICT` vs `ON DUPLICATE KEY`).

Current schema (tenant = `madrasa_id` on every madrasa-owned row):

- `plans`, `madaris`, `madrasa_subscriptions`
- `users`, `parent_links`
- `academic_sessions`, `terms`
- `classes`, `subjects`, `class_subjects`, `teacher_assignments`
- `students`, `results`
- `attendance`, `fee_items`, `fee_payments`
- `announcements`, `grading_config`, `settings`, `platform_settings`
- `activity_log`

Every madrasa-owned record carries `madrasa_id`; all tenant-scoped queries
filter on it, and the tenant middleware (see `SECURITY.md`) guarantees the
`madrasa_id` used is the caller's own.

## Development database

Zero-config: `npm run dev` creates the SQLite file automatically. To reset a
clean dev database, delete the file and re-run (the server re-migrates and
re-seeds the super-admin on boot):

```bash
rm -f data/madrasa_platform_dev.sqlite*
npm run dev
```

Seed the demo madaris (2 madaris, users, classes, results):

```bash
npm run seed -- --demo
```

## Safety rules

- **Never** copy the old `.env` or old connection string into this project.
- **Never** run a migration or DDL against the old database.
- The dev SQLite file and any real `.env` are git-ignored and never committed.
