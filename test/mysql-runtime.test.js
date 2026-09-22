"use strict";
/* ============================================================================
   MYSQL 8 RUNTIME TEST — real server, real SQL, real transactions
   ----------------------------------------------------------------------------
   These tests only run when the suite is pointed at a real MySQL 8 server
   (TEST_DB_DRIVER=mysql). On SQLite they are skipped, so `npm test` keeps its
   existing meaning for development while this file proves the MySQL-specific
   behaviour that a SQLite run can never prove:

     • the schema MySQL actually built (types, keys, indexes, engine)
     • transaction COMMIT / ROLLBACK semantics on InnoDB
     • concurrent writers (lost updates, deadlocks, unique-key races)
     • the mysql2 pool (bounded connections, release, no leaks)
     • tenant isolation enforced against a real server

   Nothing here weakens or replaces an existing test.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, USE_MYSQL } = require("./helpers");

if (!USE_MYSQL) {
  test("MySQL runtime suite (skipped: TEST_DB_DRIVER != mysql)", () => {
    assert.ok(true);
  });
} else {
  initEnv();
  const db = require("../server/db");

  test("MySQL 8 runtime verification", async (t) => {
    const ctx = await setup();
    const schema = process.env.DB_NAME;

    t.after(async () => { await ctx.close(); });

    await t.test("server really is MySQL 8.x and InnoDB", async () => {
      assert.equal(await db.dialect(), "mysql");
      const v = await db.get("SELECT VERSION() AS v");
      assert.match(String(v.v), /^8\./, `expected MySQL 8.x, got ${v.v}`);
      const eng = await db.get(
        "SELECT SUPPORT FROM information_schema.ENGINES WHERE ENGINE='InnoDB'"
      );
      assert.ok(["YES", "DEFAULT"].includes(String(eng.SUPPORT)));
    });

    await t.test("every table is InnoDB + utf8mb4", async () => {
      const rows = await db.all(
        `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'`,
        [schema]
      );
      assert.ok(rows.length > 30, `expected a full schema, got ${rows.length} tables`);
      for (const r of rows) {
        assert.equal(r.ENGINE, "InnoDB", `${r.TABLE_NAME} is ${r.ENGINE}`);
        assert.match(String(r.TABLE_COLLATION), /^utf8mb4/, `${r.TABLE_NAME} collation ${r.TABLE_COLLATION}`);
      }
    });

    await t.test("core production tables exist with a primary key", async () => {
      const expected = [
        "madaris", "users", "students", "classes", "subjects", "attendance",
        "results", "fee_items", "fee_assignments", "fee_payments",
        "academic_sessions", "terms", "announcements", "notifications",
        "activity_log", "app_sessions", "schema_migrations",
      ];
      const present = new Set(
        (await db.all(
          "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
          [schema]
        )).map((r) => r.t)
      );
      for (const tbl of expected) assert.ok(present.has(tbl), `missing table ${tbl}`);

      const noPk = await db.all(
        `SELECT t.TABLE_NAME AS t FROM information_schema.TABLES t
          WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE='BASE TABLE'
            AND NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS c
                             WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME
                               AND c.CONSTRAINT_TYPE='PRIMARY KEY')`,
        [schema]
      );
      assert.deepEqual(noPk.map((r) => r.t), [], "tables without a primary key");
    });

    await t.test("tenant tables are indexed on madrasa_id", async () => {
      const tenantTables = (await db.all(
        `SELECT DISTINCT TABLE_NAME AS t FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'madrasa_id'`,
        [schema]
      )).map((r) => r.t);
      assert.ok(tenantTables.length > 10);
      // madrasa_registrations.madrasa_id is a PUBLIC varchar registration code
      // for a not-yet-created tenant, not a foreign key into madaris — it is
      // looked up by registration_id/status, which are indexed.
      const NOT_A_TENANT_FK = new Set(["madrasa_registrations"]);
      const unindexed = [];
      for (const tbl of tenantTables) {
        if (NOT_A_TENANT_FK.has(tbl)) continue;
        const idx = await db.get(
          `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='madrasa_id' AND SEQ_IN_INDEX=1`,
          [schema, tbl]
        );
        if (!Number(idx.n)) unindexed.push(tbl);
      }
      assert.deepEqual(unindexed, [], "tenant tables without a leading madrasa_id index");
    });

    await t.test("no duplicate indexes on the same column list", async () => {
      const rows = await db.all(
        `SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ?
          GROUP BY TABLE_NAME, INDEX_NAME`,
        [schema]
      );
      const seen = new Map();
      const dupes = [];
      for (const r of rows) {
        const key = `${r.TABLE_NAME}::${r.cols}`;
        if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} & ${r.INDEX_NAME})`);
        else seen.set(key, r.INDEX_NAME);
      }
      assert.deepEqual(dupes, [], "duplicate indexes");
    });

    await t.test("a committed transaction persists all of its writes", async () => {
      const before = Number((await db.get("SELECT COUNT(*) AS n FROM subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      await db.transaction(async (tx) => {
        await tx.run("INSERT INTO subjects (madrasa_id,name_en,name_ar) VALUES (?,?,?)", [ctx.madrasaA, "TxOne", "واحد"]);
        await tx.run("INSERT INTO subjects (madrasa_id,name_en,name_ar) VALUES (?,?,?)", [ctx.madrasaA, "TxTwo", "اثنان"]);
      });
      const after = Number((await db.get("SELECT COUNT(*) AS n FROM subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      assert.equal(after, before + 2);
    });

    await t.test("a failed transaction ROLLBACKs every write (no partial data)", async () => {
      const before = Number((await db.get("SELECT COUNT(*) AS n FROM subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO subjects (madrasa_id,name_en,name_ar) VALUES (?,?,?)", [ctx.madrasaA, "RollbackMe", "تراجع"]);
          throw new Error("forced failure after a successful write");
        }),
        /forced failure/
      );
      const after = Number((await db.get("SELECT COUNT(*) AS n FROM subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      assert.equal(after, before, "rollback left partial data behind");
      const leaked = await db.get("SELECT id FROM subjects WHERE name_en='RollbackMe'");
      assert.equal(leaked, null);
    });

    await t.test("a constraint violation inside a transaction rolls the whole unit back", async () => {
      const before = Number((await db.get("SELECT COUNT(*) AS n FROM students WHERE madrasa_id=?", [ctx.madrasaA])).n);
      await assert.rejects(db.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO students (madrasa_id,admission_no,first_name,last_name,gender,class_id,session_id) VALUES (?,?,?,?,?,?,?)",
          [ctx.madrasaA, "TXDUP1", "Dup", "One", "M", ctx.classA1, ctx.sessionA]
        );
        // Same admission_no in the same madrasa — must hit the unique key.
        await tx.run(
          "INSERT INTO students (madrasa_id,admission_no,first_name,last_name,gender,class_id,session_id) VALUES (?,?,?,?,?,?,?)",
          [ctx.madrasaA, "TXDUP1", "Dup", "Two", "M", ctx.classA1, ctx.sessionA]
        );
      }));
      const after = Number((await db.get("SELECT COUNT(*) AS n FROM students WHERE madrasa_id=?", [ctx.madrasaA])).n);
      assert.equal(after, before, "the first INSERT survived a rolled-back transaction");
    });

    await t.test("concurrent counter updates do not lose writes", async () => {
      await db.run("INSERT INTO classes (madrasa_id,name_en,name_ar,sort_order) VALUES (?,?,?,0)", [ctx.madrasaA, "Concurrent", "متزامن"]);
      const row = await db.get("SELECT id FROM classes WHERE madrasa_id=? AND name_en='Concurrent'", [ctx.madrasaA]);
      const N = 40;
      // Each writer does a read-modify-write INSIDE a transaction; InnoDB row
      // locks must serialise them so all N increments survive.
      await Promise.all(Array.from({ length: N }, () =>
        db.transaction(async (tx) => {
          await tx.run("UPDATE classes SET sort_order = sort_order + 1 WHERE id = ?", [row.id]);
        })
      ));
      const final = await db.get("SELECT sort_order FROM classes WHERE id=?", [row.id]);
      assert.equal(Number(final.sort_order), N, "lost update under concurrency");
    });

    await t.test("a concurrent unique-key race produces exactly one row", async () => {
      const attempts = 25;
      const results = await Promise.allSettled(Array.from({ length: attempts }, () =>
        db.run(
          "INSERT INTO students (madrasa_id,admission_no,first_name,last_name,gender,class_id,session_id) VALUES (?,?,?,?,?,?,?)",
          [ctx.madrasaA, "RACE001", "Race", "One", "M", ctx.classA1, ctx.sessionA]
        )
      ));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const rows = await db.all("SELECT id FROM students WHERE madrasa_id=? AND admission_no='RACE001'", [ctx.madrasaA]);
      assert.equal(rows.length, 1, `unique key allowed ${rows.length} duplicate rows`);
      assert.equal(ok, 1, `${ok} inserts reported success for one unique row`);
    });

    await t.test("many concurrent queries use a BOUNDED pool (users != connections)", async () => {
      const CONCURRENCY = 200;
      await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) =>
        db.all("SELECT id FROM students WHERE madrasa_id = ? LIMIT 5", [i % 2 ? ctx.madrasaA : ctx.madrasaB])
      ));
      const driver = await require("../server/db").dialect().then(() => null).catch(() => null);
      void driver;
      const threads = await db.get(
        "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ?",
        [schema]
      );
      const limit = Number(process.env.MYSQL_POOL_SIZE || 10);
      assert.ok(
        Number(threads.n) <= limit + 2,
        `${CONCURRENCY} concurrent queries opened ${threads.n} MySQL connections (pool limit ${limit})`
      );
    });

    await t.test("connections are released back to the pool (no leak)", async () => {
      // Run several waves; a leaking pool would grow monotonically.
      const counts = [];
      for (let wave = 0; wave < 3; wave++) {
        await Promise.all(Array.from({ length: 60 }, () => db.get("SELECT 1 AS ok")));
        await new Promise((r) => setTimeout(r, 250));
        const t2 = await db.get("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ?", [schema]);
        counts.push(Number(t2.n));
      }
      const limit = Number(process.env.MYSQL_POOL_SIZE || 10);
      for (const c of counts) assert.ok(c <= limit + 2, `pool grew to ${c} (limit ${limit}) — connections not released`);
    });

    await t.test("a rolled-back transaction releases its connection", async () => {
      for (let i = 0; i < 30; i++) {
        await assert.rejects(db.transaction(async (tx) => {
          await tx.get("SELECT 1 AS ok");
          throw new Error("rollback " + i);
        }));
      }
      // If the failing path leaked, the pool would now be exhausted and this
      // query would hang/fail rather than return promptly.
      const ok = await db.get("SELECT 1 AS ok");
      assert.equal(Number(ok.ok), 1);
    });

    await t.test("tenant isolation holds in SQL: no cross-tenant rows", async () => {
      const tenantTables = (await db.all(
        `SELECT DISTINCT TABLE_NAME AS t FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND COLUMN_NAME='madrasa_id'`,
        [schema]
      )).map((r) => r.t);
      for (const tbl of tenantTables) {
        if (tbl === "madrasa_registrations") continue; // varchar public code
        const bad = await db.get(
          `SELECT COUNT(*) AS n FROM \`${tbl}\` WHERE madrasa_id IS NOT NULL
             AND madrasa_id NOT IN (SELECT id FROM madaris)`
        );
        assert.equal(Number(bad.n), 0, `${tbl} holds rows for a non-existent tenant`);
      }
    });

    await t.test("utf8mb4 round-trips Arabic and emoji unchanged", async () => {
      const text = "المدرسة الإسلامية 🕌 test";
      await db.run("INSERT INTO subjects (madrasa_id,name_en,name_ar) VALUES (?,?,?)", [ctx.madrasaA, "Utf8Check", text]);
      const row = await db.get("SELECT name_ar FROM subjects WHERE madrasa_id=? AND name_en='Utf8Check'", [ctx.madrasaA]);
      assert.equal(row.name_ar, text);
    });

    await t.test("the MySQL upsert paths (session store, settings) work", async () => {
      await db.run(
        "INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [ctx.madrasaA, "mysql_upsert_probe", "first"]
      );
      await db.run(
        "INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [ctx.madrasaA, "mysql_upsert_probe", "second"]
      );
      const rows = await db.all("SELECT value FROM settings WHERE madrasa_id=? AND key_name='mysql_upsert_probe'", [ctx.madrasaA]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, "second");
    });

    await t.test("insertIgnore helper is a no-op on conflict (MySQL branch)", async () => {
      await db.run("INSERT INTO subjects (madrasa_id,name_en,name_ar) VALUES (?,?,?)", [ctx.madrasaA, "IgnoreProbe", "x"]);
      const before = Number((await db.get("SELECT COUNT(*) AS n FROM class_subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      const subj = await db.get("SELECT id FROM subjects WHERE madrasa_id=? AND name_en='IgnoreProbe'", [ctx.madrasaA]);
      await db.insertIgnore("class_subjects", "madrasa_id,class_id,subject_id", [ctx.madrasaA, ctx.classA1, subj.id]);
      await db.insertIgnore("class_subjects", "madrasa_id,class_id,subject_id", [ctx.madrasaA, ctx.classA1, subj.id]);
      const after = Number((await db.get("SELECT COUNT(*) AS n FROM class_subjects WHERE madrasa_id=?", [ctx.madrasaA])).n);
      assert.equal(after, before + 1, "insertIgnore inserted a duplicate on MySQL");
    });

    await t.test("no query in the run needed a full scan of a big tenant table", async () => {
      // EXPLAIN the hottest tenant query shape; it must use an index, not ALL.
      const plan = await db.all(
        "EXPLAIN SELECT id, first_name FROM students WHERE madrasa_id = ? AND status = 'active' ORDER BY admission_no LIMIT 25",
        [ctx.madrasaA]
      );
      const types = plan.map((p) => p.type);
      assert.ok(!types.includes("ALL"), `student listing does a full table scan: ${JSON.stringify(plan)}`);
    });
  });
}
