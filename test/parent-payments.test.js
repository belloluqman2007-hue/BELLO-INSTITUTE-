"use strict";
/* ============================================================================
   PARENT ONLINE FEE PAYMENT TESTS
   ----------------------------------------------------------------------------
   The gateway itself (Paystack/Flutterwave) is external, so these tests pin
   the platform-side invariants:
     • only a linked parent (or the institution's own admin) may initiate
     • cross-tenant student ids are refused
     • the fee item and amount are validated server-side
     • payments are only marked successful by provider verification
       (webhook/callback), never by a client call
     • the status endpoint is scoped to the caller's children
     • the per-item breakdown the "pay online" modal uses is correct
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let feeItemA;
before(async () => {
  ctx = await setup();
  feeItemA = (await ctx.db.run(
    "INSERT INTO fee_items (madrasa_id, name_en, name_ar, amount_ngn, status) VALUES (?,?,?,?, 'active')",
    [ctx.madrasaA, "Term fees", "رسوم الفترة", 20000]
  )).lastInsertRowid;
});
after(async () => { await ctx.close(); });

async function linkedParent() {
  const parent = new Client(ctx.base);
  await parent.login("parent-a", PASSWORD);
  return parent;
}

test("a linked parent can initiate a payment (provider call fails safely offline)", async () => {
  const parent = await linkedParent();
  const r = await parent.api("POST", "/api/fees/payment/initiate", {
    student_id: ctx.studentA1, fee_item_id: Number(feeItemA), amount_ngn: 5000,
  });
  // No gateway is configured in tests, so the platform refuses with 503 —
  // the important part: the request was authorised, not rejected with 403.
  assert.equal(r.status, 503);
  assert.match(r.data.error, /not configured/i);
});

test("a parent cannot initiate a payment for a child they are not linked to", async () => {
  const parent = await linkedParent();
  const r = await parent.api("POST", "/api/fees/payment/initiate", {
    student_id: ctx.studentB1, fee_item_id: Number(feeItemA), amount_ngn: 1000,
  });
  assert.ok([403, 404].includes(r.status), "unlinked child must be refused, got " + r.status);
});

test("cross-tenant fee items and students are refused", async () => {
  // A fee item that belongs to madrasa B.
  const feeB = (await ctx.db.run(
    "INSERT INTO fee_items (madrasa_id, name_en, amount_ngn, status) VALUES (?,?,?, 'active')",
    [ctx.madrasaB, "Foreign fee", 1000]
  )).lastInsertRowid;
  const parent = await linkedParent();
  const r = await parent.api("POST", "/api/fees/payment/initiate", {
    student_id: ctx.studentA1, fee_item_id: Number(feeB), amount_ngn: 500,
  });
  assert.ok([400, 404].includes(r.status), "a foreign fee item must not be chargeable");
});

test("students and teachers cannot initiate online payments", async () => {
  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const r = await student.api("POST", "/api/fees/payment/initiate", {
    student_id: ctx.studentA1, fee_item_id: Number(feeItemA), amount_ngn: 100,
  });
  assert.equal(r.status, 403);
});

test("invalid amounts and missing fields are rejected", async () => {
  const parent = await linkedParent();
  for (const body of [
    {},
    { student_id: ctx.studentA1, fee_item_id: Number(feeItemA) },
    { student_id: ctx.studentA1, fee_item_id: Number(feeItemA), amount_ngn: 0 },
    { student_id: ctx.studentA1, fee_item_id: Number(feeItemA), amount_ngn: -50 },
  ]) {
    const r = await parent.api("POST", "/api/fees/payment/initiate", body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test("payments are only marked successful by provider verification — never by a client", async () => {
  // Simulate the provider-verified path exactly like mark() does: a payment
  // row created as pending by initiate…
  const row = (await ctx.db.run(
    `INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, reference, transaction_number, recorded_by, status)
     VALUES (?,?,?,?,CURRENT_DATE,'paystack',?,?,NULL,'pending')`,
    [ctx.madrasaA, ctx.studentA1, Number(feeItemA), 5000, "BELLO-TEST-1", "BELLO-TEST-1"]
  )).lastInsertRowid;

  // A parent (or anyone else) has NO endpoint that flips status to successful.
  const parent = await linkedParent();
  const attempts = [
    await parent.api("PATCH", `/api/fees/payments/${Number(row)}`, { status: "successful" }),
    await parent.api("PUT", `/api/fees/payments/${Number(row)}`, { status: "successful" }),
    await parent.api("POST", `/api/fees/payments/${Number(row)}/verify`, { status: "successful" }),
    await parent.api("POST", "/api/fees/payment/webhook", { event: "charge.success", data: { reference: "BELLO-TEST-1" } }),
  ];
  for (const r of attempts) {
    assert.ok([401, 403, 404].includes(r.status), "no client path to success, got " + r.status);
  }
  const still = await ctx.db.get("SELECT status FROM fee_payments WHERE id = ?", [Number(row)]);
  assert.equal(still.status, "pending", "the payment is untouched");

  // The webhook with an INVALID signature is refused (the body above had none).
  const unsigned = await new Client(ctx.base).req("POST", "/api/fees/payment/webhook", { event: "charge.success", data: { reference: "BELLO-TEST-1" } });
  assert.equal(unsigned.status, 401);
});

test("payment status is scoped to the caller's own children", async () => {
  const ref = "BELLO-TEST-STATUS-1";
  await ctx.db.run(
    `INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, reference, transaction_number, status)
     VALUES (?,?,?,?,CURRENT_DATE,'paystack',?,?, 'pending')`,
    [ctx.madrasaA, ctx.studentA2, Number(feeItemA), 3000, ref, ref]
  );
  // parent-a IS linked to studentA2 → visible.
  const parent = await linkedParent();
  const ok1 = await parent.req("GET", `/api/fees/payment/status/${ref}`);
  assert.equal(ok1.status, 200);
  assert.equal(ok1.data.payment.status, "pending");

  // A madrasa B parent is not → 404, no leakage.
  const bcrypt = require("bcryptjs");
  await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, "parent-b2", bcrypt.hashSync(PASSWORD, 10), "parent", "Guardian B2"]
  );
  const parentB = new Client(ctx.base);
  await parentB.login("parent-b2", PASSWORD);
  const denied = await parentB.req("GET", `/api/fees/payment/status/${ref}`);
  assert.equal(denied.status, 404);
});

test("the per-item breakdown for the pay-online modal is correct", async () => {
  await ctx.db.run(
    `INSERT INTO fee_payments (madrasa_id, student_id, fee_item_id, amount_ngn, payment_date, method, status)
     VALUES (?,?,?,?,CURRENT_DATE,'cash','successful')`,
    [ctx.madrasaA, ctx.studentA1, Number(feeItemA), 7500]
  );
  const parent = await linkedParent();
  const r = await parent.req("GET", `/api/fees/student/${ctx.studentA1}`);
  assert.equal(r.status, 200);
  const item = (r.data.feeItems || []).find((f) => f.id === Number(feeItemA));
  assert.ok(item, "the fee item appears in the breakdown");
  assert.equal(item.amount_due, 20000);
  assert.equal(item.amount_paid, 7500);
  assert.equal(item.outstanding, 12500);
  // A parent cannot pull the breakdown of somebody else's child.
  const foreign = await parent.req("GET", `/api/fees/student/${ctx.studentB1}`);
  assert.equal(foreign.status, 404);
});

test("the gateway callback redirects into the parent portal fees page", async () => {
  // The callback handler itself needs a live provider; assert the redirect
  // target contract by driving the handler with a missing reference (400)
  // and by checking the built URL string in the source…
  const c = new Client(ctx.base);
  const r = await c.req("GET", "/api/fees/payment/callback");
  assert.equal(r.status, 400);
  const fs = require("fs");
  const src = fs.readFileSync("server/routes/payment.js", "utf8");
  assert.ok(src.includes("location.href='/parent/#/parent/fees?payment="), "callback lands on the parent fees page");
});
