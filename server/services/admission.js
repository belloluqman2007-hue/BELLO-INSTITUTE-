"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — admission number generator
   ----------------------------------------------------------------------------
   Format: <PREFIX><4-digit sequence>, e.g. ALQ0001, FAT0042.
   Prefix comes from the madrasa's "admission_prefix" setting; default is the
   uppercase first three letters of the madrasa slug. The next sequence is
   derived from the highest existing number with that prefix, so numbers are
   unique per madrasa and never reused.
   ========================================================================== */
const db = require("../db");

async function getPrefix(madrasaId) {
  const row = await db.get("SELECT value FROM settings WHERE madrasa_id = ? AND key_name = 'admission_prefix'", [madrasaId]);
  if (row && row.value && String(row.value).trim()) return String(row.value).trim().toUpperCase().slice(0, 8);
  const m = await db.get("SELECT slug FROM madaris WHERE id = ?", [madrasaId]);
  const base = (m ? m.slug : "MAD").replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (base.slice(0, 3) || "MAD");
}

function parseSeq(admissionNo, prefix) {
  const s = String(admissionNo || "");
  if (!s.toUpperCase().startsWith(prefix)) return null;
  const digits = s.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

/** Returns { admissionNo, prefix } for the next available number. */
async function nextAdmissionNo(madrasaId) {
  const prefix = await getPrefix(madrasaId);
  const rows = await db.all("SELECT admission_no FROM students WHERE madrasa_id = ?", [madrasaId]);
  let maxSeq = 0;
  for (const r of rows) {
    const seq = parseSeq(r.admission_no, prefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const next = maxSeq + 1;
  return { admissionNo: prefix + String(next).padStart(4, "0"), prefix };
}

module.exports = { nextAdmissionNo, getPrefix };
