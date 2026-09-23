"use strict";
/* ============================================================================
   PLATFORM SUPPORT TICKETS — tests
   ----------------------------------------------------------------------------
   The institution raises tickets with the platform operator (admin-only,
   support.view / support.create); the super admin works a platform-wide queue
   with status/priority/assignment and public/internal notes. Tenant isolation
   and the internal-note boundary are enforced by the server.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");

initEnv();

let ctx;
let admin, adminB, teacher, superAdmin;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base); await admin.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
  superAdmin = new Client(ctx.base); await superAdmin.login("testadmin", SA_PASSWORD);
});
test.after(async () => { await ctx.close(); });

test("an institution administrator raises a ticket and follows the conversation", async () => {
  const create = await admin.api("POST", "/api/support/tickets", {
    subject: "Report card printing fails",
    body: "The print button does nothing on Chrome.",
    category: "technical", priority: "high",
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const id = create.data.id;

  const list = await admin.api("GET", "/api/support/tickets");
  assert.equal(list.status, 200);
  const row = (list.data.tickets || []).find((t) => t.id === id);
  assert.ok(row, "the ticket appears in the institution's list");
  assert.equal(row.status, "open");

  // The operator replies publicly → the ticket awaits the institution.
  const reply = await superAdmin.api("POST", `/api/platform/tickets/${id}/notes`, { note: "We reproduced it; a fix ships today." });
  assert.equal(reply.status, 200);
  const detail = await admin.api("GET", `/api/support/tickets/${id}`);
  assert.equal(detail.status, 200);
  assert.ok((detail.data.notes || []).some((n) => /fix ships today/.test(n.note)), "the operator's public reply is visible");
  assert.equal(detail.data.ticket.status, "awaiting_reply", "a public operator reply moves the status on");

  const answer = await admin.api("POST", `/api/support/tickets/${id}/notes`, { note: "Confirmed working — thank you!" });
  assert.equal(answer.status, 200);
  const detail2 = await admin.api("GET", `/api/support/tickets/${id}`);
  assert.equal(detail2.data.ticket.status, "open", "the institution's reply reopens the ticket for the operator");

  const close = await admin.api("PATCH", `/api/support/tickets/${id}`, { status: "closed" });
  assert.equal(close.status, 200, "the institution can close its own ticket");
});

test("teachers and parents cannot touch the institution's tickets", async () => {
  assert.equal((await teacher.api("GET", "/api/support/tickets")).status, 403, "teachers are refused");
  const studentClient = new Client(ctx.base);
  await studentClient.login("student-a1", PASSWORD);
  assert.equal((await studentClient.api("GET", "/api/support/tickets")).status, 403, "students are refused");
  assert.equal((await teacher.api("POST", "/api/support/tickets", { subject: "x", body: "y" })).status, 403);
});

test("tickets are isolated per tenant", async () => {
  const mine = await admin.api("POST", "/api/support/tickets", { subject: "A question", body: "From A" });
  assert.equal(mine.status, 200);
  // B's administrator sees only B's tickets and cannot open A's by id.
  const listB = await adminB.api("GET", "/api/support/tickets");
  assert.equal(listB.status, 200);
  assert.ok(!(listB.data.tickets || []).some((t) => t.id === mine.data.id), "B never sees A's tickets");
  assert.equal((await adminB.api("GET", `/api/support/tickets/${mine.data.id}`)).status, 404);
  assert.equal((await adminB.api("POST", `/api/support/tickets/${mine.data.id}/notes`, { note: "hi" })).status, 404);
});

test("the super admin works the platform queue, but the platform queue is super-admin-only", async () => {
  const queue = await superAdmin.api("GET", "/api/platform/tickets");
  assert.equal(queue.status, 200);
  assert.ok(typeof queue.data.counts === "object", "status counts are included");

  const byId = await superAdmin.api("GET", `/api/platform/tickets/${queue.data.tickets[0].id}`);
  assert.equal(byId.status, 200);
  assert.ok(byId.data.ticket.madrasa_name, "the operator sees which institution raised it");

  const update = await superAdmin.api("PATCH", `/api/platform/tickets/${byId.data.ticket.id}`, { status: "in_progress", priority: "urgent" });
  assert.equal(update.status, 200);
  const after = await superAdmin.api("GET", `/api/platform/tickets/${byId.data.ticket.id}`);
  assert.equal(after.data.ticket.status, "in_progress");
  assert.equal(after.data.ticket.priority, "urgent");

  // Assignment only to platform administrators.
  const teacherRow = await ctx.db.get("SELECT id FROM users WHERE username = 'teacher-a'");
  assert.equal((await superAdmin.api("PATCH", `/api/platform/tickets/${byId.data.ticket.id}`, { assigned_to: teacherRow.id })).status, 400,
    "a tenant teacher cannot be assigned a ticket");
  assert.equal((await admin.api("GET", "/api/platform/tickets")).status, 403, "an institution admin has no platform queue");
});

test("internal operator notes never reach the institution", async () => {
  const t = await admin.api("POST", "/api/support/tickets", { subject: "Billing query", body: "Why were we charged twice?" });
  assert.equal(t.status, 200);
  const internal = await superAdmin.api("POST", `/api/platform/tickets/${t.data.id}/notes`, { note: "INTERNAL: suspected duplicate invoice row 88.", internal_only: true });
  assert.equal(internal.status, 200);
  const publicNote = await superAdmin.api("POST", `/api/platform/tickets/${t.data.id}/notes`, { note: "We are checking your invoices." });
  assert.equal(publicNote.status, 200);

  const operatorView = await superAdmin.api("GET", `/api/platform/tickets/${t.data.id}`);
  assert.ok((operatorView.data.notes || []).some((n) => /INTERNAL/.test(n.note) && Number(n.internal_only) === 1), "the operator sees their internal note");
  const institutionView = await admin.api("GET", `/api/support/tickets/${t.data.id}`);
  assert.ok(!(institutionView.data.notes || []).some((n) => /INTERNAL/.test(n.note)), "the institution never sees internal notes");
  assert.ok((institutionView.data.notes || []).some((n) => /checking your invoices/.test(n.note)), "public notes do come through");
});

test("ticket actions are audited", async () => {
  const before = await ctx.db.get(
    "SELECT COUNT(*) AS n FROM activity_log WHERE action IN ('support.ticket.create','platform.ticket.update','platform.ticket.reply')"
  );
  const t = await admin.api("POST", "/api/support/tickets", { subject: "Audit me", body: "please" });
  assert.equal(t.status, 200);
  await superAdmin.api("PATCH", `/api/platform/tickets/${t.data.id}`, { status: "resolved" });
  await superAdmin.api("POST", `/api/platform/tickets/${t.data.id}/notes`, { note: "Resolved." });
  const after = await ctx.db.get(
    "SELECT COUNT(*) AS n FROM activity_log WHERE action IN ('support.ticket.create','platform.ticket.update','platform.ticket.reply')"
  );
  assert.equal(Number(after.n), Number(before.n) + 3, "create, update and reply are all audited");
});

test("validation rejects empty or malformed tickets", async () => {
  assert.equal((await admin.api("POST", "/api/support/tickets", { subject: "", body: "x" })).status, 400);
  assert.equal((await admin.api("POST", "/api/support/tickets", { subject: "x", body: "" })).status, 400);
  assert.equal((await admin.api("POST", "/api/support/tickets", { subject: "x", body: "y", priority: "cosmic" })).status, 200,
    "an unknown priority just falls back to medium (no crash)");
});
