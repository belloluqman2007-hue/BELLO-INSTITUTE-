"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — rate limiting
   ----------------------------------------------------------------------------
   • global API limiter (per IP)
   • stricter login limiter (per IP) — anti brute-force
   Both limits come from environment variables.
   ========================================================================== */
const rateLimit = require("express-rate-limit");
const config = require("../config");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.API_RATE_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.LOGIN_RATE_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Per IP+username: stops account brute-forcing without starving one IP
  // that legitimately hosts many users (e.g. a madrasa office).
  keyGenerator: (req) => {
    let username = "";
    try {
      const b = req.body;
      if (b && typeof b.username === "string") username = b.username.toLowerCase().slice(0, 100);
    } catch (e) { /* no body */ }
    return (req.ip || "unknown") + ":" + (username || "?");
  },
  message: { error: "Too many login attempts. Please wait and try again." },
});

module.exports = { apiLimiter, loginLimiter };
