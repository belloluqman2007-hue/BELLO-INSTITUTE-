"use strict";
/* ============================================================================
   PAYROLL MODULE TESTS
   ----------------------------------------------------------------------------
   Covers the additive payroll ledger end-to-end through the real HTTP API:
     • salary structures CRUD + validation
     • pay periods (draft → processed → paid) + duplicate protection
     • bulk processing: gross/allowances/deductions/net math, advance
       instalments, idempotent re-processing (no double deduction)
     • single payslip generation, printable HTML (CSP-safe), CSV export
     • salary advances: issue, automatic monthly deduction, manual repayment
     • authentication (401), authorisation (teacher 403), and the core tenant
       isolation guarantee between madrasa A and madrasa B
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB, teacherA, anon;
const U = "Passw0rd!123";

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  anon = new Client(ctx.base);
  const r1 = await adminA.login("admin-a", U); assert.equal(r1.status, 200, "adminA login");
  const r2 = await adminB.login("admin-b", U); assert.equal(r2.status, 200, "adminB login");
  const r3 = await teacherA.login("teacher-a", U); assert.equal(r3.status, 200, "teacherA login");
});
after(async () => { await ctx.close(); });

/* --------------------------- salary structures --------------------------- */

test("admin creates a salary structure with allowances and deductions", async () => {
  const r = await adminA.api("POST", "/api/payroll/structures", {
    user_id: ctx.users.teacherA,
    grade: "Senior Teacher",
    base_ngn: 250000,
    allowances: { housing: 40000, transport: 15000, medical: 10000 },
    deductions: { tax: 20000, pension: 10000 },
    effective_from: "2026-09-01",
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.id > 0);

  const list = await adminA.req("GET", "/api/payroll/structures");
  assert.equal(list.status, 200);
  const structure = list.data.structures.find((s) => s.id === r.data.id);
  assert.ok(structure, "structure appears in the list");
  assert.equal(structure.full_name, "Teacher A");
  assert.equal(structure.grade, "Senior Teacher");
  assert.deepEqual(structure.allowances, { housing: 40000, transport: 15000, medical: 10000, other: 0 });
  assert.deepEqual(structure.deductions, { tax: 20000, pension: 10000, other: 0 });
  assert.equal(structure.allowance_total, 65000);
  assert.equal(structure.deduction_total, 30000);
});

test("structure validation rejects unknown teachers, other tenants and empty salaries", async () => {
  const badTeacher = await adminA.api("POST", "/api/payroll/structures", { user_id: 999999, base_ngn: 100 });
  assert.equal(badTeacher.status, 400);

  // Teacher belongs to madrasa B's user set? teacherA belongs to A — use B's admin trying A's teacher
  const cross = await adminB.api("POST", "/api/payroll/structures", { user_id: ctx.users.teacherA, base_ngn: 100 });
  assert.equal(cross.status, 400, "B's admin cannot create a structure for A's teacher");

  const adminAsTeacher = await adminA.api("POST", "/api/payroll/structures", { user_id: ctx.users.adminA, base_ngn: 100 });
  assert.equal(adminAsTeacher.status, 400, "only teacher-role users can hold a structure");

  const zero = await adminA.api("POST", "/api/payroll/structures", { user_id: ctx.users.teacherA, base_ngn: 0, allowances: {} });
  assert.equal(zero.status, 400);

  const badDate = await adminA.api("PATCH", `/api/payroll/structures/${(await adminA.req("GET", "/api/payroll/structures")).data.structures[0].id}`, { effective_from: "09/01/2026" });
  assert.equal(badDate.status, 400);
});

test("structure list stays tenant-scoped", async () => {
  const a = await adminA.req("GET", "/api/payroll/structures");
  const b = await adminB.req("GET", "/api/payroll/structures");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.structures.length, 1);
  assert.equal(b.data.structures.length, 0, "admin B sees no A structures");
});

/* -------------------------------- advances ------------------------------- */

test("admin issues a salary advance with a repayment schedule", async () => {
  const r = await adminA.api("POST", "/api/payroll/advances", {
    user_id: ctx.users.teacherA,
    amount: 120000,
    reason: "Rent support",
    repayment_months: 12,
  });
  assert.equal(r.status, 200);

  const list = await adminA.req("GET", "/api/payroll/advances");
  const advance = list.data.advances.find((a) => a.id === r.data.id);
  assert.ok(advance, "advance listed");
  assert.equal(advance.amount, 120000);
  assert.equal(advance.balance, 120000);
  assert.equal(advance.monthly_instalment, 10000);
  assert.equal(list.data.summary.outstanding, 120000);

  const bad = await adminA.api("POST", "/api/payroll/advances", { user_id: ctx.users.teacherA, amount: 0, repayment_months: 6 });
  assert.equal(bad.status, 400);
  const badMonths = await adminA.api("POST", "/api/payroll/advances", { user_id: ctx.users.teacherA, amount: 5000, repayment_months: 0 });
  assert.equal(badMonths.status, 400);
});

/* ------------------------------- pay periods ----------------------------- */

let periodId;

test("admin creates a monthly pay period tied to an academic session", async () => {
  const r = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 9, year: 2026 });
  assert.equal(r.status, 200);
  periodId = r.data.id;

  const list = await adminA.req("GET", "/api/payroll/periods");
  const period = list.data.periods.find((p) => p.id === periodId);
  assert.ok(period);
  assert.equal(period.status, "draft");
  assert.equal(period.label, "September 2026");
  assert.equal(period.session_label, "2026/2027");
});

test("period validation: duplicate month, bad session, bad month/year", async () => {
  const dup = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 9, year: 2026 });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /already exists/i);

  const badSession = await adminA.api("POST", "/api/payroll/periods", { session_id: 999999, month: 10, year: 2026 });
  assert.equal(badSession.status, 400);

  // B's session is not visible to A
  const sessionB = await ctx.db.get("SELECT id FROM academic_sessions WHERE madrasa_id = ?", [ctx.madrasaB]);
  const foreignSession = await adminA.api("POST", "/api/payroll/periods", { session_id: sessionB.id, month: 10, year: 2026 });
  assert.equal(foreignSession.status, 400, "A cannot open a period in B's session");

  const badMonth = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 13, year: 2026 });
  assert.equal(badMonth.status, 400);
  const badYear = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 10, year: 1850 });
  assert.equal(badYear.status, 400);
});

/* ------------------------------ bulk processing --------------------------- */

let slipId;

test("bulk processing computes payslips with correct math and advance instalment", async () => {
  const r = await adminA.api("POST", `/api/payroll/periods/${periodId}/process`);
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 1, "one salaried teacher processed");

  // gross = 250000 + 40000 + 15000 + 10000 = 315000
  // deductions = 20000 tax + 10000 pension + 10000 advance = 40000
  // net = 275000
  const slips = await adminA.req("GET", `/api/payroll/payslips?periodId=${periodId}`);
  assert.equal(slips.status, 200);
  assert.equal(slips.data.payslips.length, 1);
  const slip = slips.data.payslips[0];
  slipId = slip.id;
  assert.equal(slip.full_name, "Teacher A");
  assert.equal(slip.gross, 315000);
  assert.equal(slip.deductions.tax, 20000);
  assert.equal(slip.deductions.pension, 10000);
  assert.equal(slip.deductions.advance_total, 10000);
  assert.deepEqual(slip.deductions.advances.map((x) => x.amount), [10000]);
  assert.equal(slip.deductions.total, 40000);
  assert.equal(slip.net, 275000);
  assert.equal(slips.data.summary.totalNet, 275000);

  // The advance balance dropped by exactly one instalment.
  const advances = await adminA.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances[0].balance, 110000);

  // Period advanced to processed.
  const periods = await adminA.req("GET", "/api/payroll/periods");
  assert.equal(periods.data.periods.find((p) => p.id === periodId).status, "processed");
  assert.equal(periods.data.periods.find((p) => p.id === periodId).slip_count, 1);
});

test("re-processing is idempotent — no double advance deduction", async () => {
  const r = await adminA.api("POST", `/api/payroll/periods/${periodId}/process`);
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 1);

  const slips = await adminA.req("GET", `/api/payroll/payslips?periodId=${periodId}`);
  assert.equal(slips.data.payslips.length, 1, "still exactly one payslip");
  assert.equal(slips.data.payslips[0].net, 275000);

  const advances = await adminA.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances[0].balance, 110000, "balance still reduced by exactly one instalment");
});

test("single payslip generation upserts and a later month deducts again", async () => {
  // Delete the slip (restores the advance), then generate it singly.
  const del = await adminA.api("DELETE", `/api/payroll/payslips/${slipId}`);
  assert.equal(del.status, 200);
  let advances = await adminA.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances[0].balance, 120000, "deleting the slip restores the balance");

  const gen = await adminA.api("POST", "/api/payroll/payslips", { pay_period_id: periodId, user_id: ctx.users.teacherA });
  assert.equal(gen.status, 200);
  slipId = gen.data.id;
  advances = await adminA.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances[0].balance, 110000, "single generation applies the instalment");

  // Second month: another period, another instalment.
  const p2 = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 10, year: 2026 });
  assert.equal(p2.status, 200);
  const proc = await adminA.api("POST", `/api/payroll/periods/${p2.data.id}/process`);
  assert.equal(proc.status, 200);
  advances = await adminA.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances[0].balance, 100000, "second month deducts the second instalment");

  const slips = await adminA.req("GET", "/api/payroll/payslips?userId=" + ctx.users.teacherA);
  assert.equal(slips.data.payslips.length, 2);

  // Cleanup helper for later assertions: keep October's period id around.
  ctx.periodOctober = p2.data.id;
});

test("marking a period paid stamps payslips and locks them", async () => {
  const early = await adminA.api("POST", `/api/payroll/periods/${periodId}/pay`);
  assert.equal(early.status, 200);
  assert.equal(early.data.paid, 1);

  const detail = await adminA.req("GET", `/api/payroll/payslips/${slipId}`);
  assert.ok(detail.data.payslip.paid_at, "paid_at stamped");

  const reprocess = await adminA.api("POST", `/api/payroll/periods/${periodId}/process`);
  assert.equal(reprocess.status, 400, "paid period cannot be reprocessed");

  const del = await adminA.api("DELETE", `/api/payroll/payslips/${slipId}`);
  assert.equal(del.status, 400, "paid payslip cannot be deleted");

  const payAgain = await adminA.api("POST", `/api/payroll/periods/${periodId}/pay`);
  assert.equal(payAgain.status, 400, "cannot pay twice");

  const periods = await adminA.req("GET", "/api/payroll/periods?status=paid");
  assert.ok(periods.data.periods.some((p) => p.id === periodId));
});

test("unpaid period cannot be marked paid and empty periods report clearly", async () => {
  const p3 = await adminA.api("POST", "/api/payroll/periods", { session_id: ctx.sessionA, month: 11, year: 2026 });
  assert.equal(p3.status, 200);
  const pay = await adminA.api("POST", `/api/payroll/periods/${p3.data.id}/pay`);
  assert.equal(pay.status, 400, "draft period with no slips cannot be paid");
  const del = await adminA.api("DELETE", `/api/payroll/periods/${p3.data.id}`);
  assert.equal(del.status, 200, "empty draft period can be deleted");
});

/* --------------------------- printable payslip ---------------------------- */

test("printable payslip is server-rendered HTML without inline scripts (CSP-safe)", async () => {
  const r = await adminA.req("GET", `/api/payroll/payslips/${slipId}/print`);
  assert.equal(r.status, 200);
  const html = await r.res.text();
  assert.match(html, /Payslip/);
  assert.match(html, /Teacher A/);
  assert.match(html, /September 2026/);
  assert.match(html, /Basic salary/);
  assert.match(html, /Housing allowance/);
  assert.match(html, /Loan \/ advance repayment/);
  assert.match(html, /Net pay/);
  assert.doesNotMatch(html, /<script>(?![^<]*src=)/, "no inline script blocks");
  assert.match(html, /<script src="\/js\/print\.js"><\/script>/, "print helper is an external same-origin script");
  assert.doesNotMatch(html, /\son\w+=/, "no inline event handlers");
});

test("payslip print of another tenant is a 404", async () => {
  const r = await adminB.req("GET", `/api/payroll/payslips/${slipId}/print`);
  assert.equal(r.status, 404);
});

/* -------------------------------- CSV export ------------------------------ */

test("pay period CSV export follows the shared csv service format", async () => {
  const r = await adminA.req("GET", `/api/payroll/periods/${periodId}/export.csv`);
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get("content-type"), /text\/csv/);
  // fetch's res.text() strips the BOM, so assert it on the raw wire bytes.
  const bytes = new Uint8Array(await r.res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM on the wire");
  const text = Buffer.from(bytes).toString("utf8");
  assert.ok(text.includes("Staff Member,Username,Pay Period,Session,Gross"), "header row after the BOM");
  assert.match(text, /Teacher A/);
  assert.match(text, /September 2026/);
  assert.match(text, /,275000,/);
  assert.match(text, /,10000,/);

  const b = await adminB.req("GET", `/api/payroll/periods/${periodId}/export.csv`);
  assert.equal(b.status, 404, "B cannot export A's period");
});

/* ------------------------------ advances repay ----------------------------- */

test("manual repayment reduces the outstanding balance", async () => {
  const list = await adminA.req("GET", "/api/payroll/advances");
  const advance = list.data.advances[0];
  const r = await adminA.api("POST", `/api/payroll/advances/${advance.id}/repay`, { amount: 5000 });
  assert.equal(r.status, 200);
  assert.equal(r.data.applied, 5000);
  assert.equal(r.data.balance, 95000);

  const over = await adminA.api("POST", `/api/payroll/advances/${advance.id}/repay`, { amount: 999999999 });
  assert.equal(over.status, 200);
  assert.equal(over.data.applied, 95000, "repayment is capped at the balance");
  assert.equal(over.data.balance, 0);

  const again = await adminA.api("POST", `/api/payroll/advances/${advance.id}/repay`, { amount: 100 });
  assert.equal(again.status, 400, "settled advance rejects more repayment");

  const del = await adminA.api("DELETE", `/api/payroll/advances/${advance.id}`);
  assert.equal(del.status, 400, "advance with repayment history cannot be deleted");
});

/* ------------------------ auth + tenant isolation ------------------------- */

test("unauthenticated requests are rejected with 401", async () => {
  const r = await anon.req("GET", "/api/payroll/structures");
  assert.equal(r.status, 401);
  const r2 = await anon.api("POST", "/api/payroll/periods", { session_id: 1, month: 1, year: 2026 });
  assert.equal(r2.status, 401);
});

test("teachers (non-admins) are rejected with 403", async () => {
  const r = await teacherA.req("GET", "/api/payroll/payslips");
  assert.equal(r.status, 403);
  const r2 = await teacherA.api("POST", "/api/payroll/advances", { user_id: ctx.users.teacherA, amount: 100, repayment_months: 1 });
  assert.equal(r2.status, 403);
  const r3 = await teacherA.req("GET", `/api/payroll/payslips/${slipId}/print`);
  assert.equal(r3.status, 403);
});

test("admin B never sees or touches admin A's payroll data", async () => {
  const structures = await adminB.req("GET", "/api/payroll/structures");
  assert.equal(structures.data.structures.length, 0);
  const periods = await adminB.req("GET", "/api/payroll/periods");
  assert.equal(periods.data.periods.length, 0);
  const slips = await adminB.req("GET", "/api/payroll/payslips");
  assert.equal(slips.data.payslips.length, 0);
  const advances = await adminB.req("GET", "/api/payroll/advances");
  assert.equal(advances.data.advances.length, 0);

  // Cross-tenant writes/reads by id → 404 (existence not leaked)
  const structA = (await adminA.req("GET", "/api/payroll/structures")).data.structures[0];
  assert.equal((await adminB.api("PATCH", `/api/payroll/structures/${structA.id}`, { base_ngn: 1 })).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/payroll/structures/${structA.id}`)).status, 404);
  assert.equal((await adminB.api("POST", `/api/payroll/periods/${periodId}/process`)).status, 404);
  assert.equal((await adminB.api("POST", `/api/payroll/periods/${periodId}/pay`)).status, 404);
  assert.equal((await adminB.req("GET", `/api/payroll/payslips/${slipId}`)).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/payroll/payslips/${slipId}`)).status, 404);
  const advA = (await adminA.req("GET", "/api/payroll/advances")).data.advances[0];
  assert.equal((await adminB.api("POST", `/api/payroll/advances/${advA.id}/repay`, { amount: 1 })).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/payroll/advances/${advA.id}`)).status, 404);

  // Forged madrasa_id in the body is ignored — tenant comes from the session.
  const forged = await adminB.api("POST", "/api/payroll/periods", { madrasa_id: ctx.madrasaA, session_id: ctx.sessionA, month: 12, year: 2026 });
  assert.equal(forged.status, 400, "B cannot open a period using A's session even with a forged body");
  const bPeriods = await adminB.req("GET", "/api/payroll/periods");
  assert.equal(bPeriods.data.periods.length, 0, "nothing was created for B");
});

test("payroll actions are recorded in the tenant activity log", async () => {
  const r = await adminA.req("GET", "/api/activity?limit=200");
  const actions = r.data.activity.map((a) => a.action);
  assert.ok(actions.includes("payroll.structure.create"));
  assert.ok(actions.includes("payroll.advance.create"));
  assert.ok(actions.includes("payroll.period.create"));
  assert.ok(actions.includes("payroll.period.process"));
  assert.ok(actions.includes("payroll.period.pay"));
  assert.ok(actions.includes("payroll.payslip.generate"));
  assert.ok(actions.includes("payroll.payslip.delete"));
  assert.ok(actions.includes("payroll.advance.repay"));
  assert.ok(actions.includes("payroll.export"));
  // Every payroll log row is scoped to madrasa A.
  assert.ok(r.data.activity.filter((a) => String(a.action).startsWith("payroll.")).every((a) => Number(a.madrasa_id) === Number(ctx.madrasaA)));
});
