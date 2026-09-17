"use strict";
/* ============================================================================
   MESSAGE DELIVERY TESTS
   ----------------------------------------------------------------------------
   Covers the additive external-delivery module:
     • phone normalisation to Nigerian +234 E.164
     • graceful degradation: every provider "none" -> send* is a silent no-op
       that resolves (never throws) and the in-app notification still happens
     • provider status endpoint (admin only, never leaks a credential)
     • the delivery-log endpoint shape
     • POST /api/communication/bulk — admin only, audience resolution,
       { sent, failed } accounting and one communication_history row per attempt
     • the new communication_history columns exist after migration
     • tenant isolation: a madrasa B admin never sees madrasa A's log rows
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { initEnv, setup, Client } = require("./helpers");
initEnv();

const delivery = require("../server/services/delivery");
const comm = require("../server/services/communication");

let ctx, adminA, adminB, teacherA, anon;
const U = "Passw0rd!123";

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base); await adminA.login("admin-a", U);
  adminB = new Client(ctx.base); await adminB.login("admin-b", U);
  teacherA = new Client(ctx.base); await teacherA.login("teacher-a", U);
  anon = new Client(ctx.base);
});
after(async () => { await ctx.close(); });

/* ------------------------------ unit: helpers --------------------------- */
test("Nigerian phone numbers normalise to +234 E.164", () => {
  assert.equal(delivery.normalisePhone("08031234567"), "+2348031234567");
  assert.equal(delivery.normalisePhone("0803 123 4567"), "+2348031234567");
  assert.equal(delivery.normalisePhone("+234-803-123-4567"), "+2348031234567");
  assert.equal(delivery.normalisePhone("2348031234567"), "+2348031234567");
  assert.equal(delivery.normalisePhone("8031234567"), "+2348031234567");
  assert.equal(delivery.normalisePhone("00234 8031234567"), "+2348031234567");
  // A foreign number keeps its own country code.
  assert.equal(delivery.normalisePhone("+14155552671"), "+14155552671");
  assert.equal(delivery.normalisePhone(""), "");
  assert.equal(delivery.normalisePhone(null), "");
});

test("email validation accepts real addresses and rejects junk", () => {
  assert.equal(delivery.validEmail("Parent@Example.COM"), "parent@example.com");
  assert.equal(delivery.validEmail("not-an-email"), "");
  assert.equal(delivery.validEmail(""), "");
});

test("with no provider configured every send is a skipped no-op, never a throw", async () => {
  for (const r of [
    await delivery.sendEmail("parent@example.com", "Hi", "<p>Hi</p>", "Hi"),
    await delivery.sendSms("08031234567", "Hi"),
    await delivery.sendWhatsapp("08031234567", "Hi"),
    await delivery.send("email", "parent@example.com", { subject: "Hi", message: "Hi" }),
  ]) {
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(r.error, "");
  }
});

test("providerStatus exposes flags only — never a key or password", () => {
  const s = delivery.providerStatus();
  assert.deepEqual(Object.keys(s).sort(), ["email", "sms", "whatsapp"]);
  const blob = JSON.stringify(s);
  for (const k of ["apiKey", "authToken", "pass", "secret"]) assert.ok(!blob.includes(k), `${k} leaked`);
  assert.equal(s.email.provider, "none");
  assert.equal(s.email.configured, false);
});

/* ------------------------------ migration ------------------------------- */
test("communication_history has the delivery columns", async () => {
  await ctx.db.run(
    "INSERT INTO communication_history (madrasa_id, channel, message_type, message, delivery_status, error_message, provider, provider_message_id, recipient_address) VALUES (?,?,?,?,?,?,?,?,?)",
    [ctx.madrasaA, "sms", "test", "hello", "failed", "boom", "termii", "abc", "+2348031234567"]
  );
  const row = await ctx.db.get("SELECT * FROM communication_history WHERE madrasa_id = ? ORDER BY id DESC LIMIT 1", [ctx.madrasaA]);
  assert.equal(row.error_message, "boom");
  assert.equal(row.provider, "termii");
  assert.equal(row.recipient_address, "+2348031234567");
  await ctx.db.run("DELETE FROM communication_history WHERE id = ?", [row.id]);
});

/* ------------------------- in-app flow is untouched --------------------- */
test("an in-app notification is still created when delivery is off", async () => {
  const parent = await ctx.db.get("SELECT id FROM users WHERE madrasa_id = ? AND username = 'parent-a'", [ctx.madrasaA]);
  await ctx.db.run("INSERT INTO notification_preferences (madrasa_id,user_id,notification_type,in_app,email,sms,whatsapp) VALUES (?,?,?,1,1,1,0)", [ctx.madrasaA, parent.id, "fee_reminder"]);
  await ctx.db.run("UPDATE users SET email = ?, phone = ? WHERE id = ?", ["parent-a@example.com", "08031234567", parent.id]);
  const ids = await comm.createNotifications(ctx.madrasaA, [parent.id], { type: "fee_reminder", title: "Fees due", body: "Please settle the term fees." });
  assert.equal(ids.length, 1);
  const n = await ctx.db.get("SELECT * FROM notifications WHERE id = ?", [ids[0]]);
  assert.equal(n.title, "Fees due");
  assert.equal(Number(n.madrasa_id), Number(ctx.madrasaA));
  // Providers are off, so nothing was logged as failed.
  const failed = await ctx.db.get("SELECT COUNT(*) AS n FROM communication_history WHERE madrasa_id = ? AND delivery_status = 'failed'", [ctx.madrasaA]);
  assert.equal(Number(failed.n), 0);
});

test("deliverableType maps the five event types and legacy aliases", () => {
  for (const t of ["fee_reminder", "payment_received", "announcement", "result_published", "admission_decision"]) {
    assert.equal(comm.deliverableType(t), t);
  }
  assert.equal(comm.deliverableType("admission_update"), "admission_decision");
  assert.equal(comm.deliverableType("new_assignment"), "");
});

/* -------------------------------- routes -------------------------------- */
test("GET /api/communication/delivery/providers is admin-only", async () => {
  assert.equal((await anon.req("GET", "/api/communication/delivery/providers")).status, 401);
  assert.equal((await teacherA.req("GET", "/api/communication/delivery/providers")).status, 403);
  const r = await adminA.req("GET", "/api/communication/delivery/providers");
  assert.equal(r.status, 200);
  assert.equal(r.data.providers.sms.provider, "none");
});

test("POST /api/communication/delivery/test records the attempt and reports skipped", async () => {
  const r = await adminA.api("POST", "/api/communication/delivery/test", { channel: "sms", to: "08031234567" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.skipped, true);
  const row = await ctx.db.get("SELECT * FROM communication_history WHERE madrasa_id = ? AND message_type = 'delivery_test' ORDER BY id DESC LIMIT 1", [ctx.madrasaA]);
  assert.equal(row.delivery_status, "skipped");
  assert.equal(row.channel, "sms");
  const bad = await adminA.api("POST", "/api/communication/delivery/test", { channel: "carrier-pigeon", to: "x" });
  assert.equal(bad.status, 400);
});

test("POST /api/communication/bulk sends to all parents and accounts for each attempt", async () => {
  const before = await ctx.db.get("SELECT COUNT(*) AS n FROM communication_history WHERE madrasa_id = ?", [ctx.madrasaA]);
  const r = await adminA.api("POST", "/api/communication/bulk", { target: "all_parents", channel: "sms", subject: "Notice", message: "School resumes Monday." });
  assert.equal(r.status, 200);
  assert.equal(r.data.recipients, 1);
  assert.equal(r.data.sent, 0);        // no provider configured
  assert.equal(r.data.skipped, 1);     // and therefore skipped, not failed
  assert.equal(r.data.failed, 0);
  const after = await ctx.db.get("SELECT COUNT(*) AS n FROM communication_history WHERE madrasa_id = ?", [ctx.madrasaA]);
  assert.equal(Number(after.n), Number(before.n) + 1);
});

test("bulk send counts a recipient without contact details as failed", async () => {
  const parent = await ctx.db.get("SELECT id, phone FROM users WHERE madrasa_id = ? AND username = 'parent-a'", [ctx.madrasaA]);
  await ctx.db.run("UPDATE users SET phone = '' WHERE id = ?", [parent.id]);
  const r = await adminA.api("POST", "/api/communication/bulk", { target: "all_parents", channel: "sms", message: "Hello" });
  assert.equal(r.data.failed, 1);
  assert.equal(r.data.sent, 0);
  const row = await ctx.db.get("SELECT * FROM communication_history WHERE madrasa_id = ? AND message_type = 'bulk_message' ORDER BY id DESC LIMIT 1", [ctx.madrasaA]);
  assert.equal(row.delivery_status, "failed");
  assert.match(row.error_message, /No contact detail/);
  await ctx.db.run("UPDATE users SET phone = ? WHERE id = ?", [parent.phone || "08031234567", parent.id]);
});

test("bulk send resolves a class audience and the outstanding-fees audience", async () => {
  const byClass = await adminA.api("POST", "/api/communication/bulk", { target: `class:${ctx.classA1}`, channel: "email", message: "Class notice" });
  assert.equal(byClass.status, 200);
  assert.equal(byClass.data.recipients, 1); // parent-a is linked to a student in class A1
  const outstanding = await adminA.api("POST", "/api/communication/bulk", { target: "outstanding_fees", channel: "sms", message: "Fees" });
  assert.equal(outstanding.status, 200);
  assert.ok(outstanding.data.recipients >= 0);
});

test("bulk send validates input and is admin-only", async () => {
  // An anonymous POST is rejected by CSRF (403) or authentication (401) — both are refusals.
  assert.ok([401, 403].includes((await anon.req("POST", "/api/communication/bulk", { target: "all_parents", channel: "sms", message: "x" })).status));
  assert.equal((await teacherA.api("POST", "/api/communication/bulk", { target: "all_parents", channel: "sms", message: "x" })).status, 403);
  assert.equal((await adminA.api("POST", "/api/communication/bulk", { target: "all_parents", channel: "pigeon", message: "x" })).status, 400);
  assert.equal((await adminA.api("POST", "/api/communication/bulk", { target: "everyone", channel: "sms", message: "x" })).status, 400);
  assert.equal((await adminA.api("POST", "/api/communication/bulk", { target: "all_parents", channel: "sms", message: "" })).status, 400);
});

test("the delivery log is tenant-scoped and excludes in-app rows by default", async () => {
  const a = await adminA.req("GET", "/api/communication/delivery/log");
  assert.equal(a.status, 200);
  assert.ok(a.data.log.length > 0);
  for (const row of a.data.log) assert.notEqual(row.channel, "in_app");
  assert.ok("sent_at" in a.data.log[0] && "delivery_status" in a.data.log[0] && "error_message" in a.data.log[0]);
  const b = await adminB.req("GET", "/api/communication/delivery/log");
  assert.equal(b.status, 200);
  assert.equal(b.data.log.length, 0); // madrasa B has sent nothing
});
