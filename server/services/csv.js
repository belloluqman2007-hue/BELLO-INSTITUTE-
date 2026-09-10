"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — CSV generation
   ----------------------------------------------------------------------------
   Exports are Excel-friendly: UTF-8 BOM, CRLF, every field quoted only when it
   needs to be, and a leading apostrophe on anything that starts with = + - @
   so a spreadsheet never executes a value a student typed.
   ========================================================================== */

const BOM = "\uFEFF";

function cell(value) {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // CSV injection guard
  if (/[";\n\r,]/.test(v) || /^\s|\s$/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

/**
 * toCsv(rows, columns)
 * columns: [{ label, key, value?(row) }]  — `value` wins when given.
 */
function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.label)).join(",");
  const lines = (rows || []).map((row) =>
    columns.map((c) => cell(c.value ? c.value(row) : row[c.key])).join(",")
  );
  return BOM + [head].concat(lines).join("\r\n") + "\r\n";
}

function sendCsv(res, filename, text) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(text);
}

/**
 * RFC 4180 friendly number formatting — no locale surprises in a file.
 * A missing value stays a missing value: it is written as an empty cell so a
 * spreadsheet keeps the column numeric instead of filling it with zeroes that
 * look like real amounts.
 */
function num(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits).replace(/\.00$/, "");
}

module.exports = { toCsv, sendCsv, cell, num, BOM };
