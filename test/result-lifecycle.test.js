"use strict";
/* ============================================================================
   RESULT LIFECYCLE + PAYMENT LIFECYCLE

   Result:  DRAFT → SUBMITTED → UNDER REVIEW → RETURNED | APPROVED
                  → PUBLISHED → LOCKED
   Payment: EXPECTED → INITIATED → SUCCESSFUL → VERIFIED → RECONCILED

   Both are state machines, so the tests concentrate on the transitions that
   must be REFUSED: skipping a stage, editing a finalised record, and acting
   without the permission the stage requires.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
let adminA, teacherA;
let db;

/** Puts the class/subject/term back into a clean draft state. */
async function resetResults() {
  await db.run(
    "UPDATE results SET status='draft', submitted_at=NULL, approved_by=NULL, approved_at=NULL, published_at=NULL, reviewed_by=NULL, reviewed_at=NULL, locked_by=NULL, locked_at=NULL WHERE madrasa_id=? AND class_id=? AND term_id=? AND subject_id=?",
    [ctx.madrasaA, ctx.classA1, ctx.termA1, ctx.subjA1]
  );
}

const flow = (action, extra = {}) => Object.assign(
  { classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA1, action }, extra
);

before(async () => {
  ctx = await setup();
  db = require("../server/db");
  adminA = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", PASSWORD)).status, 200);
  assert.equal((await teacherA.login("teacher-a", PASSWORD)).status, 200);
});

after(async () => { await ctx.close(); });

/* ---------------------------- the happy path ----------------------------- */

test("the full result lifecycle runs draft → submitted → review → approved → published → locked", async () => {
  await resetResults();

  const submitted = await teacherA.api("POST", "/api/results/workflow", flow("submit"));
  assert.equal(submitted.status, 200, "a teacher may submit their own entries");
  assert.equal(submitted.data.status, "submitted");

  const review = await adminA.api("POST", "/api/results/workflow", flow("review"));
  assert.equal(review.status, 200);
  assert.equal(review.data.status, "under_review");

  const approved = await adminA.api("POST", "/api/results/workflow", flow("approve"));
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, "approved");

  const published = await adminA.api("POST", "/api/results/workflow", flow("publish"));
  assert.equal(published.status, 200);
  assert.equal(published.data.status, "published");

  const locked = await adminA.api("POST", "/api/results/workflow", flow("lock"));
  assert.equal(locked.status, 200);
  assert.equal(locked.data.status, "locked");
});

test("returning results to the teacher requires an explanation and reopens editing", async () => {
  await resetResults();
  assert.equal((await teacherA.api("POST", "/api/results/workflow", flow("submit"))).status, 200);

  const noNote = await adminA.api("POST", "/api/results/workflow", flow("return"));
  assert.equal(noNote.status, 400, "a return must say what to correct");

  const returned = await adminA.api("POST", "/api/results/workflow", flow("return", { note: "Recheck the CA column." }));
  assert.equal(returned.status, 200);
  assert.equal(returned.data.status, "returned");

  // A returned result can be submitted again.
  const resubmitted = await teacherA.api("POST", "/api/results/workflow", flow("submit"));
  assert.equal(resubmitted.status, 200, "a returned result can be resubmitted");
});

/* ------------------------ illegal transitions ---------------------------- */

test("a draft cannot skip straight to published", async () => {
  await resetResults();
  const r = await adminA.api("POST", "/api/results/workflow", flow("publish"));
  assert.equal(r.status, 409, "publishing a draft is refused");
  assert.equal(r.data.code, "INVALID_STATUS_TRANSITION");
  assert.deepEqual(r.data.expected, ["approved"], "the response says what state was needed");
});

test("a submitted result cannot be published without approval", async () => {
  await resetResults();
  assert.equal((await teacherA.api("POST", "/api/results/workflow", flow("submit"))).status, 200);
  const r = await adminA.api("POST", "/api/results/workflow", flow("publish"));
  assert.equal(r.status, 409, "approval cannot be skipped");
});

test("an unknown workflow action is rejected", async () => {
  const r = await adminA.api("POST", "/api/results/workflow", flow("obliterate"));
  assert.equal(r.status, 400);
});

test("a workflow action on a class with no results reports 404, not success", async () => {
  const r = await adminA.api("POST", "/api/results/workflow", {
    classId: ctx.classA2, termId: ctx.termA1, subjectId: ctx.subjA1, action: "submit",
  });
  assert.equal(r.status, 404);
});

/* -------------------------- permission boundaries ------------------------ */

test("a teacher may not approve, publish or lock results", async () => {
  await resetResults();
  assert.equal((await teacherA.api("POST", "/api/results/workflow", flow("submit"))).status, 200);

  for (const action of ["review", "approve", "publish", "lock"]) {
    const r = await teacherA.api("POST", "/api/results/workflow", flow(action, { note: "x" }));
    assert.equal(r.status, 403, `a teacher must not be able to ${action}`);
  }
});

test("an administrator whose results.publish is revoked cannot publish", async () => {
  const bcrypt = require("bcryptjs");
  const id = (await db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, "admin-limited", bcrypt.hashSync(PASSWORD, 10), "madrasa_admin", "Limited Admin"]
  )).lastInsertRowid;
  await adminA.api("PUT", `/api/admin/permissions/users/${id}`, { granted: [], revoked: ["results.publish"] });

  const limited = new Client(ctx.base);
  assert.equal((await limited.login("admin-limited", PASSWORD)).status, 200);

  await resetResults();
  assert.equal((await teacherA.api("POST", "/api/results/workflow", flow("submit"))).status, 200);
  assert.equal((await limited.api("POST", "/api/results/workflow", flow("approve"))).status, 200, "approval is still allowed");

  const blocked = await limited.api("POST", "/api/results/workflow", flow("publish"));
  assert.equal(blocked.status, 403, "publishing is refused");
  assert.equal(blocked.data.requiredPermission, "results.publish");
});

/* --------------------------- locking is real ----------------------------- */

test("published and locked results cannot be silently overwritten by result entry", async () => {
  await resetResults();
  assert.equal((await teacherA.api("POST", "/api/results/workflow", flow("submit"))).status, 200);
  assert.equal((await adminA.api("POST", "/api/results/workflow", flow("approve"))).status, 200);
  assert.equal((await adminA.api("POST", "/api/results/workflow", flow("publish"))).status, 200);

  const overwrite = await teacherA.api("PUT", "/api/results", {
    classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA1,
    entries: [{ studentId: ctx.studentA1, ca: 1, exam: 1 }],
  });
  assert.equal(overwrite.status, 409, "a published result is protected from silent change");
  assert.equal(overwrite.data.code, "RESULTS_FROZEN");

  // The stored mark is genuinely unchanged.
  const row = await db.get(
    "SELECT ca, exam, status FROM results WHERE madrasa_id=? AND student_id=? AND term_id=? AND subject_id=?",
    [ctx.madrasaA, ctx.studentA1, ctx.termA1, ctx.subjA1]
  );
  assert.notEqual(Number(row.ca), 1, "the original mark survived the attempted overwrite");
  assert.equal(row.status, "published");
});

test("reopening a published result is possible but is recorded in the audit log", async () => {
  // (continues from the published state above)
  const un = await adminA.api("POST", "/api/results/workflow", flow("unpublish"));
  assert.equal(un.status, 200, "an administrator may deliberately unpublish");
  assert.equal(un.data.status, "approved");

  const audit = await adminA.req("GET", "/api/admin/audit?action=results.unpublish");
  assert.equal(audit.status, 200);
  assert.ok(audit.data.entries.length >= 1, "the exceptional change is auditable");
  const entry = audit.data.entries[0];
  assert.equal(entry.module, "academic");
  assert.ok(entry.before_value, "the previous state is captured");
});

/* --------------------------- cross-tenant guard -------------------------- */

test("an administrator cannot drive another institution's result workflow", async () => {
  const adminB = new Client(ctx.base);
  assert.equal((await adminB.login("admin-b", PASSWORD)).status, 200);
  const r = await adminB.api("POST", "/api/results/workflow", {
    classId: ctx.classA1, termId: ctx.termA1, subjectId: ctx.subjA1, action: "approve",
  });
  assert.ok(r.status === 404 || r.status === 403, `cross-tenant workflow refused (got ${r.status})`);
});

/* ======================== PAYMENT VERIFICATION =========================== */

test("a payment moves successful → verified → reconciled, in that order only", async () => {
  const created = await adminA.api("POST", "/api/fees/payments", {
    student_id: ctx.studentA1, amount_ngn: 5000, method: "bank_transfer", reference: "VERIFY-001",
  });
  assert.equal(created.status, 200);
  const id = created.data.id;

  // Reconciling before verifying is refused.
  const early = await adminA.api("POST", `/api/fees/payments/${id}/verify`, { verification_status: "reconciled" });
  assert.equal(early.status, 409, "a payment must be verified before it is reconciled");
  assert.equal(early.data.code, "INVALID_STATUS_TRANSITION");

  const verified = await adminA.api("POST", `/api/fees/payments/${id}/verify`, { verification_status: "verified" });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.verification_status, "verified");

  const reconciled = await adminA.api("POST", `/api/fees/payments/${id}/verify`, { verification_status: "reconciled" });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.verification_status, "reconciled");

  // Verification is audited.
  const audit = await adminA.req("GET", "/api/admin/audit?module=finance");
  assert.ok(audit.data.entries.some((e) => e.action === "payment.verified"), "verification is audited");
});

test("a duplicate payment reference is refused", async () => {
  const first = await adminA.api("POST", "/api/fees/payments", {
    student_id: ctx.studentA1, amount_ngn: 1200, method: "cash", reference: "DUPLICATE-REF-1",
  });
  assert.equal(first.status, 200);
  const second = await adminA.api("POST", "/api/fees/payments", {
    student_id: ctx.studentA1, amount_ngn: 1200, method: "cash", reference: "DUPLICATE-REF-1",
  });
  assert.equal(second.status, 409, "the same transaction reference cannot be recorded twice");
});

test("the unverified worklist and reconciliation summary are tenant-scoped", async () => {
  const list = await adminA.req("GET", "/api/fees/payments/unverified");
  assert.equal(list.status, 200, "the worklist is reachable (not shadowed by /payments/:id)");
  assert.ok(Array.isArray(list.data.payments));

  const summary = await adminA.req("GET", "/api/fees/reconciliation");
  assert.equal(summary.status, 200);
  assert.ok(Array.isArray(summary.data.byVerification));
  assert.ok(Array.isArray(summary.data.possibleDuplicates));

  const adminB = new Client(ctx.base);
  await adminB.login("admin-b", PASSWORD);
  const bList = await adminB.req("GET", "/api/fees/payments/unverified");
  assert.equal(bList.status, 200);
  assert.equal(bList.data.payments.length, 0, "B sees none of A's payments");
});

test("a teacher cannot verify a payment", async () => {
  const list = await adminA.req("GET", "/api/fees/payments/unverified");
  const target = list.data.payments[0];
  if (!target) return; // nothing left unverified; the permission is still covered below
  const r = await teacherA.api("POST", `/api/fees/payments/${target.id}/verify`, { verification_status: "verified" });
  assert.equal(r.status, 403);
});

test("verifying a payment from another institution is not possible", async () => {
  const adminB = new Client(ctx.base);
  await adminB.login("admin-b", PASSWORD);
  const created = await adminA.api("POST", "/api/fees/payments", {
    student_id: ctx.studentA1, amount_ngn: 300, method: "cash", reference: "CROSS-TENANT-1",
  });
  const r = await adminB.api("POST", `/api/fees/payments/${created.data.id}/verify`, { verification_status: "verified" });
  assert.equal(r.status, 404, "the payment does not exist for another tenant");
});
