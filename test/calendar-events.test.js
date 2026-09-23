"use strict";
/* ============================================================================
   ACADEMIC CALENDAR & SCHOOL EVENTS — tests
   ----------------------------------------------------------------------------
   Covers the tenant-scoped calendar module: CRUD, audience targeting
   (all / staff / students / parents / specific classes), permission gates,
   tenant isolation and validation. Sessions and terms already exist; this is
   the events layer that lives inside them.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();

let ctx;
let admin, teacher, student, parent, adminB;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base); await admin.login("admin-a", PASSWORD);
  teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
  student = new Client(ctx.base); await student.login("student-a1", PASSWORD);
  parent = new Client(ctx.base); await parent.login("parent-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
});
test.after(async () => { await ctx.close(); });

test("an administrator creates, lists, edits and deletes calendar events", async () => {
  const create = await admin.api("POST", "/api/calendar", {
    title: "Mid-term break", event_type: "holiday",
    start_date: "2026-10-12", end_date: "2026-10-16", audience: "all",
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));

  const list = await admin.api("GET", "/api/calendar");
  assert.equal(list.status, 200);
  const ev = (list.data.events || []).find((e) => e.title === "Mid-term break");
  assert.ok(ev, "the event is listed for staff");
  assert.equal(ev.audience, "all");

  const patch = await admin.api("PATCH", `/api/calendar/${ev.id}`, { title: "Mid-term break (extended)", end_date: "2026-10-18" });
  assert.equal(patch.status, 200);
  const after = await admin.api("GET", "/api/calendar");
  assert.ok((after.data.events || []).some((e) => e.title === "Mid-term break (extended)"), "edits stick");

  const del = await admin.api("DELETE", `/api/calendar/${ev.id}`);
  assert.equal(del.status, 200);
  const gone = await admin.api("GET", "/api/calendar");
  assert.ok(!(gone.data.events || []).some((e) => e.title.includes("Mid-term break")), "deleted events disappear");
});

test("audience targeting decides what students and parents can see", async () => {
  const mk = async (body) => {
    const r = await admin.api("POST", "/api/calendar", body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  const forAll = await mk({ title: "Sports day", event_type: "activity", start_date: "2026-10-01", audience: "all" });
  const forTeachers = await mk({ title: "Staff training", event_type: "other", start_date: "2026-10-02", audience: "teachers" });
  const forParents = await mk({ title: "PTM briefing", event_type: "ptm", start_date: "2026-10-03", audience: "parents" });
  const forClass = await mk({ title: "Class A1 excursion", event_type: "activity", start_date: "2026-10-04", audience: "specific_classes", target_ids: [ctx.classA1] });
  const forOtherClass = await mk({ title: "Class A2 rehearsal", event_type: "activity", start_date: "2026-10-05", audience: "specific_classes", target_ids: [ctx.classA2] });
  const draft = await mk({ title: "Secret planning", event_type: "other", start_date: "2026-10-06", audience: "all", status: "draft" });

  const see = async (client) => new Set((await client.api("GET", "/api/calendar")).data.events.map((e) => e.title));

  const studentSees = await see(student);
  assert.ok(studentSees.has("Sports day"), "student sees 'all' events");
  assert.ok(!studentSees.has("Staff training"), "student never sees teacher-only events");
  assert.ok(!studentSees.has("PTM briefing"), "student never sees parent-only events");
  assert.ok(studentSees.has("Class A1 excursion"), "student sees events targeting their class");
  assert.ok(!studentSees.has("Class A2 rehearsal"), "student does not see another class's events");
  assert.ok(!studentSees.has("Secret planning"), "drafts are never shown to portals");

  const parentSees = await see(parent);
  assert.ok(parentSees.has("Sports day"), "parent sees 'all' events");
  assert.ok(!parentSees.has("Staff training"), "parent never sees teacher-only events");
  assert.ok(parentSees.has("PTM briefing"), "parent sees parent-only events");
  assert.ok(parentSees.has("Class A1 excursion"), "parent sees events targeting their child's class");
  assert.ok(!parentSees.has("Class A2 rehearsal"), "parent does not see classes their children are not in");

  const teacherSees = await see(teacher);
  assert.ok(teacherSees.has("Staff training"), "teacher sees staff events");
  assert.ok(teacherSees.has("Class A2 rehearsal"), "teacher sees all class events in the institution");

  for (const id of [forAll, forTeachers, forParents, forClass, forOtherClass, draft]) {
    await admin.api("DELETE", `/api/calendar/${id}`);
  }
});

test("only calendar.manage may create or edit; the server enforces it", async () => {
  assert.equal((await teacher.api("POST", "/api/calendar", { title: "x", start_date: "2026-10-01" })).status, 403,
    "a teacher (calendar.view only) cannot create events");
  assert.equal((await student.api("POST", "/api/calendar", { title: "x", start_date: "2026-10-01" })).status, 403,
    "a student cannot create events");
  assert.equal((await parent.api("DELETE", "/api/calendar/1")).status, 403,
    "a parent cannot delete events");

  const victim = new Client(ctx.base);
  const victimName = "admin-a-cal-revoked";
  await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, victimName, require("bcryptjs").hashSync(PASSWORD, 10), "madrasa_admin", "Cal Revoked"]
  );
  await victim.login(victimName, PASSWORD);
  await admin.api("PUT", `/api/admin/permissions/users/${await userId(victimName)}`, { revoked: ["calendar.manage"] });
  try {
    assert.equal((await victim.api("POST", "/api/calendar", { title: "x", start_date: "2026-10-01" })).status, 403,
      "revoking calendar.manage blocks creation even for an administrator");
    assert.equal((await victim.api("GET", "/api/calendar")).status, 200, "viewing still works");
  } finally {
    await admin.api("PUT", `/api/admin/permissions/users/${await userId(victimName)}`, { revoked: [] });
  }
});

async function userId(username) {
  const row = await ctx.db.get("SELECT id FROM users WHERE username = ?", [username]);
  return row.id;
}

test("calendar writes are isolated per tenant", async () => {
  const mine = await admin.api("POST", "/api/calendar", { title: "A-only event", start_date: "2026-11-01", audience: "all" });
  assert.equal(mine.status, 200);
  // Tenant B's administrator cannot edit or delete it, and never sees it.
  assert.equal((await adminB.api("PATCH", `/api/calendar/${mine.data.id}`, { title: "hijack" })).status, 404);
  assert.equal((await adminB.api("DELETE", `/api/calendar/${mine.data.id}`)).status, 404);
  const listB = await adminB.api("GET", "/api/calendar");
  assert.ok(!(listB.data.events || []).some((e) => e.title === "A-only event"), "cross-tenant events are invisible");
  await admin.api("DELETE", `/api/calendar/${mine.data.id}`);
});

test("calendar validation rejects nonsense without writing anything", async () => {
  assert.equal((await admin.api("POST", "/api/calendar", { title: "", start_date: "2026-10-01" })).status, 400, "title required");
  assert.equal((await admin.api("POST", "/api/calendar", { title: "x", start_date: "31-12-2026" })).status, 400, "date format");
  assert.equal((await admin.api("POST", "/api/calendar", { title: "x", start_date: "2026-10-05", end_date: "2026-10-01" })).status, 400, "end before start");
  assert.equal((await admin.api("POST", "/api/calendar", { title: "x", start_date: "2026-10-01", audience: "specific_classes", target_ids: [99999] })).status, 400, "unknown class target");
  const count = await ctx.db.get("SELECT COUNT(*) AS n FROM calendar_events WHERE madrasa_id = ?", [ctx.madrasaA]);
  assert.equal(Number(count.n), 0, "no rows were written by invalid requests");
});
