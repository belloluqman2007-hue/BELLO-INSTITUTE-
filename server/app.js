"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Express app factory
   ----------------------------------------------------------------------------
   Security layers (in order):
     1. helmet (CSP for our static assets, no sensitive headers)
     2. global API rate limit
     3. session (DB-backed, httpOnly, sameSite=lax, secure in production)
     4. CSRF double-submit guard on state-changing API calls
     5. user loading (fresh DB record every request)
     6. route-level role + tenant guards (backend-enforced isolation)
   No route trusts client-supplied tenant ids.
   ========================================================================== */
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const session = require("express-session");

const config = require("./config");
const DBSessionStore = require("./session-store");
const { loadUser } = require("./middleware/auth");
const { apiLimiter, loginLimiter } = require("./middleware/ratelimit");
const { router: authRouter, csrfGuard, ensureCsrfToken } = require("./routes/auth");
const platformRouter = require("./routes/platform");
const { router: madrasaRouter, rootRouter: madrasaRootRouter } = require("./routes/madrasa");
const studentsRouter = require("./routes/students");
const teachersRouter = require("./routes/teachers");
const { router: resultsRouter } = require("./routes/results");
const attendanceRouter = require("./routes/attendance");
const feesRouter = require("./routes/fees");
const announcementsRouter = require("./routes/announcements");
const portalRouter = require("./routes/portal");
const publicRouter = require("./routes/public");
const admissionsRouter = require("./routes/admissions");
const timetableRouter = require("./routes/timetable").router;
const exportsRouter = require("./routes/exports");
const extrasRouter = require("./routes/extras");
const backupsRouter = require("./routes/backups").router;
const { asyncHandler, ok, err, toNum } = require("./util");
const db = require("./db");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind a proxy (Render/Railway) for correct req.ip

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  }));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  /* ------------------------- CORS (allow-list) --------------------------- */
  // Same-origin by default (no headers needed). Cross-origin only if the
  // operator explicitly allows the origin via CORS_ORIGINS.
  const allowedOrigins = new Set(config.CORS_ORIGINS);
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      if (req.method === "OPTIONS") return res.status(204).end();
    }
    next();
  });

  /* ----------------------- frontend runtime config ----------------------- */
  // The SPA is same-origin by default and calls /api. If the operator sets
  // API_BASE_URL (API hosted on a different origin), this endpoint serves
  // it to the frontend — no hard-coded production URLs anywhere in code.
  app.get("/app-config.js", (req, res) => {
    res
      .type("application/javascript")
      .set("Cache-Control", "no-store")
      .send("window.__APP_CONFIG__=" + JSON.stringify({ apiBase: config.EFFECTIVE_API_BASE }) + ";");
  });

  // Static frontend + uploads
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use("/uploads", express.static(config.UPLOAD_DIR, { maxAge: "1h", fallthrough: true }));

  /* ----------------- pretty per-school links (/s/<slug>) --------------- */
  // Every registered madrasa gets its own shareable link,
  // e.g. https://your-domain/s/noor-ul-islam — it opens that school's own
  // public page directly (not the platform landing). The SPA reads the slug
  // from the path on boot and routes to #/madrasa/<slug>. /school/ and /m/
  // are accepted aliases of the same link.
  const schoolLinkHandler = (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  };
  app.get("/s/:slug", schoolLinkHandler);
  app.get("/school/:slug", schoolLinkHandler);
  app.get("/m/:slug", schoolLinkHandler);
  // Public directory landing pages. Their initial structure is intentionally
  // frontend-only while search, listings and category-specific registration
  // are developed in later milestones.
  app.get("/islamic-schools", schoolLinkHandler);
  app.get("/western-schools", schoolLinkHandler);
  app.get("/register-madrasa", schoolLinkHandler);

  /* ------------------------- PUBLIC API (no login) -------------------- */
  // The logged-out public site (directory, madrasa profile, online admission,
  // result checking). Mounted BEFORE the session/CSRF stack on purpose:
  // anonymous visitors then neither create database session rows nor need a
  // CSRF token, and they are governed by their own, stricter rate limits.
  app.use("/api/public", publicRouter);

  /* ------------------------------ API -------------------------------- */
  const api = express.Router();
  api.use(apiLimiter);

  // Public bootstrap config (no auth, no session). Lets the SPA discover the
  // effective API base instead of hard-coding a URL.
  api.get("/config", (req, res) => {
    res.json({
      apiBase: config.EFFECTIVE_API_BASE,
      appName: "Multi-Madrasa Management Platform",
      env: config.NODE_ENV,
    });
  });

  // Login is separately (more strictly) rate limited
  api.use("/auth/login", loginLimiter);

  // Sessions
  const sessionSecret = config.SESSION_SECRET || "dev-only-insecure-secret-000000000000000000000000";
  api.use(session({
    name: "mm_session",
    secret: sessionSecret,
    store: new DBSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: config.SESSION_MAX_AGE_MS,
      httpOnly: true,
      sameSite: "lax",
      secure: config.IS_PRODUCTION,
    },
  }));

  api.use(csrfGuard);
  api.use(loadUser);

  // CSRF token must be obtainable before login as well
  api.get("/csrf-token", (req, res) => res.json({ csrfToken: ensureCsrfToken(req) }));

  api.use("/auth", authRouter);
  api.use("/platform", platformRouter);
  api.use("/madrasa", madrasaRouter);
  api.use(madrasaRootRouter); // /api/classes, /api/subjects, /api/sessions, /api/grading
  api.use("/students", studentsRouter);
  api.use("/teachers", teachersRouter);
  api.use("/results", resultsRouter);
  api.use("/attendance", attendanceRouter);
  api.use("/fees", feesRouter);
  api.use("/announcements", announcementsRouter);
  api.use("/portal", portalRouter);
  api.use("/admissions", admissionsRouter);
  api.use("/timetable", timetableRouter);
  api.use("/exports", exportsRouter);
  api.use("/", extrasRouter); // /api/chat, /api/homework, /api/notifications, /api/users
  // Backups & storage diagnostics (super admin). Mounted before /platform so
  // the platform router never sees these paths.
  api.use("/platform/backups", backupsRouter);

  /* ------------------------------ activity log ------------------------ */
  api.get("/activity", asyncHandler(async (req, res) => {
    if (!req.user) return err(res, 401, "Authentication required.");
    if (req.user.role === "super_admin") {
      const mid = toNum(req.query.madrasaId, 0);
      const limit = Math.min(200, toNum(req.query.limit, 50));
      const rows = mid
        ? await db.all("SELECT * FROM activity_log WHERE madrasa_id = ? ORDER BY id DESC LIMIT ?", [mid, limit])
        : await db.all("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", [limit]);
      return ok(res, { activity: rows });
    }
    if (!req.user.madrasaId) return err(res, 403, "Permission denied.");
    const limit = Math.min(200, toNum(req.query.limit, 50));
    const rows = await db.all("SELECT * FROM activity_log WHERE madrasa_id = ? ORDER BY id DESC LIMIT ?", [req.user.madrasaId, limit]);
    ok(res, { activity: rows });
  }));

  /* ------------------------------ health ------------------------------ */
  api.get("/health", (req, res) => res.json({ ok: true, service: "multi-madrasa-platform" }));

  app.use("/api", api);

  // 404 for unknown API routes
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  // SPA fallback: unknown non-API GET -> index.html
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && req.accepts("html")) {
      return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    }
    next();
  });

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large." });
    }
    if (err && err.status === 400 && /JSON/i.test(err.message)) {
      return res.status(400).json({ error: "Invalid JSON body." });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
