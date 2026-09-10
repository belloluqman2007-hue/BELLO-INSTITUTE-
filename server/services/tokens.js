"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — stateless signed tokens
   ----------------------------------------------------------------------------
   Used by the PUBLIC (logged-out) result checker. A visitor proves they own a
   record, and instead of being handed an IDOR-style URL like
   /report-card/12/3 (guessable, permanent, indexable) they get a short-lived
   HMAC token that encodes { purpose, madrasaId, studentId, termId, exp }.

   The token is signed with the deployment secret, so it cannot be forged, it
   expires on its own (no cleanup job, no state table) and it is useless for
   anything but the purpose it was minted for.
   ========================================================================== */
const crypto = require("crypto");
const config = require("../config");

const KEY = crypto.createHash("sha256").update(String(config.SESSION_SECRET || "dev-only-insecure-secret-000000000000000000000000")).digest();

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** sign({purpose:'x', ...}, 900) → "<payload>.<signature>" */
function sign(payload, ttlSeconds = 900) {
  const body = b64url(Buffer.from(JSON.stringify(Object.assign({}, payload, { exp: Math.floor(Date.now() / 1000) + ttlSeconds })), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", KEY).update(body).digest());
  return body + "." + sig;
}

/** Returns the payload, or null when the token is forged, malformed or expired. */
function verify(token, purpose) {
  const raw = String(token || "");
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = b64url(crypto.createHmac("sha256", KEY).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlJson(body)); } catch (e) { return null; }
  if (!payload || typeof payload !== "object") return null;
  if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
  if (purpose && payload.purpose !== purpose) return null;
  return payload;
}

module.exports = { sign, verify };
