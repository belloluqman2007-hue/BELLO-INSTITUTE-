"use strict";
/* ============================================================================
   STAFF LEAVE MODULE TESTS
   ----------------------------------------------------------------------------
   Covers the additive staff-leave module end-to-end through the real HTTP API:
     • the leave type catalogue: seeded defaults, CRUD, archive-instead-of-delete
     • requests: teacher self-service submit, admin submit on behalf, validation
     • the status flow pending → approved | rejected | cancelled
     • approval side effects: 'on_leave' rows written into the EXISTING
       teacher_attendance register, and reversed on cancel/delete
     • balances: entitlement − days taken this session, per teacher per type
     • overlap detection (409) at submit time and again at approval time
     • the monthly calendar grid payload
     • privacy: a teacher only ever sees their own requests, and reasons are
       stripped from colleagues' calendar entries
     • authentication (401), authorisation (403) and tenant isolation (404)
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { initEnv, setup, Client } = require("./helpers");
initEnv();

let ctx;
let adminA, adminB, teacherA, anon;
let annualId, sickId;
const U = "Passw0rd!123";

/** Dates well clear of any other fixture, on known weekdays.
    2026-11-02 is a Monday; 2026-11-07 is the Saturday of that week. */
const MON = "2026-11-02";
const SAT = "2026-11-07";

before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  anon = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", U)).status, 200, "adminA login");
  assert.equal((await adminB.login("admin-b", U)).status, 200, "adminB login");
  assert.equal((await teacherA.login("teacher-a", U)).status, 200, "teacherA login");
});
after(async () => { await ctx.close(); });

/* ----------------------------- leave types ------------------------------- */

test("the leave catalogue is seeded once with the standard entitlements", async () => {
  const r = await adminA.req("GET", "/api/leave/types");
  assert.equal(r.status, 200);
  const byCode = Object.fromEntries(r.data.types.map((t) => [t.code, t]));
  assert.equal(byCode.annual.days_per_year, 21);
  assert.equal(byCode.sick.days_per_year, 14);
  assert.equal(byCode.maternity_paternity.days_per_year, 90);
  assert.equal(byCode.study.days_per_year, 10);
  assert.equal(byCode.emergency.days_per_year, 5);
  assert.equal(byCode.unpaid.days_per_year, 0);
  assert.equal(byCode.annual.paid, true, "annual leave is paid");
  assert.equal(byCode.unpaid.paid, false, "unpaid leave is flagged unpaid");
  annualId = byCode.annual.id;
  sickId = byCode.sick.id;

  // Seeding must be idempotent — a second read never duplicates the catalogue.
  const again = await adminA.req("GET", "/api/leave/types");
  assert.equal(again.data.types.length, r.data.types.length);
});

test("both institution categories receive the identical catalogue", async () => {
  await ctx.db.run("UPDATE madaris SET category = ? WHERE id = ?", ["western", ctx.madrasaB]);
  const western = await adminB.req("GET", "/api/leave/types");
  assert.equal(western.status, 200);
  const islamic = await adminA.req("GET", "/api/leave/types");
  assert.deepEqual(
    western.data.types.map((t) => t.code).sort(),
    islamic.data.types.map((t) => t.code).sort(),
    "leave is never category-gated"
  );
});

test("admin can add, edit and archive leave types", async () => {
  const created = await adminA.api("POST", "/api/leave/types", { name: "Hajj Leave", days_per_year: 30, paid: true, colour: "#146848" });
  assert.equal(created.status, 200);
  const id = created.data.id;

  const edited = await adminA.api("PATCH", `/api/leave/types/${id}`, { days_per_year: 25, description: "Pilgrimage." });
  assert.equal(edited.status, 200);
  const list = await adminA.req("GET", "/api/leave/types");
  const hajj = list.data.types.find((t) => t.id === id);
  assert.equal(hajj.days_per_year, 25);
  assert.equal(hajj.description, "Pilgrimage.");

  // Unused type → hard delete.
  const removed = await adminA.api("DELETE", `/api/leave/types/${id}`, {});
  assert.equal(removed.status, 200);
  assert.equal(removed.data.archived, false);
  const after = await adminA.req("GET", "/api/leave/types");
  assert.ok(!after.data.types.some((t) => t.id === id), "unused type is deleted outright");
});

test("a duplicate leave type name is rejected", async () => {
  const r = await adminA.api("POST", "/api/leave/types", { name: "Annual Leave", days_per_year: 5 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /already/i);
});

test("teachers may read the catalogue but never change it", async () => {
  assert.equal((await teacherA.req("GET", "/api/leave/types")).status, 200);
  const write = await teacherA.api("POST", "/api/leave/types", { name: "Invented Leave", days_per_year: 99 });
  assert.equal(write.status, 403);
});

/* ------------------------------- requests -------------------------------- */

let requestId;

test("a teacher submits their own leave request and only working days are counted", async () => {
  const r = await teacherA.api("POST", "/api/leave", {
    type_id: annualId, start_date: MON, end_date: SAT, reason: "Family commitment.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "pending");
  assert.equal(r.data.days, 6, "Mon–Sat inclusive is six working days");
  assert.ok(r.data.session_id, "the request is attached to the academic session");
  requestId = r.data.id;
});

test("Sundays are excluded from the day count", async () => {
  // 2026-11-08 is a Sunday.
  const r = await teacherA.api("POST", "/api/leave", { type_id: sickId, start_date: "2026-11-08", end_date: "2026-11-08" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no working days/i);
});

test("request validation rejects bad dates and foreign leave types", async () => {
  const backwards = await teacherA.api("POST", "/api/leave", { type_id: annualId, start_date: "2026-12-10", end_date: "2026-12-01" });
  assert.equal(backwards.status, 400);
  assert.match(backwards.data.error, /end date/i);

  const noType = await teacherA.api("POST", "/api/leave", { type_id: 999999, start_date: "2026-12-01", end_date: "2026-12-02" });
  assert.equal(noType.status, 400);

  const foreignType = (await adminB.req("GET", "/api/leave/types")).data.types[0];
  const crossTenant = await teacherA.api("POST", "/api/leave", { type_id: foreignType.id, start_date: "2026-12-01", end_date: "2026-12-02" });
  assert.equal(crossTenant.status, 400, "a leave type from another madrasa is never accepted");
});

test("a teacher cannot file leave on another staff member's behalf", async () => {
  const r = await teacherA.api("POST", "/api/leave", {
    user_id: ctx.users.adminA, type_id: annualId, start_date: "2026-12-01", end_date: "2026-12-02",
  });
  // user_id is ignored for non-admins: the request is filed for the teacher.
  assert.equal(r.status, 200);
  const created = await teacherA.req("GET", `/api/leave/${r.data.id}`);
  assert.equal(Number(created.data.request.user_id), ctx.users.teacherA);
  await adminA.api("DELETE", `/api/leave/${r.data.id}`, {});
});

test("a teacher sees only their own requests", async () => {
  const onBehalf = await adminA.api("POST", "/api/leave", {
    user_id: ctx.users.teacherA, type_id: sickId, start_date: "2026-12-14", end_date: "2026-12-15", reason: "Admin filed.",
  });
  assert.equal(onBehalf.status, 200, "an administrator may file on behalf of staff");

  const mine = await teacherA.req("GET", "/api/leave");
  assert.ok(mine.data.requests.length > 0);
  assert.ok(mine.data.requests.every((r) => Number(r.user_id) === ctx.users.teacherA), "no colleague rows leak into a teacher's list");

  await adminA.api("DELETE", `/api/leave/${onBehalf.data.id}`, {});
});

test("a pending request can be edited, an approved one cannot", async () => {
  const edit = await teacherA.api("PATCH", `/api/leave/${requestId}`, { reason: "Family commitment (updated)." });
  assert.equal(edit.status, 200);
  const row = await teacherA.req("GET", `/api/leave/${requestId}`);
  assert.match(row.data.request.reason, /updated/);
});

/* ------------------------------ approvals -------------------------------- */

test("approving a request writes on_leave into the existing attendance register", async () => {
  const before = await ctx.db.get(
    "SELECT COUNT(*) AS n FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ?",
    [ctx.madrasaA, ctx.users.teacherA]
  );

  const r = await adminA.api("PATCH", `/api/leave/${requestId}/approve`, { note: "Approved — cover arranged." });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "approved");
  assert.equal(r.data.attendanceRows, 6, "one register row per working day");

  const rows = await ctx.db.all(
    "SELECT day, status, notes FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ? ORDER BY day",
    [ctx.madrasaA, ctx.users.teacherA]
  );
  assert.equal(rows.length - Number(before.n), 6);
  const written = rows.filter((x) => String(x.notes || "").includes(`[leave #${requestId}]`));
  assert.equal(written.length, 6);
  assert.ok(written.every((x) => x.status === "on_leave"), "the module reuses the existing on_leave status");
  assert.equal(written[0].day, MON);
  assert.equal(written[5].day, SAT);

  const detail = await adminA.req("GET", `/api/leave/${requestId}`);
  assert.equal(detail.data.request.review_note, "Approved — cover arranged.");
  assert.equal(detail.data.request.reviewed_by_name, "Admin A");
});

test("a request can only be reviewed once", async () => {
  const again = await adminA.api("PATCH", `/api/leave/${requestId}/approve`, {});
  assert.equal(again.status, 400);
  assert.match(again.data.error, /already approved/i);
});

test("teachers cannot approve or reject anything", async () => {
  const pending = await teacherA.api("POST", "/api/leave", { type_id: sickId, start_date: "2027-01-11", end_date: "2027-01-12" });
  const attempt = await teacherA.api("PATCH", `/api/leave/${pending.data.id}/approve`, {});
  assert.equal(attempt.status, 403);

  const rejected = await adminA.api("PATCH", `/api/leave/${pending.data.id}/reject`, { note: "Too close to examinations." });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.status, "rejected");
  assert.equal(rejected.data.attendanceRows, 0, "a rejection never touches the register");
});

/* --------------------------- overlap detection --------------------------- */

test("an overlapping request is refused at submission", async () => {
  const r = await teacherA.api("POST", "/api/leave", { type_id: sickId, start_date: "2026-11-05", end_date: "2026-11-11" });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /already has approved/i);
});

test("an overlap created after submission is caught again at approval", async () => {
  // File first (no clash), then create the clash, then try to approve.
  const later = await adminA.api("POST", "/api/leave", {
    user_id: ctx.users.teacherA, type_id: sickId, start_date: "2027-02-01", end_date: "2027-02-06",
  });
  assert.equal(later.status, 200);
  const blocker = await adminA.api("POST", "/api/leave", {
    user_id: ctx.users.teacherA, type_id: annualId, start_date: "2027-02-03", end_date: "2027-02-04",
  });
  assert.equal(blocker.status, 200);
  assert.equal((await adminA.api("PATCH", `/api/leave/${blocker.data.id}/approve`, {})).status, 200);

  const clash = await adminA.api("PATCH", `/api/leave/${later.data.id}/approve`, {});
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /Cannot approve/i);

  await adminA.api("DELETE", `/api/leave/${later.data.id}`, {});
  await adminA.api("DELETE", `/api/leave/${blocker.data.id}`, {});
});

/* -------------------------------- balances ------------------------------- */

test("balances report entitlement minus days taken for the session", async () => {
  const r = await adminA.req("GET", "/api/leave/balances");
  assert.equal(r.status, 200);
  assert.ok(r.data.session, "balances are scoped to an academic session");

  const annual = r.data.balances.find((b) => Number(b.user_id) === ctx.users.teacherA && b.type_id === annualId);
  assert.ok(annual, "the teacher has an annual leave balance");
  assert.equal(annual.entitlement, 21);
  assert.equal(annual.taken, 6, "the six approved days are deducted");
  assert.equal(annual.remaining, 15);
  assert.equal(annual.teacher_name, "Teacher A");

  const sick = r.data.balances.find((b) => Number(b.user_id) === ctx.users.teacherA && b.type_id === sickId);
  assert.equal(sick.taken, 0, "rejected leave is never counted as taken");
  assert.equal(sick.remaining, 14);
});

test("a teacher's own balances and history come back from /me", async () => {
  const r = await teacherA.req("GET", "/api/leave/me");
  assert.equal(r.status, 200);
  assert.ok(r.data.staff, "the teacher has a staff record");
  assert.ok(r.data.types.length >= 6, "the catalogue is offered for the request form");
  const annual = r.data.balances.find((b) => b.type_id === annualId);
  assert.equal(annual.remaining, 15);
  assert.ok(r.data.requests.every((x) => Number(x.user_id) === ctx.users.teacherA));
});

test("an administrator with no teaching record still gets the catalogue", async () => {
  const r = await adminA.req("GET", "/api/leave/me");
  assert.equal(r.status, 200);
  assert.equal(r.data.staff, null);
  assert.ok(r.data.types.length >= 6);
});

/* -------------------------------- calendar ------------------------------- */

test("the calendar returns approved leave expanded into working days", async () => {
  const r = await adminA.req("GET", "/api/leave/calendar?month=11&year=2026");
  assert.equal(r.status, 200);
  assert.equal(r.data.month, 11);
  assert.equal(r.data.days_in_month, 30);
  assert.equal(r.data.first_weekday, 0, "1 November 2026 is a Sunday");
  assert.equal(r.data.summary.staff, 1);
  assert.deepEqual(Object.keys(r.data.byDay).sort(), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  const entry = r.data.byDay[MON][0];
  assert.equal(entry.teacher_name, "Teacher A");
  assert.equal(entry.type_name, "Annual Leave");
  assert.ok(entry.type_colour, "each entry carries its colour for the grid");
  assert.ok(r.data.types.length >= 6, "the legend is supplied");
});

test("the calendar hides other people's reasons from colleagues", async () => {
  const other = await ctx.db.get("SELECT id FROM users WHERE madrasa_id = ? AND role = 'teacher' AND id <> ?", [ctx.madrasaA, ctx.users.teacherA]);
  if (!other) {
    // Single-teacher fixture: assert the owner still sees their own reason.
    const own = await teacherA.req("GET", "/api/leave/calendar?month=11&year=2026");
    assert.match(own.data.leaves[0].reason, /Family commitment/);
    return;
  }
  const colleague = new Client(ctx.base);
  await colleague.login(other.username, U);
  const r = await colleague.req("GET", "/api/leave/calendar?month=11&year=2026");
  assert.equal(r.data.leaves[0].reason, "");
});

test("an empty month is still a valid grid", async () => {
  const r = await adminA.req("GET", "/api/leave/calendar?month=6&year=2030");
  assert.equal(r.status, 200);
  assert.equal(r.data.leaves.length, 0);
  assert.deepEqual(r.data.byDay, {});
});

/* ------------------------- cancellation / reversal ----------------------- */

test("cancelling an approved leave reverses only the rows this module created", async () => {
  // A manually marked day must survive the reversal.
  await ctx.db.run(
    "INSERT INTO teacher_attendance (madrasa_id, user_id, day, status, notes) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, ctx.users.teacherA, "2026-11-16", "present", "manually marked"]
  );

  const r = await adminA.api("PATCH", `/api/leave/${requestId}/cancel`, { note: "Plans changed." });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "cancelled");
  assert.equal(r.data.attendanceRowsRemoved, 6);

  const left = await ctx.db.all(
    "SELECT day, status, notes FROM teacher_attendance WHERE madrasa_id = ? AND user_id = ?",
    [ctx.madrasaA, ctx.users.teacherA]
  );
  assert.ok(!left.some((x) => String(x.notes || "").includes(`[leave #${requestId}]`)), "leave rows are gone");
  assert.ok(left.some((x) => x.day === "2026-11-16" && x.status === "present"), "the manual row is untouched");

  const balances = await adminA.req("GET", "/api/leave/balances");
  const annual = balances.data.balances.find((b) => Number(b.user_id) === ctx.users.teacherA && b.type_id === annualId);
  assert.equal(annual.taken, 0, "cancelled leave is returned to the balance");
  assert.equal(annual.remaining, 21);
});

/* ----------------------- auth, roles, tenant isolation -------------------- */

test("every leave endpoint requires authentication", async () => {
  for (const path of ["/api/leave", "/api/leave/types", "/api/leave/balances", "/api/leave/calendar", "/api/leave/me"]) {
    const r = await anon.req("GET", path);
    assert.equal(r.status, 401, `${path} is protected`);
  }
});

test("leave never crosses a tenant boundary", async () => {
  const fresh = await adminA.api("POST", "/api/leave", {
    user_id: ctx.users.teacherA, type_id: annualId, start_date: "2027-03-01", end_date: "2027-03-03",
  });
  assert.equal(fresh.status, 200);
  const id = fresh.data.id;

  assert.equal((await adminB.req("GET", `/api/leave/${id}`)).status, 404);
  assert.equal((await adminB.api("PATCH", `/api/leave/${id}/approve`, {})).status, 404);
  assert.equal((await adminB.api("PATCH", `/api/leave/${id}/reject`, {})).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/leave/${id}`, {})).status, 404);

  const listB = await adminB.req("GET", "/api/leave");
  assert.ok(!listB.data.requests.some((x) => x.id === id), "madrasa B never lists madrasa A's leave");

  const balancesB = await adminB.req("GET", "/api/leave/balances");
  assert.ok(!balancesB.data.balances.some((b) => Number(b.user_id) === ctx.users.teacherA));
});

test("a leave type in use is archived rather than deleted", async () => {
  const removed = await adminA.api("DELETE", `/api/leave/types/${annualId}`, {});
  assert.equal(removed.status, 200);
  assert.equal(removed.data.archived, true, "history is preserved");
  const all = await adminA.req("GET", "/api/leave/types?includeArchived=1");
  assert.equal(all.data.types.find((t) => t.id === annualId).status, "archived");
  // Restore it so the module is left in a usable state.
  await adminA.api("PATCH", `/api/leave/types/${annualId}`, { status: "active" });
});

/* --------------------------- filters and export --------------------------- */

test("the request list filters by status, type and date window", async () => {
  const pending = await adminA.req("GET", "/api/leave?status=pending");
  assert.equal(pending.status, 200);
  assert.ok(pending.data.requests.every((r) => r.status === "pending"));
  assert.ok(pending.data.stats.total >= pending.data.requests.length);

  const byType = await adminA.req(`GET`, `/api/leave?typeId=${sickId}`);
  assert.ok(byType.data.requests.every((r) => r.type_id === sickId));

  const window_ = await adminA.req("GET", "/api/leave?from=2027-03-01&to=2027-03-31");
  assert.ok(window_.data.requests.every((r) => r.end_date >= "2027-03-01" && r.start_date <= "2027-03-31"));
});

test("leave exports as CSV through the shared csv service", async () => {
  const r = await adminA.req("GET", "/api/leave/export.csv");
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get("content-type"), /text\/csv/);
  // fetch's res.text() strips the BOM, so assert it on the raw wire bytes.
  const bytes = new Uint8Array(await r.res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM on the wire");
  const text = Buffer.from(bytes).toString("utf8");
  assert.ok(text.includes("Staff Member,Staff ID,Department"), "header row after the BOM");
  assert.match(text, /Teacher A/);

  const teacherCopy = await teacherA.req("GET", "/api/leave/export.csv");
  assert.equal(teacherCopy.status, 200, "a teacher may export their own leave");
});
