"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — server entry point
   ========================================================================== */
const config = require("./config");
const { migrate } = require("./migrate");
const { createApp } = require("./app");
const { seedPlans, seedSuperAdmin } = require("./seed");
const db = require("./db");

(async () => {
  try {
    config.validate();
    // Always ensure the (new) database schema is up to date.
    await migrate();
    // Bootstrap a fresh database on every boot: default plans + the single
    // super admin. Both are idempotent (only created if absent), so an
    // existing database — and a password the admin later changed via the
    // app — is never overwritten. See docs/DEPLOYMENT.md → "Resetting the
    // super-admin password".
    await seedPlans();
    await seedSuperAdmin();
    const app = createApp();
    const server = app.listen(config.PORT, "0.0.0.0", () => {
      console.log("==============================================");
      console.log("  Multi-Madrasa Management Platform");
      console.log(`  env:    ${config.NODE_ENV}`);
      console.log(`  driver: ${config.DATABASE_DRIVER}${config.DATABASE_DRIVER === "sqlite" ? " (" + config.DB_CONFIG.file + ")" : ""}`);
      console.log(`  port:   ${config.PORT}`);
      console.log("==============================================");
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received — shutting down.`);
      server.close(async () => {
        try { await db.close(); } catch (e) { /* ignore */ }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
