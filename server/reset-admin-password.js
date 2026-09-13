"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — super-admin password reset (explicit)
   ----------------------------------------------------------------------------
   Sets the super-admin account's password to the value currently in the
   SUPER_ADMIN_PASSWORD environment variable, creating the account if it
   does not exist yet.

   WHY THIS IS NEEDED
   The SUPER_ADMIN_PASSWORD env var is only read when the super-admin account
   is FIRST created (fresh-DB boot or `npm run seed`). Changing the env var
   afterwards — e.g. in Render → Environment — does NOT update the stored
   password hash, and seeding intentionally skips an existing super admin so
   a password the admin later changed in the app is never silently
   overwritten. So a changed env var alone can leave login broken with
   "Invalid username or password".

   USAGE
     npm run reset-admin-password

   On Render: open the service's Shell (or `render shell multi-madrasa-platform`)
   and run the command there — it targets the same database the service uses
   (DATABASE_URL / DB_* from the environment).
   ========================================================================== */
const bcrypt = require("bcryptjs");
const db = require("./db");
const config = require("./config");

require("./db-target").announce({ allowCreate: false });

(async () => {
  try {
    if (!config.SUPER_ADMIN_PASSWORD) {
      console.error("FATAL: SUPER_ADMIN_PASSWORD is not set in the environment.");
      console.error("Set it first (Render → your service → Environment), then re-run this script.");
      process.exit(1);
    }
    const hash = bcrypt.hashSync(config.SUPER_ADMIN_PASSWORD, 10);
    // Usernames are matched in lower case at login, so an account stored as
    // "Admin" (an older seed honoured the env var's casing verbatim) can never
    // be signed into. Repair the casing while we are here, or the reset would
    // report success against an account that still cannot log in.
    const res = await db.run(
      "UPDATE users SET password_hash = ?, username = LOWER(username), is_active = 1 WHERE role = 'super_admin'",
      [hash]
    );
    if (Number(res.changes) > 0) {
      const rows = await db.all("SELECT username FROM users WHERE role = 'super_admin'");
      console.log(`Super admin password reset for: ${rows.map((r) => r.username).join(", ")}`);
    } else {
      await db.run(
        "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (NULL, ?, ?, 'super_admin', 'Platform Super Admin')",
        [config.SUPER_ADMIN_USERNAME, hash]
      );
      console.log(`No super admin existed — created: ${config.SUPER_ADMIN_USERNAME}`);
    }
    console.log("Done. Log in with that username and the current SUPER_ADMIN_PASSWORD value.");
    await db.close();
  } catch (err) {
    console.error("Reset failed:", err);
    process.exit(1);
  }
})();
