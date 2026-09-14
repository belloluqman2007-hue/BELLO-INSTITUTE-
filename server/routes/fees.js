"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Fees routes
   ----------------------------------------------------------------------------
   madrasa_admin manages fee items (per term) and records payments.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, clampNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { effectiveTenantId } = require("../middleware/tenant");

const router = express.Router();
router.use(requireAuth, requireTenant);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}

/* ------------------------------ fee items ------------------------------ */

router.get("/items", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const rows = await db.all("SELECT * FROM fee_items WHERE madrasa_id = ? ORDER BY id DESC", [tid]);
  ok(res, { items: rows });
}));

router.post("/items", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const nameEn = cleanStr(b.name_en, 120);
  if (!nameEn) return err(res, 400, "name_en is required.");
  const termId = b.term_id ? toNum(b.term_id, 0) : null;
  if (termId) {
    const t = await db.get("SELECT id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]);
    if (!t) return err(res, 400, "Unknown term.");
  }
  const r = await db.run(
    "INSERT INTO fee_items (madrasa_id, term_id, name_en, name_ar, amount_ngn) VALUES (?,?,?,?,?)",
    [tid, termId, nameEn, cleanStr(b.name_ar, 120), clampNum(b.amount_ngn, 0, 99999999, 0)]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "fee_item.create", entity: "fee_item", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.patch("/items/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const item = await db.get("SELECT * FROM fee_items WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!item) return res.status(404).json({ error: "Fee item not found." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name_en !== undefined) { sets.push("name_en = ?"); vals.push(cleanStr(b.name_en, 120)); }
  if (b.name_ar !== undefined) { sets.push("name_ar = ?"); vals.push(cleanStr(b.name_ar, 120)); }
  if (b.amount_ngn !== undefined) { sets.push("amount_ngn = ?"); vals.push(clampNum(b.amount_ngn, 0, 99999999, 0)); }
  if (b.term_id !== undefined) { sets.push("term_id = ?"); vals.push(b.term_id ? toNum(b.term_id, 0) : null); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(item.id);
  await db.run(`UPDATE fee_items SET ${sets.join(", ")} WHERE id = ?`, vals);
  ok(res, { ok: true });
}));

router.delete("/items/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const item = await db.get("SELECT * FROM fee_items WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!item) return res.status(404).json({ error: "Fee item not found." });
  await db.run("DELETE FROM fee_items WHERE id = ?", [item.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ payments ------------------------------- */

router.get("/payments", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const rows = await db.all(
    `SELECT fp.*, fi.name_en AS item_en, fi.name_ar AS item_ar,
            s.admission_no, s.first_name, s.last_name
     FROM fee_payments fp
     JOIN students s ON s.id = fp.student_id
     LEFT JOIN fee_items fi ON fi.id = fp.fee_item_id
     WHERE fp.madrasa_id = ? ORDER BY fp.payment_date DESC, fp.id DESC LIMIT 500`,
    [tid]
  );
  ok(res, { payments: rows });
}));

router.post("/payments", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const b = req.body || {};
  const studentId = toNum(b.student_id, 0);
  const amount = clampNum(b.amount_ngn, 0, 99999999, 0);
  const day = validDate(b.payment_date);
  if (!studentId || amount <= 0) return err(res, 400, "student_id and a positive amount are required.");
  if (!day) return err(res, 400, "payment_date (YYYY-MM-DD) is required.");
  const stu = await db.get("SELECT id FROM students WHERE id = ? AND madrasa_id = ?", [studentId, tid]);
  if (!stu) return err(res, 404, { error: "Student not found." });
  const feeItemId = b.fee_item_id ? toNum(b.fee_item_id, 0) : null;
  if (feeItemId) {
    const f = await db.get("SELECT id FROM fee_items WHERE id = ? AND madrasa_id = ?", [feeItemId, tid]);
    if (!f) return err(res, 400, "Unknown fee item.");
  }
  const r = await db.run(
    "INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, reference, recorded_by) VALUES (?,?,?,?,?,?,?,?)",
    [tid, studentId, feeItemId, amount, day, cleanStr(b.method, 40) || "cash", cleanStr(b.reference, 120), req.user.id]
  );
  logActivity(db, { madrasaId: tid, userId: req.user.id, action: "fee_payment.record", entity: "fee_payment", entityId: String(r.lastInsertRowid), meta: { amount }, ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

router.delete("/payments/:id", requireRole("madrasa_admin"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const p = await db.get("SELECT * FROM fee_payments WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), tid]);
  if (!p) return res.status(404).json({ error: "Payment not found." });
  await db.run("DELETE FROM fee_payments WHERE id = ?", [p.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ balance -------------------------------- */

/** Per-student balance for a term: billed (items for the term) vs paid. */
router.get("/balance", asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res);
  if (tid == null) return;
  const termId = toNum(req.query.termId, 0);
  if (!termId) return err(res, 400, "termId is required.");
  const t = await db.get("SELECT * FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]);
  if (!t) return res.status(404).json({ error: "Term not found." });
  const items = await db.all("SELECT * FROM fee_items WHERE madrasa_id = ? AND term_id = ?", [tid, termId]);
  const billed = items.reduce((s, i) => s + Number(i.amount_ngn), 0);
  const students = await db.all(
    "SELECT id, admission_no, first_name, last_name FROM students WHERE madrasa_id = ? AND status IN ('active','promoted','suspended') ORDER BY admission_no",
    [tid]
  );
  // Only payments attached to an item in THIS term count towards this
  // term’s balance. A payment from a prior term must not make a current-term
  // invoice look settled.
  const paidRows = await db.all(
    `SELECT fp.student_id, SUM(fp.amount_ngn) AS paid
       FROM fee_payments fp
       JOIN fee_items fi ON fi.id = fp.fee_item_id AND fi.madrasa_id = fp.madrasa_id
      WHERE fp.madrasa_id = ? AND fi.term_id = ?
      GROUP BY fp.student_id`,
    [tid, termId]
  );
  const paidMap = new Map(paidRows.map((r) => [r.student_id, Number(r.paid)]));
  const out = students.map((s) => {
    const paid = paidMap.get(s.id) || 0;
    return Object.assign({}, s, { billed, paid, balance: Math.max(0, billed - paid), settled: paid >= billed && billed > 0 });
  });
  ok(res, { students: out, termId, billed });
}));

module.exports = router;
