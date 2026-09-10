# Storage & persistence

> **"I added a madrasa and some time later it was just gone."**
> That report is almost never the application forgetting — it is the **host**
> forgetting. This document explains why it happens, how this platform now
> detects it, what it does to survive it, and how to configure each host.

---

## 1. Why records disappear

PaaS containers (Render without a disk, Railway without a volume, Fly without a
volume, a plain `docker run`, most VPS setups where the app lives in `/tmp`) get
a **fresh filesystem on every deploy and on many restarts**. Anything written
outside a mounted volume is deleted with the container:

| What lives where | Survives a redeploy? |
| --- | --- |
| SQLite file in `./data` (container disk) | ❌ deleted |
| Uploads in `./uploads` (container disk) | ❌ deleted |
| JSON backups in `./data/backups` | ❌ deleted (so you cannot even restore) |
| SQLite file in `/var/data` (mounted disk) | ✅ |
| MySQL/MariaDB/Postgres from `DATABASE_URL` | ✅ (it is not on the container at all) |

Nothing in the application can prevent this — the `rm -rf` is the platform's,
not ours. What the application *can* do is (a) refuse to be silent about it,
(b) make the loss recoverable, and (c) give you a one-line fix.

Two code paths make the loss worse than it needs to be, and both are fixed:

* **Half-created tenants.** Creating a madrasa and its administrator used to be
  two separate writes. If the second failed, the madrasa row existed with no
  owner and looked "broken/vanished" in the UI. It is now one transaction
  (`server/routes/platform.js`) — either both rows exist or neither does.
* **No undo.** There was no way to get a deleted madrasa back. There is now a
  snapshot engine (below).

## 2. What the app does about it

### 2.1 One directory for everything the app writes

`DATA_DIR` (default `./data`) contains the dev database, the uploads and the
backups unless each is overridden:

```
DATA_DIR=./data
├── madrasa_platform[_dev].sqlite   # DATABASE_FILE when not set explicitly
├── uploads/                        # UPLOAD_DIR (logos, student photos, imports)
├── backups/                        # BACKUP_DIR (JSON snapshots)
└── .platform-state.json            # storage marker (see 2.3)
```

On a host with a volume, you set **one** variable and everything follows:

```
DATA_DIR=/var/data
```

`PERSISTENT_VOLUME_DIR` (default `/var/data`) is the directory the app looks at
when deciding "am I on the mounted volume or on the throwaway disk?".

### 2.2 It tells you, loudly, at boot

`server/config.js#validate()` prints warnings (never exits — killing a live site
is worse than a log line) and the log is echoed in
`GET /api/platform/backups/diagnostics`, which drives a banner on every
super-admin screen:

```
WARNING: SQLite database "/opt/render/project/src/data/madrasa_platform.sqlite"
is NOT under the persistent volume (/var/data). … every madrasa, user and result
you create is DELETED on the next deploy or restart.
```

Verdict codes (safe to alert on):

| Code | Level | Meaning |
| --- | --- | --- |
| `EPHEMERAL_DATA_DIR` | critical | the database file is on a container filesystem |
| `EPHEMERAL_UPLOADS` | warn | logos/photos will disappear |
| `EPHEMERAL_BACKUPS` | warn | the snapshots themselves will disappear |
| `NO_STATE_MARKER` | warn | no marker in the data dir → fresh container |
| `DATA_LOSS_DETECTED` | critical | marker says rows existed; the database is empty now |
| `HOST_CHANGED` | warn | booted on a different container — only volumes survive that |
| `UNKNOWN_MOUNT` | warn | `/proc/mounts` unreadable (non-Linux) → verify by hand |
| `ACKNOWLEDGED` | info | you set `DATA_PERSISTENT_ACK=1`, so the checks are quiet |

The judgement is filesystem-aware, not "always shout": a real block device
(`/dev/sda1`, `/dev/nvme0n1`, LVM…) is durable even when mounted at `/`, while
`overlay`, `tmpfs` and `9p` are never. On a plain VPS you may set
`DATA_PERSISTENT_ACK=1` to silence the warnings — backups keep running either
way.

### 2.3 Proof that a volume survived

`.platform-state.json` in `DATA_DIR` records `firstSeenAt`, `bootCount`,
`lastBootAt`, `lastBootHost`, and the row counts at the last clean shutdown. If a
boot finds **no marker** (or an empty database behind a marker that knew about
madrasa rows), it reports `NO_STATE_MARKER` / `DATA_LOSS_DETECTED` — which is
how "gone" becomes an explainable event instead of a mystery.

### 2.4 Snapshots that can actually be restored

`server/services/backup.js` writes the whole database as JSON
(`madrasa-platform-backup/1`):

* every table, in dependency order (`TABLE_ORDER`), children cleared before
  parents so foreign keys hold without disabling them;
* `app_sessions` deliberately **excluded** — a restore must not resurrect other
  people's live cookies; `password_hash` is included, because a backup that
  cannot restore logins is not a backup;
* `snapshot-<utc>-<reason>.json` — the timestamp carries **milliseconds**, so
  two snapshots in the same second never overwrite each other;
* reasons: `manual`, `scheduled`, `cli`, `shutdown`, `pre-restore`,
  `pre-migration`; the last two are **never pruned**.

When they are taken:

| Trigger | Where |
| --- | --- |
| every `BACKUP_INTERVAL_MINUTES` (default 360) | `startAutoBackup()` in `server/index.js` |
| graceful shutdown (SIGINT/SIGTERM) | `server/index.js` |
| before any pending migration | `server/migrate.js` |
| before a restore | `server/services/backup.js` |
| Platform → Backups → "Create snapshot now" | `POST /api/platform/backups` |

Retention is `BACKUP_KEEP` (default 10), oldest-first.

## 3. Operator runbook

**Check storage from the shell** (needs a super-admin session, or run the CLI):

```bash
curl -s -H "Cookie: mm_session=…" https://HOST/api/platform/backups/diagnostics | jq .persistence
```

**Check from the UI:** sign in as super admin → `Platform → Backups & storage`.
The page shows the verdict, the warning text with its fix, row counts, the
directory in use, the last snapshot, and the buttons below.

**Download / restore:** the same page has *Download*, *Restore* (asks for
`confirm` and shows a plan first) and *Upload a snapshot* for moving data to
another host. Every restore writes a `pre-restore` snapshot first, so a restore
can itself be undone.

**Command line (works even when the app is down):**

```bash
npm run backup                          # write a snapshot now
npm run backup -- --list                # what is on disk
npm run backup -- --restore snapshot-….json --dry-run
npm run backup -- --restore snapshot-….json
npm run backup -- --import /tmp/from-old-host.json
```

**After a total loss:** attach the disk (below), redeploy, then restore the newest
snapshot from the old container if you can still reach it — otherwise re-create
the madrasa; every created user's password hash is in the snapshot, so a restore
puts accounts back exactly as they were.

## 4. Host-by-host setup

### Render (`render.yaml` is already configured)

```yaml
services:
  - type: web
    disk:
      name: bello-data
      mountPath: /var/data
      sizeGB: 1
    envVars:
      - { key: DATA_DIR,             value: /var/data }
      - { key: UPLOAD_DIR,           value: /var/data/uploads }
      - { key: BACKUP_DIR,           value: /var/data/backups }
      - { key: PERSISTENT_VOLUME_DIR, value: /var/data }
```

Facts worth knowing before you click *Create*:

* a disk can only be attached **while creating the service** (or via
  `POST /v1/disks` with the service id afterwards);
* `mountPath` may not be `/`, `/opt`, `/opt/render/project/src`, `/home`, `/etc`;
* with a disk, Render runs **one instance** and skips zero-downtime deploys —
  fine for this app (single process, in-memory rate limiting);
* disks can grow but never shrink; a `starter` plan disk costs a few dollars a
  month; the disk is invisible during the *build* (mount it only for runtime).

If you use Render MySQL instead (`DATABASE_URL`), the database is already safe;
keep the disk anyway for uploads and backups.

### Docker

```bash
docker run -d --name madrasa \
  -v madrasa-data:/var/data \
  -e DATA_DIR=/var/data -e PERSISTENT_VOLUME_DIR=/var/data \
  -e SESSION_SECRET=… -e SUPER_ADMIN_PASSWORD=… \
  -p 3000:3000 madrasa-platform
```
`docker volume ls` must show `madrasa-data`; a `-v` typo silently gives you a
container-local directory, i.e. the original bug.

### Fly.io

```bash
fly volume create madrasa_data -r mad
fly machine update --mount /var/data:madrasa_data
fly secrets set DATA_DIR=/var/data PERSISTENT_VOLUME_DIR=/var/data
```

### VPS (nginx + systemd)

Set `DATA_PERSISTENT_ACK=1` (the disk is yours and it survives) and make sure
`DataDir`/working directory is not in `/tmp`; add a cron entry
`npm run backup` if you do not want the in-process timer.

### SQLite vs MySQL

SQLite (dev/demo) needs the volume. MySQL/MariaDB/Postgres (`DATABASE_URL`) is
durable by construction, and is the right answer for anything with real users —
see [`DATABASE.md`](DATABASE.md). Backups and uploads still want the volume.

## 5. What this does *not* protect

* a container killed with `SIGKILL` between two snapshots — the worst case loses
  up to `BACKUP_INTERVAL_MINUTES` of edits;
* the disk itself: on Render, **deleting the service deletes its disk**. Take
  the occasional snapshot off-platform (Download button) if that matters;
* `BACKUP_DIR` on the same ephemeral filesystem as the database — both vanish
  together, which is why the boot warning distinguishes `EPHEMERAL_BACKUPS`.
