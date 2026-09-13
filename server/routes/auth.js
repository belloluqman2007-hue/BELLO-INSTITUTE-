"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — authentication routes
   ----------------------------------------------------------------------------
   • POST /api/auth/login        (rate-limited, constant-time-ish error)
   • POST /api/auth/logout
   • GET  /api/auth/me
   • POST /api/auth/change-password
   • GET  /api/csrf-token        (double-submit CSRF token)
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const { cleanStr, logActivity, asyncHandler } = require("../util");

const router = express.Router();

/* ------------------------------ CSRF ----------------------------------- */

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

router.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: ensureCsrfToken(req) });
});

/**
 * CSRF guard: every state-changing API call must present the session token
 * in the X-CSRF-Token header. Login is exempt (pre-auth), as is token fetch.
 */
function csrfGuard(req, res, next) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return next();
  const path = req.path;
  if (path.startsWith("/auth/login") || path.startsWith("/csrf-token")) return next();
  const token = String(req.get("x-csrf-token") || "");
  if (!token || token !== (req.session && req.session.csrfToken)) {
    return res.status(403).json({ error: "CSRF token missing or invalid. Refresh the page and try again." });
  }
  next();
}

/* ------------------------------ login ---------------------------------- */

router.post("/login", async (req, res) => {
  const username = cleanStr(req.body && req.body.username, 100).toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
  // Compare against a dummy hash when user is missing to keep timing even.
  const dummyHash = "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpI7eC2FVWQvXxZK9yJ5r3KbLmNnS";
  const hash = user ? user.password_hash : dummyHash;
  let match = false;
  try { match = await bcrypt.compare(password, hash); } catch (e) { match = false; }
  if (!user || !match) {
    // A database with NO accounts at all is not a wrong password — it is an
    // un-provisioned platform, and "Invalid username or password" sends the
    // operator hunting for a typo that does not exist. This leaks nothing:
    // it can only ever fire when there is no one to enumerate.
    const any = await db.get("SELECT COUNT(*) AS n FROM users");
    if (any && Number(any.n) === 0) {
      return res.status(503).json({
        error: "This platform has no accounts yet, so no sign-in can succeed. " +
          "The administrator must create the super admin (set SUPER_ADMIN_PASSWORD, " +
          "then run \"npm run reset-admin-password\") before anyone can log in.",
        code: "NO_ACCOUNTS",
      });
    }
    return res.status(401).json({ error: "Invalid username or password." });
  }
  if (Number(user.is_active) !== 1) {
    return res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
  }

  // Madrasa-scoped users must belong to an ACTIVE madrasa.
  if (user.madrasa_id) {
    const madrasa = await db.get("SELECT id, status FROM madaris WHERE id = ?", [user.madrasa_id]);
    if (!madrasa || madrasa.status !== "active") {
      return res.status(403).json({ error: "Your madrasa account is not active. Contact the platform administrator." });
    }
  }

  // Madrasa-scoped users also carry their institution's category (islamic /
  // western) so the SPA can route straight to the right admin dashboard
  // without a second round trip.
  let category = null;
  let institutionName = null;
  if (user.madrasa_id) {
    const madrasa = await db.get("SELECT category, name_en, verified FROM madaris WHERE id = ?", [user.madrasa_id]);
    if (madrasa) { category = madrasa.category || "islamic"; institutionName = madrasa.name_en; }
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Session error." });
    req.session.userId = user.id;
    ensureCsrfToken(req);
    logActivity(db, {
      madrasaId: user.madrasa_id,
      userId: user.id,
      action: "login",
      entity: "auth",
      entityId: String(user.id),
      ip: req.ip || "",
    });
    res.json({
      ok: true,
      role: user.role,
      madrasaId: user.madrasa_id,
      category,
      institutionName,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
        fullNameAr: user.full_name_ar,
      },
    });
  });
});

router.post("/logout", (req, res) => {
  const uid = req.session && req.session.userId;
  const mid = req.user ? req.user.madrasaId : null;
  req.session.destroy(() => {
    res.clearCookie("mm_session");
    logActivity(db, { madrasaId: mid, userId: uid, action: "logout", entity: "auth", entityId: String(uid || "") });
    res.json({ ok: true });
  });
});

router.get("/me", asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  let category = null;
  let institutionName = null;
  let institutionSlug = null;
  let verified = false;
  if (req.user.madrasaId) {
    const madrasa = await db.get("SELECT category, name_en, slug, verified FROM madaris WHERE id = ?", [req.user.madrasaId]);
    if (madrasa) {
      category = madrasa.category || "islamic";
      institutionName = madrasa.name_en;
      institutionSlug = madrasa.slug;
      verified = Number(madrasa.verified) === 1;
    }
  }
  res.json({
    loggedIn: true,
    role: req.user.role,
    madrasaId: req.user.madrasaId,
    category,
    institutionName,
    institutionSlug,
    verified,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      fullName: req.user.fullName,
      fullNameAr: req.user.fullNameAr,
    },
  });
}));

router.post("/change-password", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  const current = String((req.body && req.body.currentPassword) || "");
  const next = String((req.body && req.body.newPassword) || "");
  if (next.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const user = await db.get("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found." });
  const match = await bcrypt.compare(current, user.password_hash);
  if (!match) return res.status(400).json({ error: "Current password is incorrect." });
  const hash = bcrypt.hashSync(next, 10);
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
  logActivity(db, { madrasaId: req.user.madrasaId, userId: req.user.id, action: "change_password", entity: "auth", entityId: String(req.user.id), ip: req.ip });
  res.json({ ok: true });
});

module.exports = { router, csrfGuard, ensureCsrfToken };
