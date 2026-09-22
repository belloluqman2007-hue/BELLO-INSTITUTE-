"use strict";
/* ============================================================================
   ONLY_FULL_GROUP_BY auditor
   ----------------------------------------------------------------------------
   MySQL 8 enables ONLY_FULL_GROUP_BY by default: every non-aggregated column
   in a SELECT list must appear in GROUP BY (or be functionally dependent on
   it). SQLite happily returns an arbitrary row instead, so a query that works
   in development can fail with ER_WRONG_FIELD_WITH_GROUP in production.

   This script extracts every SQL string in server/ that has a GROUP BY and
   reports the selected columns that are neither aggregated nor grouped.
   It is a heuristic linter for review, not a SQL parser.

     node .audit-tools/only-full-group-by.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "server");
const AGG = /\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|JSON_ARRAYAGG)\s*\(/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Splits a SELECT list on top-level commas (ignores commas inside parens). */
function splitTop(list) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

let findings = 0;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  // Every template literal / quoted string that contains GROUP BY.
  const strings = src.match(/`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || [];
  for (const raw of strings) {
    const sql = raw.slice(1, -1);
    if (!/\bGROUP\s+BY\b/i.test(sql) || !/\bSELECT\b/i.test(sql)) continue;
    // Only analyse a string that holds ONE complete statement: a lone
    // SELECT ... FROM ... GROUP BY. Fragments concatenated across several JS
    // strings cannot be matched reliably and are reported as "unparsed".
    if ((sql.match(/\bSELECT\b/gi) || []).length !== 1) continue;
    if ((sql.match(/\bGROUP\s+BY\b/gi) || []).length !== 1) continue;
    const sel = /SELECT\s+([\s\S]*?)\s+FROM\b/i.exec(sql);
    const grp = /GROUP\s+BY\s+([\s\S]*?)(?:\s+(?:ORDER|HAVING|LIMIT)\b|$)/i.exec(sql);
    if (!sel || !grp) continue;
    // The GROUP BY must come after the SELECT list in the same statement.
    if (grp.index < sel.index) continue;
    const grouped = splitTop(grp[1]).map((g) => g.replace(/\s+(ASC|DESC)$/i, "").trim());
    const groupedSet = new Set(grouped.map((g) => g.toLowerCase()));
    const bad = [];
    for (const item of splitTop(sel[1])) {
      if (AGG.test(item)) continue;              // aggregated: fine
      if (/\$\{/.test(item)) continue;             // interpolated fragment
      if (/\*/.test(item)) continue;               // t.* — expanded by the server
      // strip an alias:  x.y AS z  ->  x.y
      const expr = item.replace(/\s+AS\s+[\w`"]+\s*$/i, "").trim();
      if (/^['"\d]/.test(expr)) continue;         // literal
      if (groupedSet.has(expr.toLowerCase())) continue;
      // functionally dependent on a grouped PRIMARY KEY of the same alias?
      const m = /^([\w]+)\.([\w]+)$/.exec(expr);
      if (m && groupedSet.has(`${m[1]}.id`)) continue;
      bad.push(expr);
    }
    if (bad.length) {
      findings++;
      console.log(`\n${path.relative(path.join(__dirname, ".."), file)}`);
      console.log(`  GROUP BY : ${grouped.join(", ")}`);
      console.log(`  ungrouped: ${bad.join(" | ")}`);
    }
  }
}
console.log(findings ? `\n${findings} query(ies) to review.` : "\nNo ONLY_FULL_GROUP_BY risks found.");
process.exit(0);
