"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — backup CLI
   ----------------------------------------------------------------------------
     npm run backup                 write a snapshot now
     npm run backup -- --list       show what is on disk
     npm run backup -- --keep 20    override how many to keep for this run
     npm run backup -- --restore <file> [--dry-run]
                                    replace the database with a snapshot
   Snapshots live in BACKUP_DIR (default DATA_DIR/backups) and are plain JSON,
   so they can also be downloaded from Platform → Backups in the browser and
   restored on another host. Restoring from the command line needs no server
   running — that is the point: it still works when the app is broken.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");
const backup = require("./services/backup");

function usage(code = 0) {
  console.log(`Backup tool — files are written to ${config.BACKUP_DIR}

  npm run backup                          write a snapshot now
  npm run backup -- --list                list snapshots (newest first)
  npm run backup -- --keep 20             keep N snapshots for this run
  npm run backup -- --restore <name>      restore (asks for confirmation)
  npm run backup -- --restore <name> --dry-run
  npm run backup -- --import <path.json>  restore a downloaded file

A restore REPLACES every row in every table. A pre-restore snapshot is written
first, so the restore itself can be undone.

Every command prints the database it is about to touch. Add --force to write a
snapshot to a database file that does not exist yet (normally refused, because
backing up an empty database is how an empty database becomes permanent).`);
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  // A snapshot of an empty database is worse than no snapshot: it becomes the
  // newest file and then gets restored by mistake. Listing and restoring stay
  // allowed with no database at all — restoring is how you get data back.
  const readsOnly = argv.indexOf("--list") >= 0 || argv.indexOf("--restore") >= 0 || argv.indexOf("--import") >= 0;
  require("./db-target").announce({ allowCreate: readsOnly });
  const flag = (name) => argv.indexOf(name);
  const value = (name, fallback) => {
    const i = flag(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
  };

  if (flag("--help") >= 0 || flag("-h") >= 0) return usage(0);

  if (flag("--list") >= 0) {
    const list = await backup.list();
    if (!list.length) return console.log(`No snapshots in ${config.BACKUP_DIR} yet.`);
    for (const b of list) {
      const counts = b.counts ? Object.entries(b.counts).map(([k, v]) => `${k}:${v}`).join(" ") : "";
      console.log(`${b.name}  ${new Date(b.createdAt).toISOString()}  ${(b.bytes / 1024).toFixed(1)} KB  ${counts.slice(0, 120)}`);
    }
    return;
  }

  const restoreName = value("--restore", null);
  const importPath = value("--import", null);
  const dryRun = flag("--dry-run") >= 0;

  if (restoreName || importPath) {
    const source = importPath
      ? backup.parseJson(fs.readFileSync(path.resolve(importPath), "utf8"))
      : await backup.readSnapshot(restoreName);
    const plan = await backup.restore(db, source, { dryRun: true });
    console.log(`Tables that will be replaced: ${plan.wouldReplace.join(", ")}`);
    console.log(`Rows: ${JSON.stringify(plan.counts)}`);
    if (plan.wouldClear.length) console.log(`Tables in the live database that are NOT in this backup and will be emptied: ${plan.wouldClear.join(", ")}`);
    if (dryRun) { console.log("Dry run — nothing was changed."); return; }
    if (flag("--yes") < 0 && process.stdin.isTTY) {
      const readline = require("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\nType RESTORE to replace everything in ${config.DB_CONFIG.file || config.DATABASE_URL}: `);
      rl.close();
      if (answer.trim() !== "RESTORE") return console.log("Aborted. Nothing was changed.");
    }
    const result = await backup.restore(db, source);
    console.log(`Restored ${result.restored.length} table(s). Safety copy: ${result.safetySnapshot}`);
    return;
  }

  const keep = Number(value("--keep", config.BACKUP_KEEP));
  const info = await backup.writeSnapshot(db, { reason: "cli", keep });
  console.log(`Snapshot written: ${info.path}`);
  console.log(`  ${(info.bytes / 1024).toFixed(1)} KB — ${Object.entries(info.counts).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  const prunable = fs.readdirSync(config.BACKUP_DIR).filter((n) => /^snapshot-.*\.json$/.test(n) && !/pre-(restore|migration)/.test(n));
  if (prunable.length > keep) console.log(`  (older snapshots pruned, keeping ${keep})`);
}

if (require.main === module) {
  main()
    .then(() => db.close())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Backup failed:", e.message);
      process.exit(1);
    });
}
