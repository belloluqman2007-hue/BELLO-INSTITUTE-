"use strict";
/* Complete tenant-scoped fee ledger. fee_items remains the fee-structure
 * catalogue; fee_assignments is the student ledger and fee_payments is the
 * immutable transaction history. */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, clampNum, validDate, logActivity } = require("../util");
const { requireAuth, requireTenant, requireRole } = require("../middleware/auth");
const { requirePermission } = require("../services/permissions");
const { effectiveTenantId } = require("../middleware/tenant");
const communication = require("../services/communication");
const audit = require("../services/audit");

const router = express.Router();
router.use(requireAuth, requireTenant);
const ADMIN = requireRole("madrasa_admin");
const STAFF = requireRole("madrasa_admin", "teacher");
const FINANCE_VIEW = requireRole("madrasa_admin", "teacher", "parent", "student");
const FEE_STATUSES = new Set(["active", "inactive", "archived"]);
const PAYMENT_STATUSES = new Set(["pending", "successful", "failed", "reversed", "refunded"]);
const PAYMENT_METHODS = new Set(["cash", "bank_transfer", "transfer", "card", "online", "pos", "other"]);

async function tenantId(req, res) {
  const tid = effectiveTenantId(req);
  if (!tid) { res.status(400).json({ error: "Madrasa context required." }); return null; }
  return tid;
}
function n(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function today() { return new Date().toISOString().slice(0, 10); }
function daysOverdue(date) { if (!date || date >= today()) return 0; return Math.max(0, Math.floor((Date.parse(today()) - Date.parse(String(date).slice(0, 10))) / 86400000)); }
function parseIds(v) { return Array.isArray(v) ? v.map((x) => toNum(x, 0)).filter(Boolean) : String(v || "").split(",").map((x) => toNum(x.trim(), 0)).filter(Boolean); }

async function assertTermClass(tid, termId, classId) {
  if (termId) { const row = await db.get("SELECT id, session_id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]); if (!row) return { error: "Unknown term." }; }
  if (classId) { const row = await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ?", [classId, tid]); if (!row) return { error: "Unknown class." }; }
  return {};
}
async function studentInTenant(tid, studentId) { return db.get("SELECT * FROM students WHERE id = ? AND madrasa_id = ?", [studentId, tid]); }
async function recipientsForStudent(tid, studentId) {
  const rows = await db.all("SELECT user_id FROM parent_links WHERE madrasa_id = ? AND student_id = ?", [tid, studentId]);
  const student = await db.get("SELECT id FROM users WHERE madrasa_id = ? AND student_id = ? AND is_active = 1", [tid, studentId]);
  return [...new Set(rows.map((r) => Number(r.user_id)).concat(student ? [Number(student.id)] : []))];
}
async function canSeeStudent(tid, req, studentId) {
  const student = await studentInTenant(tid, studentId); if (!student) return null;
  if (["madrasa_admin", "teacher"].includes(req.user.role)) return student;
  if (req.user.role === "student" && Number(req.user.studentId) === Number(studentId)) return student;
  if (req.user.role === "parent") {
    const link = await db.get("SELECT id FROM parent_links WHERE madrasa_id = ? AND user_id = ? AND student_id = ?", [tid, req.user.id, studentId]);
    if (link) return student;
  }
  return null;
}

/* --------------------------- fee structures ---------------------------- */
router.get("/items", STAFF, requirePermission("fees.view"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const where = ["f.madrasa_id = ?"]; const params = [tid];
  if (req.query.sessionId) { where.push("f.session_id = ?"); params.push(toNum(req.query.sessionId, 0)); }
  if (req.query.termId) { where.push("f.term_id = ?"); params.push(toNum(req.query.termId, 0)); }
  if (req.query.status) { where.push("f.status = ?"); params.push(cleanStr(req.query.status, 20)); }
  const rows = await db.all(`SELECT f.*, s.label AS session_label, t.name_en AS term_name, c.name_en AS class_name FROM fee_items f LEFT JOIN academic_sessions s ON s.id=f.session_id AND s.madrasa_id=f.madrasa_id LEFT JOIN terms t ON t.id=f.term_id AND t.madrasa_id=f.madrasa_id LEFT JOIN classes c ON c.id=f.class_id AND c.madrasa_id=f.madrasa_id WHERE ${where.join(" AND ")} ORDER BY f.id DESC`, params);
  ok(res, { items: rows });
}));
router.post("/items", requirePermission("fees.create"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const b = req.body || {}; const name = cleanStr(b.name_en || b.name || b.fee_name, 160);
  if (!name) return err(res, 400, "Fee name is required.");
  const termId = b.term_id ? toNum(b.term_id, 0) : null; const classId = b.class_id ? toNum(b.class_id, 0) : null;
  const check = await assertTermClass(tid, termId, classId); if (check.error) return err(res, 400, check.error);
  let sessionId = b.session_id ? toNum(b.session_id, 0) : null;
  if (termId && !sessionId) { const term = await db.get("SELECT session_id FROM terms WHERE id = ? AND madrasa_id = ?", [termId, tid]); sessionId = term && term.session_id; }
  if (sessionId && !(await db.get("SELECT id FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [sessionId, tid]))) return err(res, 400, "Unknown academic session.");
  const due = b.due_date ? validDate(b.due_date) : null; if (b.due_date && !due) return err(res, 400, "due_date must be YYYY-MM-DD.");
  const r = await db.run(
    `INSERT INTO fee_items (madrasa_id,term_id,name_en,name_ar,amount_ngn,session_id,class_id,program,education_track,student_category,description,due_date,is_required,status,created_by,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [tid, termId, name, cleanStr(b.name_ar, 160), clampNum(b.amount_ngn ?? b.amount, 0, 999999999, 0), sessionId, classId, cleanStr(b.program, 120), cleanStr(b.education_track, 20) || "both", cleanStr(b.student_category, 60), cleanStr(b.description, 5000), due, b.is_required === false || b.is_required === "0" ? 0 : 1, FEE_STATUSES.has(String(b.status)) ? String(b.status) : "active", req.user.id]
  );
  const id = Number(r.lastInsertRowid);
  if (b.assign_now || b.assign_to_students || b.student_ids || b.assign_class_id) await assignFee(tid, id, b, req.user.id);
  await logActivity(db, { madrasaId: tid, userId: req.user.id, action: "fee_structure.create", entity: "fee_item", entityId: String(id), ip: req.ip });
  ok(res, { ok: true, id });
}));
async function assignFee(tid, feeId, body, userId) {
  const fee = await db.get("SELECT * FROM fee_items WHERE id = ? AND madrasa_id = ?", [feeId, tid]); if (!fee) throw new Error("Fee item not found.");
  let studentIds = parseIds(body.student_ids || body.assign_to_students);
  const classId = toNum(body.assign_class_id || body.class_id, 0);
  if (!studentIds.length) { const rows = await db.all("SELECT id FROM students WHERE madrasa_id = ? AND status IN ('active','promoted','suspended')" + (classId ? " AND class_id = ?" : ""), classId ? [tid, classId] : [tid]); studentIds = rows.map((r) => Number(r.id)); }
  for (const studentId of studentIds) {
    const student = await studentInTenant(tid, studentId); if (!student) continue;
    // Upsert on the (madrasa_id, fee_item_id, student_id) unique key. Chosen by
    // dialect rather than by catching a syntax error, so a genuine failure is
    // never swallowed and the MySQL path does not depend on error-message text.
    const assignParams = [tid, feeId, studentId, clampNum(body.amount_due ?? fee.amount_ngn, 0, 999999999, n(fee.amount_ngn)), validDate(body.due_date) || fee.due_date, "due", userId];
    const assignSql = (await db.dialect()) === "mysql"
      ? `INSERT INTO fee_assignments (madrasa_id,fee_item_id,student_id,amount_due,due_date,status,assigned_by,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE amount_due=VALUES(amount_due),due_date=VALUES(due_date),status=VALUES(status),updated_at=CURRENT_TIMESTAMP`
      : `INSERT INTO fee_assignments (madrasa_id,fee_item_id,student_id,amount_due,due_date,status,assigned_by,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT (madrasa_id,fee_item_id,student_id) DO UPDATE SET amount_due=excluded.amount_due,due_date=excluded.due_date,status=excluded.status,updated_at=CURRENT_TIMESTAMP`;
    await db.run(assignSql, assignParams);
    const recipients = await recipientsForStudent(tid, studentId);
    await communication.createNotifications(tid, recipients, { type: "fee_assigned", title: "New fee assigned", body: `${fee.name_en}: ${n(fee.amount_ngn).toLocaleString()} is due${fee.due_date ? ` by ${fee.due_date}` : ""}.`, entity_type: "fee_item", entity_id: feeId });
  }
  return studentIds;
}
router.post("/items/:id/assign", requirePermission("fees.create"), asyncHandler(async (req, res) => { const tid = await tenantId(req,res); if(tid==null)return; const fee=await db.get("SELECT id FROM fee_items WHERE id=? AND madrasa_id=?",[toNum(req.params.id,0),tid]); if(!fee)return res.status(404).json({error:"Fee structure not found."}); const studentIds=await assignFee(tid,fee.id,req.body||{},req.user.id); ok(res,{ok:true,studentIds}); }));
router.patch("/items/:id", requirePermission("fees.create"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req,res); if(tid==null)return; const id=toNum(req.params.id,0); const item=await db.get("SELECT * FROM fee_items WHERE id=? AND madrasa_id=?",[id,tid]); if(!item)return res.status(404).json({error:"Fee item not found."}); const b=req.body||{}; const sets=[];const vals=[];
  const fields={name_en:["name_en",160],name_ar:["name_ar",160],program:["program",120],education_track:["education_track",20],student_category:["student_category",60],description:["description",5000]}; for(const [key,[col,max]] of Object.entries(fields))if(b[key]!==undefined){sets.push(`${col}=?`);vals.push(cleanStr(b[key],max));}
  if(b.amount_ngn!==undefined||b.amount!==undefined){sets.push("amount_ngn=?");vals.push(clampNum(b.amount_ngn??b.amount,0,999999999,0));} for(const key of ["session_id","term_id","class_id"]){if(b[key]!==undefined){const v=b[key]?toNum(b[key],0):null; const check=await assertTermClass(tid,key==="term_id"?v:null,key==="class_id"?v:null);if(check.error)return err(res,400,check.error);sets.push(`${key}=?`);vals.push(v);}} if(b.due_date!==undefined){const d=b.due_date?validDate(b.due_date):null;if(b.due_date&&!d)return err(res,400,"due_date must be YYYY-MM-DD.");sets.push("due_date=?");vals.push(d);} if(b.is_required!==undefined){sets.push("is_required=?");vals.push(b.is_required?1:0);} if(b.status!==undefined){const s=cleanStr(b.status,20);if(!FEE_STATUSES.has(s))return err(res,400,"Invalid fee status.");sets.push("status=?");vals.push(s);} if(!sets.length)return err(res,400,"Nothing to update."); vals.push(id,tid); await db.run(`UPDATE fee_items SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND madrasa_id=?`,vals); ok(res,{ok:true});
}));
router.delete("/items/:id", requirePermission("fees.create"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const id=toNum(req.params.id,0);const r=await db.run("UPDATE fee_items SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND madrasa_id=?",[id,tid]);if(!r.changes)return res.status(404).json({error:"Fee item not found."});ok(res,{ok:true,archived:true});}));

/* ----------------------------- payments -------------------------------- */
router.get("/payments", requirePermission("payments.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const where=["fp.madrasa_id=?"];const params=[tid];if(req.query.status){where.push("fp.status=?");params.push(cleanStr(req.query.status,20));}if(req.query.studentId){where.push("fp.student_id=?");params.push(toNum(req.query.studentId,0));}if(req.query.from){where.push("fp.payment_date>=?");params.push(validDate(req.query.from)||"");}if(req.query.to){where.push("fp.payment_date<=?");params.push(validDate(req.query.to)||"");}const rows=await db.all(`SELECT fp.*,fi.name_en AS item_en,s.admission_no,s.first_name,s.last_name,c.name_en AS class_name,u.full_name AS recorded_by_name FROM fee_payments fp JOIN students s ON s.id=fp.student_id AND s.madrasa_id=fp.madrasa_id LEFT JOIN fee_items fi ON fi.id=fp.fee_item_id AND fi.madrasa_id=fp.madrasa_id LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id LEFT JOIN users u ON u.id=fp.recorded_by AND u.madrasa_id=fp.madrasa_id WHERE ${where.join(" AND ")} ORDER BY fp.payment_date DESC,fp.id DESC LIMIT 1000`,params);ok(res,{payments:rows});}));
router.post("/payments", requirePermission("payments.create"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const b=req.body||{};const studentId=toNum(b.student_id,0);const student=await studentInTenant(tid,studentId);if(!student)return res.status(404).json({error:"Student not found."});const amount=clampNum(b.amount_ngn??b.amount,0,999999999,0);const day=validDate(b.payment_date)||today();if(amount<=0)return err(res,400,"A positive amount is required.");const status=PAYMENT_STATUSES.has(cleanStr(b.status,20))?cleanStr(b.status,20):"successful";const method=PAYMENT_METHODS.has(cleanStr(b.method,40))?cleanStr(b.method,40):"other";const reference=cleanStr(b.transaction_number||b.reference,160);if(reference){const duplicate=await db.get("SELECT id FROM fee_payments WHERE madrasa_id=? AND (reference=? OR transaction_number=?)",[tid,reference,reference]);if(duplicate)return res.status(409).json({error:"A payment with this transaction/reference number already exists."});}const feeItemId=b.fee_item_id?toNum(b.fee_item_id,0):null;let fee=null;if(feeItemId){fee=await db.get("SELECT * FROM fee_items WHERE id=? AND madrasa_id=?",[feeItemId,tid]);if(!fee)return err(res,400,"Unknown fee structure.");}const parent=await db.get("SELECT user_id FROM parent_links WHERE madrasa_id=? AND student_id=? ORDER BY id LIMIT 1",[tid,studentId]);let sessionId=b.session_id?toNum(b.session_id,0):fee&&fee.session_id||null;let termId=b.term_id?toNum(b.term_id,0):fee&&fee.term_id||null;const r=await db.run(`INSERT INTO fee_payments (madrasa_id,student_id,parent_user_id,fee_item_id,fee_assignment_id,amount_ngn,payment_date,session_id,term_id,method,reference,transaction_number,recorded_by,status,notes,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,[tid,studentId,parent&&parent.user_id||null,feeItemId,b.fee_assignment_id?toNum(b.fee_assignment_id,0):null,amount,day,sessionId,termId,method,reference,reference,req.user.id,status,cleanStr(b.notes,2000)]);const id=Number(r.lastInsertRowid);const receipt=`REC-${tid}-${String(id).padStart(6,"0")}`;await db.run("UPDATE fee_payments SET receipt_number=? WHERE id=? AND madrasa_id=?",[receipt,id,tid]);if(status==="successful"){const recipients=await recipientsForStudent(tid,studentId);await communication.createNotifications(tid,recipients,{type:"payment_received",title:"Payment confirmation",body:`Payment of ${amount.toLocaleString()} was recorded for ${student.first_name} ${student.last_name}. Receipt ${receipt}.`,entity_type:"payment",entity_id:id});for(const recipientId of recipients)await communication.recordCommunication(tid,{student_id:studentId,recipient_user_id:recipientId,parent_user_id:recipientId===Number(parent&&parent.user_id)?recipientId:null,channel:"in_app",message_type:"payment_confirmation",subject:"Payment confirmation",message:`Payment of ${amount.toLocaleString()} recorded. Receipt ${receipt}.`,sent_by:req.user.id});}await logActivity(db,{madrasaId:tid,userId:req.user.id,action:"fee_payment.record",entity:"fee_payment",entityId:String(id),meta:{amount,status},ip:req.ip});ok(res,{ok:true,id,receipt_number:receipt,status});}));
/** Payments still awaiting verification — the reconciliation worklist. */
router.get("/payments/unverified", requirePermission("payments.verify"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const rows = await db.all(
    `SELECT fp.id, fp.amount_ngn, fp.payment_date, fp.method, fp.reference, fp.transaction_number,
            fp.receipt_number, fp.status, fp.verification_status,
            s.admission_no, s.first_name, s.last_name
       FROM fee_payments fp
       JOIN students s ON s.id = fp.student_id AND s.madrasa_id = fp.madrasa_id
      WHERE fp.madrasa_id = ? AND fp.status = 'successful' AND fp.verification_status = 'unverified'
      ORDER BY fp.payment_date DESC, fp.id DESC LIMIT 500`,
    [tid]
  );
  ok(res, { payments: rows, total: rows.length });
}));

router.get("/payments/:id", STAFF, requirePermission("payments.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const p=await db.get("SELECT fp.*,fi.name_en AS item_en,s.admission_no,s.first_name,s.last_name,c.name_en AS class_name FROM fee_payments fp JOIN students s ON s.id=fp.student_id AND s.madrasa_id=fp.madrasa_id LEFT JOIN fee_items fi ON fi.id=fp.fee_item_id AND fi.madrasa_id=fp.madrasa_id LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id WHERE fp.id=? AND fp.madrasa_id=?",[toNum(req.params.id,0),tid]);if(!p)return res.status(404).json({error:"Payment not found."});ok(res,{payment:p});}));
router.get("/payments/:id/receipt", STAFF, requirePermission("payments.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const p=await db.get("SELECT fp.*,fi.name_en AS item_en,s.admission_no,s.first_name,s.last_name,m.name_en AS institution_name FROM fee_payments fp JOIN students s ON s.id=fp.student_id AND s.madrasa_id=fp.madrasa_id JOIN madaris m ON m.id=fp.madrasa_id LEFT JOIN fee_items fi ON fi.id=fp.fee_item_id AND fi.madrasa_id=fp.madrasa_id WHERE fp.id=? AND fp.madrasa_id=?",[toNum(req.params.id,0),tid]);if(!p)return res.status(404).send("Receipt not found");const esc=(x)=>String(x??"").replace(/[&<>\"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#39;"}[c]));res.type("html").send(`<!doctype html><title>Receipt ${esc(p.receipt_number)}</title><style>body{font:16px Arial;max-width:720px;margin:40px auto}h1{color:#220b40}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:10px 0}</style><h1>${esc(p.institution_name)}</h1><h2>Payment receipt</h2><div class=row><b>Receipt</b><span>${esc(p.receipt_number)}</span></div><div class=row><b>Student</b><span>${esc(p.first_name)} ${esc(p.last_name)} (${esc(p.admission_no)})</span></div><div class=row><b>Fee</b><span>${esc(p.item_en||"General payment")}</span></div><div class=row><b>Amount</b><span>₦${esc(n(p.amount_ngn).toLocaleString())}</span></div><div class=row><b>Date</b><span>${esc(p.payment_date)}</span></div><div class=row><b>Method</b><span>${esc(p.method)}</span></div><script>window.print()</script>`); }));
router.delete("/payments/:id", requirePermission("payments.create"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const r=await db.run("UPDATE fee_payments SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND madrasa_id=? AND status NOT IN ('refunded','reversed')",[toNum(req.params.id,0),tid]);if(!r.changes)return res.status(404).json({error:"Payment not found or already closed."});ok(res,{ok:true,reversed:true});}));

/* --------------------- verification & reconciliation ------------------- */
/*
   Payment lifecycle:
     EXPECTED → INITIATED → SUCCESSFUL → VERIFIED → RECONCILED

   `status` continues to track the transaction itself (pending / successful /
   failed / reversed / refunded); `verification_status` records the separate
   human/bank confirmation step, so a merely "successful" gateway callback is
   never mistaken for money that has been checked against the bank statement.
*/
const VERIFICATION_STATUSES = new Set(["unverified", "verified", "reconciled", "disputed"]);

/**
 * Moves a payment along the verification lifecycle.
 * Body: { verification_status: "verified" | "reconciled" | "disputed", note }
 *
 * Only a genuinely successful payment can be verified, and only a verified one
 * can be reconciled — the order cannot be skipped. Re-applying the same state
 * is a no-op rather than a duplicate audit entry.
 */
router.post("/payments/:id/verify", requirePermission("payments.verify"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const id = toNum(req.params.id, 0);
  const next = cleanStr((req.body || {}).verification_status, 20) || "verified";
  if (!VERIFICATION_STATUSES.has(next) || next === "unverified") {
    return err(res, 400, "verification_status must be verified, reconciled or disputed.");
  }
  const payment = await db.get("SELECT * FROM fee_payments WHERE id = ? AND madrasa_id = ?", [id, tid]);
  if (!payment) return err(res, 404, "Payment not found.");

  const current = payment.verification_status || "unverified";
  if (current === next) return ok(res, { ok: true, unchanged: true, verification_status: next });
  if (next !== "disputed" && payment.status !== "successful") {
    return err(res, 409, "Only a successful payment can be verified.", { code: "INVALID_STATUS_TRANSITION", current: payment.status });
  }
  if (next === "reconciled" && current !== "verified") {
    return err(res, 409, "Verify this payment before reconciling it.", { code: "INVALID_STATUS_TRANSITION", current });
  }

  await db.run(
    `UPDATE fee_payments
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
            reconciled_at = CASE WHEN ? = 'reconciled' THEN CURRENT_TIMESTAMP ELSE reconciled_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND madrasa_id = ?`,
    [next, req.user.id, next, id, tid]
  );
  await audit.record(req, {
    action: `payment.${next}`, module: "finance", entity: "fee_payment", entityId: id,
    before: { verification_status: current },
    after: { verification_status: next },
    meta: { amount: Number(payment.amount_ngn), note: cleanStr((req.body || {}).note, 500) || undefined },
  });
  ok(res, { ok: true, verification_status: next });
}));

/**
 * Reconciliation summary for a date window: what was recorded, what has been
 * verified, and what still has to be checked against the bank statement.
 * Every figure comes from this institution's own payment rows.
 */
router.get("/reconciliation", requirePermission("payments.verify"), asyncHandler(async (req, res) => {
  const tid = await tenantId(req, res); if (tid == null) return;
  const from = validDate(req.query.from) || "";
  const to = validDate(req.query.to) || "";
  const where = ["madrasa_id = ?"]; const params = [tid];
  if (from) { where.push("payment_date >= ?"); params.push(from); }
  if (to) { where.push("payment_date <= ?"); params.push(to); }
  const clause = where.join(" AND ");

  const [byVerification, byMethod, duplicates] = await Promise.all([
    db.all(`SELECT verification_status, COUNT(*) AS payments, COALESCE(SUM(amount_ngn),0) AS amount
              FROM fee_payments WHERE ${clause} AND status = 'successful'
             GROUP BY verification_status`, params),
    db.all(`SELECT method, COUNT(*) AS payments, COALESCE(SUM(amount_ngn),0) AS amount
              FROM fee_payments WHERE ${clause} AND status = 'successful'
             GROUP BY method ORDER BY amount DESC`, params),
    // Same student, same amount, same day, recorded more than once: the
    // classic double-entry that reconciliation exists to catch.
    db.all(`SELECT student_id, amount_ngn, payment_date, COUNT(*) AS occurrences
              FROM fee_payments WHERE ${clause} AND status = 'successful'
             GROUP BY student_id, amount_ngn, payment_date HAVING COUNT(*) > 1
             ORDER BY occurrences DESC LIMIT 100`, params),
  ]);
  ok(res, {
    from, to,
    byVerification: byVerification.map((r) => ({ status: r.verification_status || "unverified", payments: Number(r.payments), amount: n(r.amount) })),
    byMethod: byMethod.map((r) => ({ method: r.method, payments: Number(r.payments), amount: n(r.amount) })),
    possibleDuplicates: duplicates.map((r) => ({ studentId: r.student_id, amount: n(r.amount_ngn), date: r.payment_date, occurrences: Number(r.occurrences) })),
  });
}));

/* --------------------------- outstanding / records -------------------- */
async function buildBalances(tid, filters = {}) {
  const feeWhere=["f.madrasa_id=?","f.status='active'"]; const feeParams=[tid]; if(filters.sessionId){feeWhere.push("f.session_id=?");feeParams.push(toNum(filters.sessionId,0));}if(filters.termId){feeWhere.push("f.term_id=?");feeParams.push(toNum(filters.termId,0));}if(filters.classId){feeWhere.push("(f.class_id IS NULL OR f.class_id=?)");feeParams.push(toNum(filters.classId,0));}if(filters.program){feeWhere.push("f.program=?");feeParams.push(cleanStr(filters.program,120));}if(filters.educationTrack){feeWhere.push("f.education_track=?");feeParams.push(cleanStr(filters.educationTrack,20));}const fees=await db.all(`SELECT f.*,t.name_en AS term_name,s.label AS session_label FROM fee_items f LEFT JOIN terms t ON t.id=f.term_id AND t.madrasa_id=f.madrasa_id LEFT JOIN academic_sessions s ON s.id=f.session_id AND s.madrasa_id=f.madrasa_id WHERE ${feeWhere.join(" AND ")}`,feeParams);if(!fees.length)return[];const feeIds=fees.map((f)=>Number(f.id));const fm=feeIds.map(()=>"?").join(",");const assignments=await db.all(`SELECT * FROM fee_assignments WHERE madrasa_id=? AND fee_item_id IN (${fm})`,[tid].concat(feeIds));const assignedBy=new Map();for(const a of assignments){if(!assignedBy.has(a.student_id))assignedBy.set(a.student_id,[]);assignedBy.get(a.student_id).push(a);}let students=await db.all("SELECT s.*,c.name_en AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id WHERE s.madrasa_id=? AND s.status IN ('active','promoted','suspended')",[tid]);if(filters.studentId)students=students.filter((s)=>Number(s.id)===toNum(filters.studentId,0));
// Batched parent lookup (was one query per student — an N+1 that made this
// report run students.length queries). Same result: the FIRST parent link
// (lowest pl.id) per student wins. Chunked so huge tenants stay within
// placeholder limits on both SQLite and MySQL.
const parentsByStudent=new Map();
for(let i=0;i<students.length;i+=500){const chunk=students.slice(i,i+500).map((s)=>Number(s.id)).filter((x)=>x>0);if(!chunk.length)continue;const cm=chunk.map(()=>"?").join(",");const prows=await db.all(`SELECT pl.student_id,pl.id AS link_id,u.id,u.full_name,u.phone,u.email FROM parent_links pl JOIN users u ON u.id=pl.user_id AND u.madrasa_id=pl.madrasa_id WHERE pl.madrasa_id=? AND pl.student_id IN (${cm}) ORDER BY pl.id ASC`,[tid].concat(chunk));for(const p of prows){const sid=Number(p.student_id);if(!parentsByStudent.has(sid))parentsByStudent.set(sid,p);}}
const payments=await db.all(`SELECT fee_assignment_id,fee_item_id,student_id,SUM(amount_ngn) AS paid FROM fee_payments WHERE madrasa_id=? AND status='successful' AND fee_item_id IN (${fm}) GROUP BY fee_assignment_id,fee_item_id,student_id`,[tid].concat(feeIds));const paidMap=new Map(payments.map((p)=>[`${p.student_id}:${p.fee_assignment_id||"i"+p.fee_item_id}`,n(p.paid)]));const out=[];for(const student of students){const applicable=assignedBy.get(student.id)||fees.filter((f)=>!f.class_id||Number(f.class_id)===Number(student.class_id)).map((f)=>({fee_item_id:f.id,student_id:student.id,amount_due:f.amount_ngn,due_date:f.due_date,status:"due"}));if(!applicable.length)continue;let total=0,paid=0,dueDates=[];for(const a of applicable){total+=n(a.amount_due);paid+=paidMap.get(`${student.id}:${a.id||"i"+a.fee_item_id}`)||0;if(a.due_date)dueDates.push(String(a.due_date).slice(0,10));}const dueDate=dueDates.sort()[0]||null;const balance=Math.max(0,total-paid);const status=balance<=0?"Fully Paid":paid>0?"Partially Paid":daysOverdue(dueDate)>0?"Overdue":"Due";const parent=parentsByStudent.get(Number(student.id))||null;out.push({student_id:student.id,student:`${student.first_name} ${student.last_name}`.trim(),admission_no:student.admission_no,class_id:student.class_id,class_name:student.class_name,parent_user_id:parent&&parent.id||null,parent_name:parent&&parent.full_name||student.guardian_name||student.parent_name||"—",parent_phone:parent&&parent.phone||student.parent_phone||"",total_fees:total,amount_paid:paid,outstanding_balance:balance,billed:total,paid:paid,balance:balance,settled:balance<=0,due_date:dueDate,days_overdue:daysOverdue(dueDate),status,session_id:fees[0].session_id,term_id:fees[0].term_id});}return out;
}
router.get("/balance", STAFF, requirePermission("fees.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const rows=await buildBalances(tid,req.query);const billed=rows.length?rows[0].total_fees:0;ok(res,{students:rows,billed,billedTotal:rows.reduce((s,r)=>s+r.total_fees,0),totalOutstanding:rows.reduce((s,r)=>s+r.outstanding_balance,0)});}));
router.get("/outstanding", STAFF, requirePermission("fees.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const rows=await buildBalances(tid,req.query);ok(res,{outstanding:rows.filter((r)=>r.outstanding_balance>0),students:rows});}));
router.post("/outstanding/:studentId/remind", STAFF, requirePermission("fees.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const student=await studentInTenant(tid,toNum(req.params.studentId,0));if(!student)return res.status(404).json({error:"Student not found."});const balances=await buildBalances(tid,{studentId:student.id});const row=balances[0];if(!row||row.outstanding_balance<=0)return err(res,400,"This student has no outstanding balance.");const recipients=await recipientsForStudent(tid,student.id);const message=cleanStr(req.body&&req.body.message,2000)||`Outstanding fee reminder: ${row.outstanding_balance.toLocaleString()} remains due for ${student.first_name} ${student.last_name}.`;const notificationIds=await communication.createNotifications(tid,recipients,{type:"fee_reminder",title:"Outstanding fee reminder",body:message,entity_type:"student",entity_id:student.id});for(const recipientId of recipients)await communication.recordCommunication(tid,{student_id:student.id,recipient_user_id:recipientId,parent_user_id:recipientId,channel:cleanStr(req.body&&req.body.channel,20)||"in_app",message_type:"fee_reminder",subject:"Outstanding fee reminder",message,sent_by:req.user.id});ok(res,{ok:true,notificationIds,recipients:recipients.length});}));
router.get("/records", STAFF, requirePermission("fees.view"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const rows=await db.all("SELECT fp.*,fi.name_en AS fee_name,s.admission_no,s.first_name,s.last_name FROM fee_payments fp JOIN students s ON s.id=fp.student_id AND s.madrasa_id=fp.madrasa_id LEFT JOIN fee_items fi ON fi.id=fp.fee_item_id AND fi.madrasa_id=fp.madrasa_id WHERE fp.madrasa_id=? ORDER BY fp.payment_date DESC,fp.id DESC LIMIT 2000",[tid]);ok(res,{records:rows,feeRecords:rows});}));

/* ----------------------------- reporting -------------------------------- */
router.get("/reports", requirePermission("finance.reports"), asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const where=["p.madrasa_id=?"];const params=[tid];if(req.query.from){where.push("p.payment_date>=?");params.push(validDate(req.query.from)||"");}if(req.query.to){where.push("p.payment_date<=?");params.push(validDate(req.query.to)||"");}if(req.query.sessionId){where.push("p.session_id=?");params.push(toNum(req.query.sessionId,0));}if(req.query.termId){where.push("p.term_id=?");params.push(toNum(req.query.termId,0));}if(req.query.method){where.push("p.method=?");params.push(cleanStr(req.query.method,40));}if(req.query.status){where.push("p.status=?");params.push(cleanStr(req.query.status,20));}if(req.query.classId){where.push("s.class_id=?");params.push(toNum(req.query.classId,0));}if(req.query.studentId){where.push("p.student_id=?");params.push(toNum(req.query.studentId,0));}const rows=await db.all(`SELECT p.*,f.name_en AS fee_name,s.admission_no,s.first_name,s.last_name,c.name_en AS class_name FROM fee_payments p JOIN students s ON s.id=p.student_id AND s.madrasa_id=p.madrasa_id LEFT JOIN fee_items f ON f.id=p.fee_item_id AND f.madrasa_id=p.madrasa_id LEFT JOIN classes c ON c.id=s.class_id AND c.madrasa_id=s.madrasa_id WHERE ${where.join(" AND ")} ORDER BY p.payment_date,p.id`,params);const successful=rows.filter((r)=>r.status==="successful");const sum=successful.reduce((a,r)=>a+n(r.amount_ngn),0);const by=(key)=>Object.values(successful.reduce((o,r)=>{const k=r[key]||"Other";o[k]=(o[k]||0)+n(r.amount_ngn);return o},{})).map((value,i)=>({value}));const grouped=(key)=>{const m={};successful.forEach((r)=>{const k=r[key]||"Other";m[k]=(m[k]||0)+n(r.amount_ngn);});return Object.entries(m).map(([label,value])=>({label,value}));};const balances=await buildBalances(tid,req.query);ok(res,{summary:{totalFeesAssessed:balances.reduce((a,r)=>a+r.total_fees,0),totalAmountCollected:sum,outstandingFees:balances.reduce((a,r)=>a+r.outstanding_balance,0),overdueFees:balances.filter((r)=>r.status==="Overdue").reduce((a,r)=>a+r.outstanding_balance,0),paymentCount:successful.length},payments:rows,byDate:grouped("payment_date"),byClass:grouped("class_name"),byProgram:[],byEducationTrack:[],byFeeType:grouped("fee_name"),byPaymentMethod:grouped("method"),byStatus:grouped("status")});}));
router.get("/student/:id", FINANCE_VIEW, asyncHandler(async(req,res)=>{const tid=await tenantId(req,res);if(tid==null)return;const student=await canSeeStudent(tid,req,toNum(req.params.id,0));if(!student)return res.status(404).json({error:"Student finance record not found."});const fees=await buildBalances(tid,{studentId:student.id});const payments=await db.all("SELECT p.*,f.name_en AS fee_name FROM fee_payments p LEFT JOIN fee_items f ON f.id=p.fee_item_id AND f.madrasa_id=p.madrasa_id WHERE p.madrasa_id=? AND p.student_id=? ORDER BY p.payment_date DESC,p.id DESC",[tid,student.id]);ok(res,{student,assignedFees:fees,payments,receipts:payments.map((p)=>p.receipt_number).filter(Boolean),totalFees:fees.reduce((a,r)=>a+r.total_fees,0),amountPaid:fees.reduce((a,r)=>a+r.amount_paid,0),outstandingBalance:fees.reduce((a,r)=>a+r.outstanding_balance,0)});}));
/* Exposed so the communication bulk sender can resolve the "outstanding fees"
 * audience from the SAME balance calculation used by the finance screens. */
module.exports = router;
module.exports.buildBalances = buildBalances;
