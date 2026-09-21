"use strict";
/* ============================================================================
   BELLO — printable documents
   ----------------------------------------------------------------------------
   This module deliberately returns HTML, not PDF files. The browser's print
   engine is the document renderer, which keeps the feature small, portable
   and consistent with the existing fee receipts and report cards.

   Every query below is tenant-scoped from the authenticated user's session.
   No request can select a different madrasa by posting a madrasa_id.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const tokens = require("../services/tokens");
const { asyncHandler, err, ok, cleanStr, toNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId, getTeacherAssignments } = require("../middleware/tenant");
const { requireStaffPermission } = require("../services/permissions");

const router = express.Router();
router.use(requireAuth, requireTenant);

const STAFF = requireRole("madrasa_admin", "teacher");
const ADMIN = requireRole("madrasa_admin");
const TEMPLATE_TYPES = new Set(["graduation", "achievement", "completion", "participation", "custom"]);
const MAX_TEMPLATE_LENGTH = 200000;
const MAX_CUSTOM_FIELD_LENGTH = 500;

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) {
    err(res, 400, "Madrasa context required.");
    return null;
  }
  return Number(tid);
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeAssetPath(value) {
  const path = cleanStr(value, 500);
  // Logos and photos are uploaded through the existing image pipeline. Do not
  // turn a database value into an arbitrary remote image or javascript URL.
  return /^\/uploads\/[A-Za-z0-9_./-]+$/.test(path) ? path : "";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [year, month, day] = raw.split("-");
  return `${day}/${month}/${year}`;
}

function studentName(student) {
  return [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ").trim();
}

async function studentDocumentRow(tid, studentId) {
  return db.get(`
    SELECT s.*, c.name_en AS class_name, a.label AS session_label,
           m.name_en AS institution_name, m.logo_path, m.slug AS institution_slug,
           m.motto_en, m.category
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id AND c.madrasa_id = s.madrasa_id
    LEFT JOIN academic_sessions a ON a.id = s.session_id AND a.madrasa_id = s.madrasa_id
    JOIN madaris m ON m.id = s.madrasa_id
    WHERE s.id = ? AND s.madrasa_id = ?
  `, [studentId, tid]);
}

async function assertTeacherCanSee(req, res, tid, student) {
  if (req.user.role !== "teacher") return true;
  const scope = await getTeacherAssignments(tid, req.user.id);
  if (scope.anyClassAnySubject || scope.assignedClassIds.has(Number(student.class_id))) return true;
  err(res, 404, "Student not found.");
  return false;
}

/* --------------------------------------------------------------------------
   QR support
   --------------------------------------------------------------------------
   A small dependency-free QR encoder is kept here because printable pages
   must work offline and the platform intentionally does not add a PDF/QR
   package just for an optional ID-card decoration. It supports byte-mode
   QR versions 1–9 at error-correction level L, enough for a short signed
   profile URL. The resulting SVG is a real QR matrix, not a screenshot or a
   remote image request.
---------------------------------------------------------------------------- */
const QR_BLOCKS_L = [
  null,
  { version: 1, blocks: 1, total: 26, data: 19, ecc: 7 },
  { version: 2, blocks: 1, total: 44, data: 34, ecc: 10 },
  { version: 3, blocks: 1, total: 70, data: 55, ecc: 15 },
  { version: 4, blocks: 1, total: 100, data: 80, ecc: 20 },
  { version: 5, blocks: 1, total: 134, data: 108, ecc: 26 },
  { version: 6, blocks: 2, total: 86, data: 68, ecc: 18 },
  { version: 7, blocks: 2, total: 98, data: 78, ecc: 20 },
  { version: 8, blocks: 2, total: 121, data: 97, ecc: 24 },
  { version: 9, blocks: 2, total: 146, data: 116, ecc: 30 },
];
const QR_ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];

function gfTables() {
  const exp = new Uint8Array(512);
  const log = new Int16Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const GF = gfTables();
function gfMul(a, b) {
  return a && b ? GF.exp[GF.log[a] + GF.log[b]] : 0;
}
function qrGenerator(eccLength) {
  let poly = [1];
  for (let i = 0; i < eccLength; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF.exp[i]);
    }
    poly = next;
  }
  return poly;
}
function qrEcc(data, eccLength) {
  const generator = qrGenerator(eccLength);
  const result = new Uint8Array(eccLength);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[eccLength - 1] = 0;
    for (let i = 0; i < eccLength; i++) result[i] ^= gfMul(generator[i + 1], factor);
  }
  return result;
}
function qrBch(value, polynomial) {
  let v = value;
  const degree = 31 - Math.clz32(polynomial);
  while (v && (31 - Math.clz32(v)) >= degree) v ^= polynomial << ((31 - Math.clz32(v)) - degree);
  return v;
}
function qrBitsFor(data, version, capacity) {
  const bytes = Buffer.from(data, "utf8");
  const bits = [0, 1, 0, 0];
  const lengthBits = version < 10 ? 8 : 16;
  for (let i = lengthBits - 1; i >= 0; i--) bits.push((bytes.length >>> i) & 1);
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  const totalBits = capacity * 8;
  for (let i = 0; i < Math.min(4, totalBits - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
  let pad = 0;
  while (codewords.length < capacity) codewords.push((pad++ % 2) ? 0x11 : 0xec);
  return codewords;
}
function qrDataCodewords(text) {
  const bytes = Buffer.byteLength(String(text), "utf8");
  const entry = QR_BLOCKS_L.find((x) => x && bytes <= x.data * x.blocks - (x.version < 10 ? 2 : 3));
  if (!entry) return null;
  return { bytes: Buffer.from(String(text), "utf8"), entry };
}
function qrInterleaved(text) {
  const selected = qrDataCodewords(text);
  if (!selected) return null;
  const { bytes, entry } = selected;
  const dataWords = qrBitsFor(text, entry.version, entry.data * entry.blocks);
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < entry.blocks; i++) {
    const block = Uint8Array.from(dataWords.slice(offset, offset + entry.data));
    offset += entry.data;
    blocks.push({ data: block, ecc: qrEcc(block, entry.ecc) });
  }
  const out = [];
  for (let i = 0; i < entry.data; i++) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < entry.ecc; i++) for (const block of blocks) out.push(block.ecc[i]);
  return { version: entry.version, bytes, codewords: out };
}
function qrMatrix(text, mask) {
  const encoded = qrInterleaved(text);
  if (!encoded) return null;
  const version = encoded.version;
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size) continue;
      matrix[row + r][col + c] = (r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  const alignment = QR_ALIGNMENT[version] || [];
  for (const row of alignment) for (const col of alignment) {
    if (matrix[row][col] !== null) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
  }
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }
  matrix[size - 8][8] = true;
  const formatData = (1 << 3) | mask; // level L = 01
  const format = ((formatData << 10) | qrBch(formatData << 10, 0x537)) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((format >>> i) & 1) === 1;
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else matrix[size - 15 + i][8] = bit;
    if (i < 8) matrix[8][size - i - 1] = bit;
    else if (i < 9) matrix[8][15 - i - 1 + 1] = bit;
    else matrix[8][15 - i - 1] = bit;
  }
  const data = [];
  for (const word of encoded.codewords) for (let i = 7; i >= 0; i--) data.push((word >>> i) & 1);
  let bitIndex = 0; let row = size - 1; let direction = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (const c of [col, col - 1]) if (matrix[row][c] === null) {
        let bit = bitIndex < data.length ? data[bitIndex++] === 1 : false;
        const invert = [
          (row + c) % 2 === 0, row % 2 === 0, c % 3 === 0, (row + c) % 3 === 0,
          (Math.floor(row / 2) + Math.floor(c / 3)) % 2 === 0,
          (row * c) % 2 + (row * c) % 3 === 0,
          ((row * c) % 2 + (row * c) % 3) % 2 === 0,
          ((row * c) % 3 + (row + c) % 2) % 2 === 0,
        ][mask];
        matrix[row][c] = invert ? !bit : bit;
      }
      row += direction;
      if (row < 0 || row >= size) { row -= direction; direction = -direction; break; }
    }
  }
  return matrix;
}
function qrPenalty(matrix) {
  const size = matrix.length; let score = 0;
  const linePenalty = (line) => {
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  };
  for (let r = 0; r < size; r++) linePenalty(matrix[r]);
  for (let c = 0; c < size; c++) linePenalty(matrix.map((row) => row[c]));
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const a = matrix[r][c];
    if (a === matrix[r + 1][c] && a === matrix[r][c + 1] && a === matrix[r + 1][c + 1]) score += 3;
  }
  for (let r = 0; r < size; r++) for (let c = 0; c < size - 6; c++) if (matrix[r].slice(c, c + 7).join("") === "true,false,true,true,true,false,true") score += 40;
  for (let c = 0; c < size; c++) for (let r = 0; r < size - 6; r++) if (matrix.slice(r, r + 7).map((row) => row[c]).join("") === "true,false,true,true,true,false,true") score += 40;
  let dark = 0; for (const row of matrix) for (const cell of row) if (cell) dark++;
  score += Math.floor(Math.abs(100 * dark / (size * size) - 50) / 5) * 10;
  return score;
}
function qrSvg(text) {
  const candidates = Array.from({ length: 8 }, (_, mask) => ({ mask, matrix: qrMatrix(text, mask) })).filter((x) => x.matrix);
  if (!candidates.length) return "";
  const chosen = candidates.reduce((best, current) => qrPenalty(current.matrix) < qrPenalty(best.matrix) ? current : best);
  const matrix = chosen.matrix; const size = matrix.length; const paths = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r][c]) paths.push(`M${c} ${r}h1v1h-1z`);
  return `<svg class="qr-code" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="QR code linking to the student's public profile" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${size + 8}" height="${size + 8}" fill="#fff"/><path d="${paths.join("")}" fill="#111827"/></svg>`;
}

function signedProfileUrl(req, student) {
  const token = tokens.sign({ purpose: "public-student-profile", m: Number(student.madrasa_id), s: Number(student.id) }, 15 * 60);
  const path = `/api/public/student-profile/${token}`;
  const host = req.get("host");
  if (!host) return path;
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}${path}`;
}

/* ------------------------------- ID cards -------------------------------- */
async function loadIdCardStudent(req, res, tid, id) {
  const student = await studentDocumentRow(tid, id);
  if (!student) { err(res, 404, "Student not found."); return null; }
  if (!await assertTeacherCanSee(req, res, tid, student)) return null;
  return student;
}

function idCardMarkup(student, qrUrl = "") {
  const photo = safeAssetPath(student.photo_path);
  const logo = safeAssetPath(student.logo_path);
  const name = studentName(student);
  const categoryClass = String(student.category || "").toLowerCase() === "western" ? "category-western" : "category-islamic";
  return `<article class="id-card ${categoryClass}">
    <div class="id-card-band"><div class="id-school-mark">${logo ? `<img src="${escapeHtml(logo)}" alt="School logo">` : ""}</div><div class="id-school-name">${escapeHtml(student.institution_name)}</div></div>
    <div class="id-card-main">
      <div class="id-photo">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}">` : `<span>${escapeHtml((name || "S").slice(0, 1).toUpperCase())}</span>`}</div>
      <div class="id-details"><h2>${escapeHtml(name)}</h2><dl><div><dt>Admission No.</dt><dd>${escapeHtml(student.admission_no)}</dd></div><div><dt>Class</dt><dd>${escapeHtml(student.class_name || "Not assigned")}</dd></div><div><dt>Session</dt><dd>${escapeHtml(student.session_label || "Not set")}</dd></div><div><dt>Issued</dt><dd>${escapeHtml(dateLabel(student.issue_date))}</dd></div></dl></div>
      ${qrUrl ? `<div class="id-qr" data-profile-url="${escapeHtml(qrUrl)}"><a href="${escapeHtml(qrUrl)}" aria-label="Open public student profile">${qrSvg(qrUrl)}</a><small>Scan profile</small></div>` : ""}
    </div>
    <div class="id-card-footer"><span>${escapeHtml(student.motto_en || "Student identification card")}</span><b>${escapeHtml(String(student.category || "").toLowerCase() === "western" ? "STUDENT ID" : "STUDENT ID")}</b></div>
  </article>`;
}

function printShell(title, css, body, pageSize) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}\n@media print{.print-bar{display:none!important}}\n</style></head><body><div class="print-bar"><button id="printPageBtn" type="button">Print / Save as PDF</button></div>${body}<script src="/js/print.js"></script></body></html>`;
}

const ID_CARD_CSS = `
@page{size:85mm 54mm;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#edf0f5;color:#182133;font-family:Arial,"Segoe UI",sans-serif}
.print-bar{padding:12px;text-align:center}.print-bar button{border:0;border-radius:7px;background:#1f3154;color:#fff;padding:9px 16px;font-weight:700;cursor:pointer}
.id-card{width:85mm;height:54mm;overflow:hidden;margin:16px auto;background:#fff;border:1px solid #c6d1e1;border-radius:3mm;box-shadow:0 3px 15px #172b4d22;display:flex;flex-direction:column;break-inside:avoid}
.id-card-band{height:12mm;display:flex;align-items:center;gap:2.5mm;padding:2mm 3mm;background:linear-gradient(110deg,#182b4d,#31588c);color:#fff}.id-card.category-islamic .id-card-band{background:linear-gradient(110deg,#200a3d,#5b2a86)}.id-card.category-western .id-card-band{background:linear-gradient(110deg,#0a2342,#0d5a8a)}.id-school-mark{width:8mm;height:8mm;border-radius:50%;background:#fff;display:grid;place-items:center;overflow:hidden;flex:none}.id-school-mark img{width:100%;height:100%;object-fit:contain}.id-school-name{font-size:3.2mm;font-weight:800;line-height:1.15;letter-spacing:.02em;max-width:66mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.id-card-main{display:flex;gap:2.5mm;align-items:center;flex:1;padding:2.5mm 3mm 1.5mm}.id-photo{width:18mm;height:22mm;flex:none;border:1px solid #d2dae5;background:#eef2f7;display:grid;place-items:center;overflow:hidden;border-radius:1.5mm;color:#70809a;font-size:7mm;font-weight:800}.id-photo img{width:100%;height:100%;object-fit:cover}.id-details{min-width:0;flex:1}.id-details h2{margin:0 0 1.5mm;font-size:4mm;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#182b4d}.id-details dl{margin:0}.id-details dl div{display:flex;gap:1mm;line-height:1.25}.id-details dt{width:18mm;flex:none;font-size:2.2mm;color:#6c7890}.id-details dd{margin:0;font-size:2.45mm;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.id-qr{width:14mm;flex:none;text-align:center}.qr-code{display:block;width:13mm;height:13mm}.id-qr small{font-size:1.8mm;color:#66748a;display:block;margin-top:.5mm}.id-card-footer{border-top:1px solid #dce3ec;padding:1.4mm 3mm;display:flex;justify-content:space-between;gap:2mm;font-size:1.9mm;color:#67758c;white-space:nowrap}.id-card-footer span{overflow:hidden;text-overflow:ellipsis}.id-card-footer b{color:#31588c;font-size:2mm}
@media print{body{background:#fff}.print-bar{display:none}.id-card{margin:0;box-shadow:none}}
`;

router.get("/id-card/bulk", STAFF, requireStaffPermission("documents.generate"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const classId = toNum(req.query.classId, 0);
  if (!classId) return err(res, 400, "classId is required.");
  const klass = await db.get("SELECT id, name_en FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]);
  if (!klass) return err(res, 404, "Class not found.");
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && !scope.assignedClassIds.has(classId)) return err(res, 404, "Class not found.");
  }
  const students = await db.all(`
    SELECT s.*, c.name_en AS class_name, a.label AS session_label,
           m.name_en AS institution_name, m.logo_path, m.motto_en, m.category
    FROM students s
    LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id
    LEFT JOIN academic_sessions a ON a.id=s.session_id AND a.madrasa_id=s.madrasa_id
    JOIN madaris m ON m.id=s.madrasa_id
    WHERE s.madrasa_id=? AND s.class_id=? AND s.status NOT IN ('withdrawn','inactive')
    ORDER BY s.last_name,s.first_name,s.id`, [tid, classId]);
  if (req.user.role === "teacher") {
    const scope = await getTeacherAssignments(tid, req.user.id);
    if (!scope.anyClassAnySubject && !scope.assignedClassIds.has(classId)) return err(res, 404, "Class not found.");
  }
  if (!students.length) return err(res, 404, "No students found in this class.");
  const sheets = [];
  for (let i = 0; i < students.length; i += 4) {
    sheets.push(`<section class="id-card-sheet">${students.slice(i, i + 4).map((student) => { student.issue_date = today(); return idCardMarkup(student, ""); }).join("")}</section>`);
  }
  const bulkCss = ID_CARD_CSS.replace("@page{size:85mm 54mm;margin:0}", "@page{size:A4 portrait;margin:10mm}") + `
.id-card-sheet{width:190mm;min-height:277mm;margin:0 auto;display:grid;grid-template-columns:repeat(2,85mm);grid-auto-rows:54mm;gap:8mm 10mm;align-content:start;justify-content:center;break-after:page;page-break-after:always}.id-card-sheet:last-child{break-after:auto;page-break-after:auto}.id-card-sheet .id-card{margin:0}
@media print{.id-card-sheet{margin:0;min-height:277mm}}
`;
  res.type("html").send(printShell(`ID cards — ${klass.name_en}`, bulkCss, sheets.join(""), "A4"));
}));

router.get("/id-card/:studentId", STAFF, requireStaffPermission("documents.generate"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const student = await loadIdCardStudent(req, res, tid, toNum(req.params.studentId, 0)); if (!student) return;
  student.issue_date = today();
  const qrUrl = ["1", "true", "yes"].includes(String(req.query.qr || "").toLowerCase()) ? signedProfileUrl(req, student) : "";
  res.type("html").send(printShell(`ID card — ${studentName(student)}`, ID_CARD_CSS, idCardMarkup(student, qrUrl), "85mm 54mm"));
}));

/* -------------------------- certificate templates ----------------------- */
function cleanTemplateHtml(value) {
  // The editor is intentionally HTML-based, but stored templates must not be
  // able to execute scripts when a certificate is opened by a staff member.
  return String(value || "").slice(0, MAX_TEMPLATE_LENGTH)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}
function templateType(value) {
  const type = cleanStr(value, 30).toLowerCase();
  return TEMPLATE_TYPES.has(type) ? type : "custom";
}
function normalizeCustomFields(value) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch (_) { source = {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) source = {};
  const out = {};
  for (let i = 1; i <= 3; i++) out[`custom_field_${i}`] = cleanStr(source[`custom_field_${i}`] ?? source[String(i)] ?? "", MAX_CUSTOM_FIELD_LENGTH);
  return out;
}
function replacePlaceholders(template, values) {
  return cleanTemplateHtml(template).replace(/\{\{\s*(student_name|class|session|date|custom_field_[1-3])\s*\}\}/gi, (_, key) => escapeHtml(values[String(key).toLowerCase()] || ""));
}

router.get(["/templates", "/certificate-templates"], ADMIN, requireStaffPermission("documents.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const templates = await db.all("SELECT id, madrasa_id, name, type, html_template, created_at, archived_at FROM certificate_templates WHERE madrasa_id=? ORDER BY archived_at IS NOT NULL, name, id DESC", [tid]);
  ok(res, { templates });
}));

router.get(["/templates/:id", "/certificate-templates/:id"], ADMIN, requireStaffPermission("documents.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const template = await db.get("SELECT * FROM certificate_templates WHERE id=? AND madrasa_id=?", [toNum(req.params.id, 0), tid]);
  if (!template) return err(res, 404, "Certificate template not found.");
  ok(res, { template });
}));

router.post(["/templates", "/certificate-templates"], ADMIN, requireStaffPermission("documents.generate"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; const name = cleanStr(b.name, 160); const html = cleanTemplateHtml(b.html_template);
  if (!name) return err(res, 400, "Template name is required.");
  if (!html.trim()) return err(res, 400, "HTML template is required.");
  if (String(b.html_template || "").length > MAX_TEMPLATE_LENGTH) return err(res, 400, "HTML template is too large.");
  const requestedType = cleanStr(b.type, 30).toLowerCase();
  if (requestedType && !TEMPLATE_TYPES.has(requestedType)) return err(res, 400, "Invalid certificate template type.");
  const type = requestedType || "custom";
  const result = await db.run("INSERT INTO certificate_templates (madrasa_id,name,type,html_template) VALUES (?,?,?,?)", [tid, name, type, html]);
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "certificate_template.create", entity: "certificate_template", entityId: String(result.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: result.lastInsertRowid });
}));

router.patch(["/templates/:id", "/certificate-templates/:id"], ADMIN, requireStaffPermission("documents.generate"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0); const existing = await db.get("SELECT * FROM certificate_templates WHERE id=? AND madrasa_id=?", [id, tid]);
  if (!existing) return err(res, 404, "Certificate template not found.");
  const b = req.body || {}; const sets = []; const values = [];
  if (b.name !== undefined) { const name = cleanStr(b.name, 160); if (!name) return err(res, 400, "Template name is required."); sets.push("name=?"); values.push(name); }
  if (b.type !== undefined) { const type = cleanStr(b.type, 30).toLowerCase(); if (!TEMPLATE_TYPES.has(type)) return err(res, 400, "Invalid certificate template type."); sets.push("type=?"); values.push(type); }
  if (b.html_template !== undefined) { if (String(b.html_template).length > MAX_TEMPLATE_LENGTH) return err(res, 400, "HTML template is too large."); const html = cleanTemplateHtml(b.html_template); if (!html.trim()) return err(res, 400, "HTML template is required."); sets.push("html_template=?"); values.push(html); }
  if (b.archived !== undefined) { sets.push("archived_at=?"); values.push(b.archived === true || b.archived === 1 || b.archived === "1" ? today() : null); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  values.push(id, tid); await db.run(`UPDATE certificate_templates SET ${sets.join(",")} WHERE id=? AND madrasa_id=?`, values);
  ok(res, { ok: true });
}));

/* ------------------------------- certificates --------------------------- */
async function certificateRow(tid, id) {
  return db.get(`
    SELECT c.*, t.name AS template_name, t.type AS template_type, t.html_template,
           s.first_name, s.middle_name, s.last_name, s.admission_no, s.class_id, s.session_id,
           cl.name_en AS class_name, a.label AS session_label,
           m.name_en AS institution_name, m.name_ar AS institution_name_ar, m.logo_path,
           m.motto_en, m.address, m.city, m.state_name, m.category
    FROM certificates c
    JOIN certificate_templates t ON t.id=c.template_id AND t.madrasa_id=c.madrasa_id
    JOIN students s ON s.id=c.student_id AND s.madrasa_id=c.madrasa_id
    LEFT JOIN classes cl ON cl.id=s.class_id AND cl.madrasa_id=s.madrasa_id
    LEFT JOIN academic_sessions a ON a.id=s.session_id AND a.madrasa_id=s.madrasa_id
    JOIN madaris m ON m.id=c.madrasa_id
    WHERE c.id=? AND c.madrasa_id=?
  `, [id, tid]);
}
function certificateValues(row) {
  return Object.assign({
    student_name: studentName(row),
    class: row.class_name || "",
    session: row.session_label || "",
    date: dateLabel(row.issued_date),
  }, normalizeCustomFields(row.custom_fields));
}
function renderCertificate(row) {
  const html = replacePlaceholders(row.html_template, certificateValues(row));
  const logo = safeAssetPath(row.logo_path);
  return printShell(`Certificate — ${studentName(row)}`, `
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#172033;font-family:Georgia,"Times New Roman",serif}.print-bar{padding:12px;text-align:center;font-family:Arial,sans-serif}.print-bar button{border:0;border-radius:7px;background:#1f3154;color:#fff;padding:9px 16px;font-weight:700;cursor:pointer}.certificate-page{width:297mm;min-height:210mm;margin:0 auto;padding:18mm;position:relative;background:#fff}.certificate-frame{min-height:174mm;border:3px double #1f3154;padding:14mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.certificate-brand{position:absolute;top:24mm;left:28mm;right:28mm;display:flex;align-items:center;justify-content:center;gap:4mm;font-family:Arial,sans-serif}.certificate-brand img{height:16mm;max-width:24mm;object-fit:contain}.certificate-brand strong{font-size:6mm;letter-spacing:.04em;color:#1f3154}.certificate-content{width:100%;margin-top:18mm}.certificate-content img{max-width:150mm}.certificate-footer{margin-top:10mm;font:3.5mm Arial,sans-serif;color:#667085}
@media print{body{background:#fff}.print-bar{display:none}.certificate-page{margin:0}}
`, `<main class="certificate-page"><div class="certificate-brand">${logo ? `<img src="${escapeHtml(logo)}" alt="School logo">` : ""}<strong>${escapeHtml(row.institution_name)}</strong></div><div class="certificate-frame"><div class="certificate-content">${html}</div><div class="certificate-footer">Issued ${escapeHtml(dateLabel(row.issued_date))} · ${escapeHtml(row.template_name)}</div></div></main>`, "A4 landscape");
}

router.post("/certificates", ADMIN, requireStaffPermission("documents.generate"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {};
  const templateId = toNum(b.template_id, 0);
  const template = await db.get("SELECT id FROM certificate_templates WHERE id=? AND madrasa_id=? AND archived_at IS NULL", [templateId, tid]);
  if (!template) return err(res, 400, "Active certificate template not found.");
  let ids = Array.isArray(b.student_ids) ? b.student_ids : (b.student_id !== undefined ? [b.student_id] : []);
  ids = [...new Set(ids.map((id) => toNum(id, 0)).filter((id) => id > 0))];
  if (!ids.length) return err(res, 400, "At least one student_id is required.");
  const issuedDate = b.issued_date === undefined || b.issued_date === "" ? today() : validDate(b.issued_date);
  if (!issuedDate) return err(res, 400, "issued_date must be YYYY-MM-DD.");
  const customFields = normalizeCustomFields(b.custom_fields);
  const students = [];
  for (const id of ids) {
    const row = await db.get("SELECT id FROM students WHERE id=? AND madrasa_id=?", [id, tid]);
    if (!row) return err(res, 400, "One or more students were not found in this madrasa.");
    students.push(row.id);
  }
  const created = await db.transaction(async (tx) => {
    const out = [];
    for (const id of students) {
      const r = await tx.run("INSERT INTO certificates (madrasa_id,student_id,template_id,custom_fields,issued_date) VALUES (?,?,?,?,?)", [tid, id, templateId, JSON.stringify(customFields), issuedDate]);
      out.push(Number(r.lastInsertRowid));
    }
    return out;
  });
  for (const id of created) logActivity(db, { madrasaId: tid, userId: req.user.id, action: "certificate.issue", entity: "certificate", entityId: String(id), meta: { templateId, issuedDate }, ip: req.ip });
  ok(res, { ok: true, id: created[0], ids: created });
}));

router.get("/certificates", STAFF, requireStaffPermission("documents.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const where = ["c.madrasa_id=?"]; const params = [tid];
  if (req.query.studentId !== undefined) { const studentId = toNum(req.query.studentId, 0); if (!studentId) return err(res, 400, "studentId must be a valid id."); where.push("c.student_id=?"); params.push(studentId); }
  const rows = await db.all(`SELECT c.id,c.madrasa_id,c.student_id,c.template_id,c.custom_fields,c.issued_date,c.created_at,t.name AS template_name,t.type AS template_type,s.first_name,s.middle_name,s.last_name,s.admission_no FROM certificates c JOIN certificate_templates t ON t.id=c.template_id AND t.madrasa_id=c.madrasa_id JOIN students s ON s.id=c.student_id AND s.madrasa_id=c.madrasa_id WHERE ${where.join(" AND ")} ORDER BY c.issued_date DESC,c.id DESC LIMIT 500`, params);
  ok(res, { certificates: rows.map((row) => Object.assign({}, row, { student_name: studentName(row) })) });
}));

router.get("/certificates/:id", STAFF, requireStaffPermission("documents.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const row = await certificateRow(tid, toNum(req.params.id, 0));
  if (!row) return res.status(404).type("html").send("Certificate not found");
  if (!await assertTeacherCanSee(req, res, tid, row)) return;
  res.type("html").send(renderCertificate(row));
}));

module.exports = router;
module.exports._private = { qrSvg, replacePlaceholders, renderCertificate, idCardMarkup };
