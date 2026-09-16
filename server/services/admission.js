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
  const formatRow = await db.get("SELECT value FROM settings WHERE madrasa_id=? AND key_name='admission_number_format'", [madrasaId]);
  const format = String(formatRow && formatRow.value || "").trim();
  const rows = await db.all("SELECT admission_no FROM students WHERE madrasa_id = ?", [madrasaId]);
  if (format && /\{SEQ(?::\d+)?\}/i.test(format)) {
    const year = String(new Date().getFullYear());
    const seqMatch = format.match(/\{SEQ(?::(\d+))?\}/i);
    const width = Math.min(10, Math.max(1, Number(seqMatch && seqMatch[1] || 4)));
    // Replace format tokens with neutral markers before escaping the literal
    // separators. Escaping first leaves the digits inside {SEQ:4} unescaped,
    // so that token is never recognised and every conversion tries 0001.
    const escaped = format
      .replace(/\{SEQ(?::\d+)?\}/gi, "__ADMISSION_SEQ__")
      .replace(/\{YYYY\}/gi, "__ADMISSION_YEAR4__")
      .replace(/\{YY\}/gi, "__ADMISSION_YEAR2__")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/__ADMISSION_SEQ__/g, `(\\d{${width},})`)
      .replace(/__ADMISSION_YEAR4__/g, "\\d{4}")
      .replace(/__ADMISSION_YEAR2__/g, "\\d{2}");
    const re = new RegExp("^" + escaped + "$", "i"); let maxSeq = 0;
    rows.forEach((row) => { const match = String(row.admission_no || "").match(re); if (match) maxSeq = Math.max(maxSeq, Number(match[1]) || 0); });
    const next = maxSeq + 1;
    const admissionNo = format.replace(/\{YYYY\}/gi, year).replace(/\{YY\}/gi, year.slice(-2)).replace(/\{SEQ(?::\d+)?\}/gi, String(next).padStart(width, "0")).replace(/[^A-Za-z0-9/_-]/g, "").slice(0, 60).toUpperCase();
    return { admissionNo, prefix };
  }
  let maxSeq = 0;
  for (const r of rows) {
    const seq = parseSeq(r.admission_no, prefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const next = maxSeq + 1;
  return { admissionNo: prefix + String(next).padStart(4, "0"), prefix };
}

module.exports = { nextAdmissionNo, getPrefix };
