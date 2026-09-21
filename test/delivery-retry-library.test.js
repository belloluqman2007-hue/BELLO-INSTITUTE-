"use strict";
/* ============================================================================
   NOTIFICATION RETRY + LIBRARY LOAN RENEWAL + CATALOGUE FIELDS

   Two operationally boring but high-consequence features:

   * A failed SMS/email must be retryable *after* the office corrects the
     recipient's phone number — and the retry must pick the corrected number
     up, not re-send to the address that already failed. Retries are capped
     so a permanently-bad address cannot be hammered forever, and the history
     row is updated in place so `retry_count` stays honest (one row per
     message, not one row per attempt).

   * A borrower who needs a book longer should be able to renew rather than
     return-and-reissue, but a renewal must extend the due date, must not
     resurrect a closed loan, and must be capped.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx, adminA, adminB, teacherA;
let tenantA, studentUserId;

/** Forces a communication_history row into a known delivery state. */
async function seedMessage(fields = {}) {
  const row = {
    madrasa_id: tenantA,
    channel: "sms",
    recipient_user_id: null,
    recipient_address: "+2348000000000",
    subject: "Fees reminder",
    message: "Second term fees are due on Friday.",
    delivery_status: "failed",
    retry_count: 0,
    ...fields,
  };
  const r = await ctx.db.run(
    `INSERT INTO communication_history
       (madrasa_id, message_type, channel, recipient_user_id, recipient_address, subject, message,
        delivery_status, retry_count, error_message, created_at)
     VALUES (?,'notification',?,?,?,?,?,?,?,'Unreachable', CURRENT_TIMESTAMP)`,
    [row.madrasa_id, row.channel, row.recipient_user_id, row.recipient_address,
     row.subject, row.message, row.delivery_status, row.retry_count]
  );
  return r.lastInsertRowid || r.lastID || r.insertId;
}

const getMessage = (id) =>
  ctx.db.get("SELECT * FROM communication_history WHERE id = ?", [id]);

before(async () => {
  ctx = await setup();
  tenantA = ctx.madrasaA;
  studentUserId = (await ctx.db.get(
    "SELECT id FROM users WHERE madrasa_id = ? AND username = 'student-a1'", [tenantA])).id;
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", PASSWORD)).status, 200);
  assert.equal((await adminB.login("admin-b", PASSWORD)).status, 200);
  assert.equal((await teacherA.login("teacher-a", PASSWORD)).status, 200);
});

after(async () => { await ctx.close(); });

/* ---------------------------- notification retry -------------------------- */

test("a failed message can be retried and the attempt is counted on the same row", async () => {
  const id = await seedMessage();
  const r = await adminA.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.retry_count, 1, "the attempt is counted");

  const row = await getMessage(id);
  assert.equal(Number(row.retry_count), 1, "the count is persisted");
  // The point of updating in place: the log shows one message that was tried
  // twice, not two messages that were each tried once.
  const all = await ctx.db.all(
    "SELECT id FROM communication_history WHERE madrasa_id = ? AND subject = 'Fees reminder'",
    [tenantA]
  );
  assert.equal(all.length, 1, "a retry does not spawn a duplicate history row");
});

test("a retry re-resolves the address, so a corrected phone number is actually used", async () => {
  const userId = studentUserId;

  // The original send failed against a stale number still on the row.
  const id = await seedMessage({
    recipient_user_id: userId,
    recipient_address: "+2348000000001",
  });
  // The office corrects the record.
  await ctx.db.run("UPDATE users SET phone = ? WHERE id = ?", ["+2348099998888", userId]);

  const r = await adminA.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const row = await getMessage(id);
  assert.ok(
    String(row.recipient_address).includes("8099998888"),
    `the retry used the corrected number, got ${row.recipient_address}`
  );
});

test("only a failed message may be retried", async () => {
  const id = await seedMessage({ delivery_status: "sent" });
  const r = await adminA.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "INVALID_STATUS_TRANSITION");
  assert.equal(r.data.current, "sent", "the response names the state that blocked it");
});

test("retries are capped so a permanently bad address is not hammered forever", async () => {
  const id = await seedMessage({ retry_count: 3 });
  const r = await adminA.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "RETRY_LIMIT");
  assert.match(r.data.error || r.data.message || "", /contact details/i,
    "the operator is told what to do next, not just refused");
  assert.equal(Number((await getMessage(id)).retry_count), 3, "a refused retry does not count");
});

test("a teacher cannot retry deliveries", async () => {
  const id = await seedMessage();
  const r = await teacherA.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 403);
});

test("one institution cannot retry another institution's message", async () => {
  const id = await seedMessage();
  const r = await adminB.api("POST", `/api/communication/delivery/${id}/retry`);
  assert.equal(r.status, 404, "cross-tenant access is a 404, never a 403 that confirms existence");
  assert.equal(Number((await getMessage(id)).retry_count), 0, "the row is untouched");
});

test("the delivery log exposes the retry count and delivery time", async () => {
  const id = await seedMessage();
  await adminA.api("POST", `/api/communication/delivery/${id}/retry`);
  const r = await adminA.req("GET", "/api/communication/delivery/log");
  assert.equal(r.status, 200);
  const rows = r.data.entries || r.data.log || r.data.deliveries || [];
  assert.ok(rows.length >= 1, "the log returns rows");
  const found = rows.find((x) => Number(x.id) === Number(id));
  assert.ok(found, "the retried message appears in the log");
  assert.ok("retry_count" in found, "the operator can see how many attempts were made");
  assert.ok("delivered_at" in found, "and when it finally landed");
});

/* --------------------------- library loan renewal ------------------------- */

/** Issues a fresh loan and returns { loanId, bookId }. */
async function issueLoan() {
  const book = await adminA.api("POST", "/api/library/books", {
    title: `Tafsir Vol ${Math.random().toString(36).slice(2, 7)}`,
    author: "Ibn Kathir",
    total_copies: 3,
  });
  assert.equal(book.status, 200, JSON.stringify(book.data));
  const bookId = book.data.book ? book.data.book.id : book.data.id;

  const loan = await adminA.api("POST", "/api/library/loans", {
    book_id: bookId,
    borrower_user_id: studentUserId,
    borrower_type: "student",
  });
  assert.equal(loan.status, 200, JSON.stringify(loan.data));
  return { loanId: loan.data.loan ? loan.data.loan.id : loan.data.id, bookId };
}

test("an open loan can be renewed and the due date moves forward", async () => {
  const { loanId } = await issueLoan();
  const before = await ctx.db.get("SELECT due_date FROM library_loans WHERE id = ?", [loanId]);

  const r = await adminA.api("POST", `/api/library/loans/${loanId}/renew`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.renewal_count, 1);
  assert.ok(r.data.due_date > String(before.due_date).slice(0, 10),
    "the borrower actually gains time");

  const row = await ctx.db.get("SELECT * FROM library_loans WHERE id = ?", [loanId]);
  assert.equal(Number(row.renewal_count), 1);
  assert.equal(row.status, "active");
});

test("renewals are capped so a book cannot be kept indefinitely", async () => {
  const { loanId } = await issueLoan();
  assert.equal((await adminA.api("POST", `/api/library/loans/${loanId}/renew`)).status, 200);
  assert.equal((await adminA.api("POST", `/api/library/loans/${loanId}/renew`)).status, 200);

  const third = await adminA.api("POST", `/api/library/loans/${loanId}/renew`);
  assert.equal(third.status, 409);
  assert.equal(third.data.code, "RENEWAL_LIMIT");
  assert.equal(Number((await ctx.db.get("SELECT renewal_count FROM library_loans WHERE id = ?", [loanId])).renewal_count),
    2, "the refused renewal did not increment the counter");
});

test("a returned loan cannot be renewed back to life", async () => {
  const { loanId } = await issueLoan();
  const ret = await adminA.api("POST", `/api/library/loans/${loanId}/return`);
  assert.equal(ret.status, 200, JSON.stringify(ret.data));

  const r = await adminA.api("POST", `/api/library/loans/${loanId}/renew`);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "INVALID_STATUS_TRANSITION");
});

test("a renewal that would shorten the loan is refused", async () => {
  const { loanId } = await issueLoan();
  const r = await adminA.api("POST", `/api/library/loans/${loanId}/renew`, { due_date: "2020-01-01" });
  assert.equal(r.status, 400);
  assert.match(r.data.error || r.data.message || "", /extend/i);
});

test("one institution cannot renew another institution's loan", async () => {
  const { loanId } = await issueLoan();
  const r = await adminB.api("POST", `/api/library/loans/${loanId}/renew`);
  assert.equal(r.status, 404);
});

test("a renewal is written to the activity log", async () => {
  const { loanId } = await issueLoan();
  await adminA.api("POST", `/api/library/loans/${loanId}/renew`);
  const row = await ctx.db.get(
    "SELECT * FROM activity_log WHERE madrasa_id = ? AND action = 'library.loan.renew' AND entity_id = ? ORDER BY id DESC",
    [tenantA, String(loanId)]
  );
  assert.ok(row, "the renewal is attributable after the fact");
});

/* ------------------------- library catalogue fields ----------------------- */

test("a book records the shelving and valuation details a real library needs", async () => {
  const create = await adminA.api("POST", "/api/library/books", {
    title: "Riyad as-Salihin",
    author: "An-Nawawi",
    total_copies: 2,
    edition: "3rd",
    shelf_location: "H-04-2",
    barcode: "9781234567897",
    replacement_cost_ngn: 12500,
    acquisition_date: "2024-03-11",
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const id = create.data.book ? create.data.book.id : create.data.id;

  const row = await ctx.db.get("SELECT * FROM library_books WHERE id = ?", [id]);
  assert.equal(row.edition, "3rd");
  assert.equal(row.shelf_location, "H-04-2", "a book nobody can find on the shelf is a lost book");
  assert.equal(row.barcode, "9781234567897");
  assert.equal(Number(row.replacement_cost_ngn), 12500, "needed to charge for a lost copy");
  assert.equal(String(row.acquisition_date).slice(0, 10), "2024-03-11");

  // And they must be editable — books get re-shelved and revalued.
  const patch = await adminA.api("PATCH", `/api/library/books/${id}`, {
    shelf_location: "A-01-1",
    replacement_cost_ngn: 15000,
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  const after = await ctx.db.get("SELECT * FROM library_books WHERE id = ?", [id]);
  assert.equal(after.shelf_location, "A-01-1");
  assert.equal(Number(after.replacement_cost_ngn), 15000);
  assert.equal(after.edition, "3rd", "an unrelated field is not wiped by a partial update");
});

test("the new fields are returned by the catalogue listing, not just stored", async () => {
  const create = await adminA.api("POST", "/api/library/books", {
    title: "Bulugh al-Maram",
    author: "Ibn Hajar",
    total_copies: 1,
    shelf_location: "B-02-3",
    barcode: "9780000000001",
  });
  assert.equal(create.status, 200);
  const r = await adminA.req("GET", "/api/library/books");
  assert.equal(r.status, 200);
  const found = (r.data.books || []).find((b) => b.title === "Bulugh al-Maram");
  assert.ok(found, "the book is listed");
  assert.equal(found.shelf_location, "B-02-3", "the shelf is visible to the librarian at the desk");
  assert.equal(found.barcode, "9780000000001");
});
