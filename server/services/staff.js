"use strict";
/* ============================================================================
   Teacher/staff identifiers
   ----------------------------------------------------------------------------
   The platform already has a tenant-scoped admission number generator. Staff
   IDs follow the same convention: each madrasa may set `staff_prefix` in the
   settings table; otherwise we reuse the admission prefix and append `T`.
   The next sequence is derived from teacher_profiles.staff_id, so identifiers
   are never reused after archive/restore.
   ========================================================================== */
const crypto = require("crypto");
const db = require("../db");
const admission = require("./admission");

function cleanPrefix(value) {
  return String(value || "").replace(/[^a-zA-Z0-9-]/g, "").toUpperCase().slice(0, 10) || "STAFF";
}

async function getStaffPrefix(madrasaId, api = db) {
  const row = await api.get("SELECT value FROM settings WHERE madrasa_id = ? AND key_name = 'staff_prefix'", [madrasaId]);
  if (row && String(row.value || "").trim()) return cleanPrefix(row.value);
  const prefix = await admission.getPrefix(madrasaId);
  return cleanPrefix(prefix + "T");
}

function parseSeq(staffId, prefix) {
  const value = String(staffId || "").toUpperCase();
  if (!value.startsWith(prefix)) return null;
  const digits = value.slice(prefix.length).replace(/^-/, "");
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

async function nextStaffId(madrasaId, api = db) {
  const prefix = await getStaffPrefix(madrasaId, api);
  const rows = await api.all("SELECT staff_id FROM teacher_profiles WHERE madrasa_id = ?", [madrasaId]);
  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseSeq(row.staff_id, prefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  return { staffId: prefix + String(maxSeq + 1).padStart(4, "0"), prefix };
}

function usernameFrom(value) {
  return String(value || "teacher")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "teacher";
}

async function uniqueUsername(base, api = db) {
  const root = usernameFrom(base);
  let candidate = root;
  let n = 1;
  while (await api.get("SELECT id FROM users WHERE username = ?", [candidate])) {
    n += 1;
    candidate = (root.slice(0, 74) + "-" + n).slice(0, 100);
  }
  return candidate;
}

function temporaryPassword() {
  // 14 URL-safe chars plus a fixed mixed-case/digit suffix to satisfy common
  // school password rules without exposing any secret in source code.
  return crypto.randomBytes(9).toString("base64url") + "A7!";
}

module.exports = { getStaffPrefix, nextStaffId, uniqueUsername, temporaryPassword };
