"use strict";
/* ============================================================================
   PARENT-TEACHER MEETINGS — API tests
   ----------------------------------------------------------------------------
   Covers: the migration tables, session creation with the automatically
   derived slot grid, validation, status transitions (draft -> open -> closed),
   teacher availability opt-in/opt-out, the parent booking flow (children ->
   their teachers -> free slots -> confirmation), every double-booking rule,
   cancellation by parent and by admin, the admin booking grid, the CSV export,
   the in-app notifications sent to both sides, role rules, and madrasa_id
   tenant isolation in both directions.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client } = require("./helpers");

// initEnv() MUST run before any server module is required, otherwise
// server/db binds to the real database file instead of the throwaway one.
initEnv();
const ptm = require("../server/routes/ptm");

let ctx;
let adminA, adminB, teacherA, parentA, parentB, studentA1;
const U = "Passw0rd!123";

function dayOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A fresh open meeting session for madrasa A, with its id. */
async function makeSession(client, overrides = {}) {
  const r = await client.api("POST", "/api/ptm", Object.assign({
    title: "First Term Parent-Teacher Meeting",
    date: dayOffset(14),
    session_start: "09:00",
    session_end: "10:00",
    slot_duration_mins: 10,
    location: "Main hall",
    status: "open",
  }, overrides));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}

test.before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  parentA = new Client(ctx.base);
  parentB = new Client(ctx.base);
  studentA1 = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", U)).status, 200);
  assert.equal((await adminB.login("admin-b", U)).status, 200);
  assert.equal((await teacherA.login("teacher-a", U)).status, 200);
  assert.equal((await parentA.login("parent-a", U)).status, 200);
  assert.equal((await parentB.login("parent-b", U)).status, 200);
  assert.equal((await studentA1.login("student-a1", U)).status, 200);
});
test.after(async () => { await ctx.close(); });

/* ------------------------------- migration ------------------------------- */

test("migration created the three PTM tables, empty per tenant", async () => {
  for (const table of ["ptm_sessions", "ptm_teacher_slots", "ptm_bookings"]) {
    const row = await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE madrasa_id = ?`, [ctx.madrasaA]);
    assert.equal(Number(row.n), 0, `${table} starts empty`);
  }
});

/* ---------------------------- the derived grid ---------------------------- */

test("the slot grid is derived from start/end/duration", () => {
  const grid = ptm.slotGrid({ session_start: "09:00", session_end: "10:00", slot_duration_mins: 15 });
  assert.equal(grid.length, 4);
  assert.deepEqual(grid[0], { slot_number: 1, start: "09:00", end: "09:15" });
  assert.deepEqual(grid[3], { slot_number: 4, start: "09:45", end: "10:00" });
  // A trailing part-slot is never offered.
  assert.equal(ptm.slotGrid({ session_start: "09:00", session_end: "09:25", slot_duration_mins: 10 }).length, 2);
  // MySQL hands back HH:MM:SS; SQLite hands back HH:MM. Both must parse.
  assert.equal(ptm.toMinutes("09:30:00"), 570);
  assert.equal(ptm.toMinutes("09:30"), 570);
  assert.equal(ptm.toMinutes("nonsense"), null);
  assert.equal(ptm.toHHMM(570), "09:30");
  // A backwards or empty window yields no slots rather than throwing.
  assert.deepEqual(ptm.slotGrid({ session_start: "10:00", session_end: "09:00", slot_duration_mins: 10 }), []);
});

/* --------------------------- admin: create/edit --------------------------- */

test("admin creates a session; slots and teacher participation are generated", async () => {
  const created = await adminA.api("POST", "/api/ptm", {
    title: "Mid-Term Meeting", date: dayOffset(10),
    session_start: "09:00", session_end: "11:00", slot_duration_mins: 20,
    location: "Assembly hall", term_id: ctx.termA1, status: "draft",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.slots.length, 6);
  assert.equal(created.data.session.status, "draft");
  assert.equal(created.data.session.slot_duration_mins, 20);
  // Teacher A was enrolled automatically and defaults to available.
  const part = await ctx.db.get(
    "SELECT * FROM ptm_teacher_slots WHERE madrasa_id = ? AND ptm_session_id = ? AND teacher_user_id = ?",
    [ctx.madrasaA, created.data.id, ctx.users.teacherA]
  );
  assert.ok(part, "teacher A enrolled");
  assert.equal(Number(part.available), 1);
  // The row is written to this tenant only.
  assert.equal(Number(part.madrasa_id), ctx.madrasaA);
});

test("create validates title, date, times and the window length", async () => {
  const bad = [
    [{ title: "" }, "title"],
    [{ date: "not-a-date" }, "date"],
    [{ session_start: "99:99" }, "start"],
    [{ session_end: "abc" }, "end"],
    [{ session_start: "11:00", session_end: "09:00" }, "order"],
    [{ session_start: "09:00", session_end: "09:05", slot_duration_mins: 60 }, "too short"],
    [{ status: "archived" }, "status"],
    [{ term_id: 99999 }, "term"],
  ];
  for (const [patch, label] of bad) {
    const r = await adminA.api("POST", "/api/ptm", Object.assign({
      title: "Valid", date: dayOffset(5), session_start: "09:00", session_end: "10:00", slot_duration_mins: 10,
    }, patch));
    assert.equal(r.status, 400, `rejects ${label}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error, `an error message for ${label}`);
  }
});

test("only administrators may create or edit a session", async () => {
  const body = { title: "Teacher tries", date: dayOffset(5), session_start: "09:00", session_end: "10:00" };
  assert.equal((await teacherA.api("POST", "/api/ptm", body)).status, 403);
  assert.equal((await parentA.api("POST", "/api/ptm", body)).status, 403);
  assert.equal((await studentA1.api("POST", "/api/ptm", body)).status, 403);
  const id = await makeSession(adminA);
  assert.equal((await teacherA.api("PATCH", `/api/ptm/${id}`, { status: "closed" })).status, 403);
  assert.equal((await parentA.api("PATCH", `/api/ptm/${id}`, { status: "closed" })).status, 403);
});

test("an unauthenticated caller gets 401 on every PTM endpoint", async () => {
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/ptm")).status, 401);
  assert.equal((await anon.req("GET", "/api/ptm/mine")).status, 401);
  assert.equal((await anon.api("POST", "/api/ptm/bookings", {})).status, 401);
});

test("admin edits a session and opens it, and drafts stay hidden from families", async () => {
  const id = await makeSession(adminA, { status: "draft", title: "Draft meeting" });
  // A parent cannot see a draft at all.
  const listed = await parentA.req("GET", "/api/ptm");
  assert.ok(!(listed.data.sessions || []).some((s) => s.id === id), "draft hidden from the parent list");
  assert.equal((await parentA.req("GET", `/api/ptm/${id}`)).status, 404);

  const edited = await adminA.api("PATCH", `/api/ptm/${id}`, { title: "Renamed meeting", location: "Library", status: "open" });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.session.title, "Renamed meeting");
  assert.equal(edited.data.session.location, "Library");
  assert.equal(edited.data.session.status, "open");
  assert.equal((await parentA.req("GET", `/api/ptm/${id}`)).status, 200);
});

/* --------------------------- teacher availability ------------------------- */

test("a teacher opts out and back in for their own session only", async () => {
  const id = await makeSession(adminA);
  const mine = await teacherA.req("GET", "/api/ptm/mine");
  assert.equal(mine.status, 200);
  assert.ok(mine.data.sessions.some((s) => s.id === id), "the session is in the teacher's list");

  const out = await teacherA.api("POST", `/api/ptm/${id}/availability`, { available: false });
  assert.equal(out.status, 200);
  assert.equal(out.data.available, false);
  const row = await ctx.db.get("SELECT available FROM ptm_teacher_slots WHERE ptm_session_id = ? AND teacher_user_id = ?", [id, ctx.users.teacherA]);
  assert.equal(Number(row.available), 0);

  // While opted out the teacher is not offered to parents.
  const slots = await parentA.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`);
  assert.equal(slots.status, 409);

  const back = await teacherA.api("POST", `/api/ptm/${id}/availability`, { available: true });
  assert.equal(back.status, 200);
  assert.equal(back.data.available, true);

  // Non-teachers have no participation list.
  assert.equal((await parentA.req("GET", "/api/ptm/mine")).status, 403);
  assert.equal((await adminA.req("GET", "/api/ptm/mine")).status, 403);
});

test("a teacher cannot change another teacher's availability", async () => {
  const id = await makeSession(adminA);
  const otherId = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, `teacher-a-extra-${id}`, "x", "teacher", "Teacher A Extra"]
  )).lastInsertRowid;
  const r = await teacherA.api("POST", `/api/ptm/${id}/availability`, { teacher_user_id: otherId, available: false });
  assert.equal(r.status, 403);
  // The administrator may, though.
  const admin = await adminA.api("POST", `/api/ptm/${id}/availability`, { teacher_user_id: otherId, available: false });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.available, false);
});

/* ------------------------------ parent booking ---------------------------- */

test("a parent sees only their own children and those children's teachers", async () => {
  const id = await makeSession(adminA);
  const r = await parentA.req("GET", `/api/ptm/${id}/teachers`);
  assert.equal(r.status, 200);
  const ids = r.data.children.map((c) => c.id).sort();
  assert.deepEqual(ids, [ctx.studentA1, ctx.studentA2].sort(), "exactly the two linked children");
  const child = r.data.children.find((c) => c.id === ctx.studentA1);
  assert.ok(child.teachers.some((t) => t.id === ctx.users.teacherA), "teacher A teaches class A1");
  // The subject list comes from the existing teacher_assignments rows.
  const tA = child.teachers.find((t) => t.id === ctx.users.teacherA);
  assert.deepEqual(tA.subjects, ["Fiqh"]);
});

test("a parent books a slot and gets a confirmation with date, time and location", async () => {
  const id = await makeSession(adminA, { location: "Main hall", date: dayOffset(21) });
  const slots = await parentA.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`);
  assert.equal(slots.status, 200);
  assert.equal(slots.data.slots.length, 6);
  assert.ok(slots.data.slots.every((s) => s.available), "everything is free before the first booking");

  const booked = await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 3,
  });
  assert.equal(booked.status, 200, JSON.stringify(booked.data));
  const c = booked.data.confirmation;
  assert.equal(c.slot_number, 3);
  assert.equal(c.slot_time, "09:20");
  assert.equal(c.slot_end, "09:30");
  assert.equal(c.location, "Main hall");
  assert.equal(c.date, dayOffset(21));
  assert.equal(c.teacher_name, "Teacher A");
  assert.equal(c.student_name, "Alpha One");
  assert.match(c.summary, /09:20/);

  // The stored row carries the tenant and the resolved slot time.
  const row = await ctx.db.get("SELECT * FROM ptm_bookings WHERE id = ?", [booked.data.id]);
  assert.equal(Number(row.madrasa_id), ctx.madrasaA);
  assert.equal(String(row.slot_time).slice(0, 5), "09:20");
  assert.equal(row.status, "booked");

  // That slot is no longer offered.
  const after = await parentA.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`);
  const slot3 = after.data.slots.find((s) => s.slot_number === 3);
  assert.equal(slot3.available, false);
  assert.equal(slot3.taken, true);
});

test("both the parent and the teacher receive an in-app notification", async () => {
  const id = await makeSession(adminA);
  const booked = await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 1,
  });
  assert.equal(booked.status, 200);
  const notes = await ctx.db.all(
    "SELECT * FROM notifications WHERE madrasa_id = ? AND type = 'ptm_booking' AND entity_id = ?",
    [ctx.madrasaA, booked.data.id]
  );
  assert.equal(notes.length, 2, "exactly two notifications — one each");
  const parentUserA = (await ctx.db.get("SELECT id FROM users WHERE madrasa_id = ? AND username = 'parent-a'", [ctx.madrasaA])).id;
  const recipients = notes.map((n) => Number(n.recipient_user_id)).sort((a, b) => a - b);
  assert.deepEqual(recipients, [parentUserA, ctx.users.teacherA].sort((a, b) => a - b), "the parent and the teacher");
  for (const n of notes) {
    assert.match(n.title, /Parent-teacher meeting/i);
    assert.match(n.body, /09:00/, "the body carries the time");
    assert.equal(Number(n.madrasa_id), ctx.madrasaA);
  }
});

test("double-booking is refused in all three directions", async () => {
  const id = await makeSession(adminA);
  const book = (body) => parentA.api("POST", "/api/ptm/bookings", Object.assign({ ptm_session_id: id, teacher_user_id: ctx.users.teacherA }, body));

  assert.equal((await book({ student_id: ctx.studentA1, slot_number: 2 })).status, 200);
  // Same teacher, same slot, other child -> the teacher is busy.
  const teacherClash = await book({ student_id: ctx.studentA2, slot_number: 2 });
  assert.equal(teacherClash.status, 409);
  assert.match(teacherClash.data.error, /taken|already/i);
  // Same parent, same slot, a different teacher -> the parent is busy.
  const other = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, `teacher-clash-${id}`, "x", "teacher", "Teacher Clash"]
  )).lastInsertRowid;
  await ctx.db.run("INSERT INTO teacher_assignments (madrasa_id,user_id,class_id,subject_id) VALUES (?,?,?,?)", [ctx.madrasaA, other, ctx.classA1, ctx.subjA1]);
  await ctx.db.run("INSERT INTO ptm_teacher_slots (madrasa_id,ptm_session_id,teacher_user_id,available) VALUES (?,?,?,1)", [ctx.madrasaA, id, other]);
  const parentClash = await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: other, student_id: ctx.studentA1, slot_number: 2,
  });
  assert.equal(parentClash.status, 409);
  assert.match(parentClash.data.error, /already have a meeting/i);
  // Same parent + teacher + child at another time -> duplicate meeting.
  const duplicate = await book({ student_id: ctx.studentA1, slot_number: 4 });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.error, /already have a meeting with this teacher/i);
  // A different time with the other teacher is fine.
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: other, student_id: ctx.studentA1, slot_number: 5,
  })).status, 200);
});

test("booking validation: unknown slot, closed session, foreign child, wrong teacher, wrong role", async () => {
  const id = await makeSession(adminA);
  const base = { ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1 };

  assert.equal((await parentA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 99 }))).status, 400);
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 0 }))).status, 400);
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", { slot_number: 1 })).status, 400);
  // Another madrasa's child.
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { student_id: ctx.studentB1, slot_number: 1 }))).status, 404);
  // A teacher who does not teach the child.
  const stranger = (await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, `teacher-stranger-${id}`, "x", "teacher", "Teacher Stranger"]
  )).lastInsertRowid;
  await ctx.db.run("INSERT INTO ptm_teacher_slots (madrasa_id,ptm_session_id,teacher_user_id,available) VALUES (?,?,?,1)", [ctx.madrasaA, id, stranger]);
  const wrongTeacher = await parentA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { teacher_user_id: stranger, slot_number: 1 }));
  assert.equal(wrongTeacher.status, 403);

  // Only a parent account books.
  assert.equal((await teacherA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 1 }))).status, 403);
  assert.equal((await studentA1.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 1 }))).status, 403);
  assert.equal((await adminA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 1 }))).status, 403);
  // A closed session takes no bookings.
  assert.equal((await adminA.api("PATCH", `/api/ptm/${id}`, { status: "closed" })).status, 200);
  const closed = await parentA.api("POST", "/api/ptm/bookings", Object.assign({}, base, { slot_number: 1 }));
  assert.equal(closed.status, 409);
  assert.match(closed.data.error, /not open/i);
});

test("a student account cannot browse or book meetings", async () => {
  const id = await makeSession(adminA);
  assert.equal((await studentA1.req("GET", `/api/ptm/${id}/teachers`)).status, 403);
  assert.equal((await studentA1.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`)).status, 403);
});

/* -------------------------------- cancelling ------------------------------ */

test("the parent cancels their own booking and the slot frees up", async () => {
  const id = await makeSession(adminA);
  const booked = await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 2,
  });
  assert.equal(booked.status, 200);
  const cancelled = await parentA.api("DELETE", `/api/ptm/bookings/${booked.data.id}`);
  assert.equal(cancelled.status, 200);
  const row = await ctx.db.get("SELECT status FROM ptm_bookings WHERE id = ?", [booked.data.id]);
  assert.equal(row.status, "cancelled");
  // Freed, and re-bookable.
  const slots = await parentA.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`);
  assert.equal(slots.data.slots.find((s) => s.slot_number === 2).available, true);
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 2,
  })).status, 200);
  // Cancelling twice is refused.
  assert.equal((await parentA.api("DELETE", `/api/ptm/bookings/${booked.data.id}`)).status, 409);
});

test("an administrator can cancel any booking, another parent cannot", async () => {
  const id = await makeSession(adminA);
  const booked = await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 1,
  });
  assert.equal(booked.status, 200);
  // A parent from the other madrasa may not even learn it exists.
  assert.equal((await parentB.api("DELETE", `/api/ptm/bookings/${booked.data.id}`)).status, 404);
  assert.equal((await teacherA.api("DELETE", `/api/ptm/bookings/${booked.data.id}`)).status, 404);
  assert.equal((await adminA.api("DELETE", `/api/ptm/bookings/${booked.data.id}`)).status, 200);
});

test("shrinking the window is refused while it would strand a booking", async () => {
  const id = await makeSession(adminA, { session_start: "09:00", session_end: "10:00", slot_duration_mins: 10 });
  assert.equal((await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 6,
  })).status, 200);
  const shrink = await adminA.api("PATCH", `/api/ptm/${id}`, { session_end: "09:30" });
  assert.equal(shrink.status, 409);
  assert.match(shrink.data.error, /outside the new time window/i);
  // Moving the window keeps the booking and rewrites its time.
  const moved = await adminA.api("PATCH", `/api/ptm/${id}`, { session_start: "14:00", session_end: "15:00" });
  assert.equal(moved.status, 200);
  const row = await ctx.db.get("SELECT slot_time FROM ptm_bookings WHERE madrasa_id = ? AND ptm_session_id = ? AND slot_number = 6", [ctx.madrasaA, id]);
  assert.equal(String(row.slot_time).slice(0, 5), "14:50");
});

/* ------------------------- admin grid, export, teacher -------------------- */

test("the admin booking grid shows teachers as columns and bookings in cells", async () => {
  const id = await makeSession(adminA);
  await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA2, slot_number: 4,
  });
  const grid = await adminA.req("GET", `/api/ptm/${id}/schedule`);
  assert.equal(grid.status, 200);
  assert.equal(grid.data.grid.length, 6);
  assert.ok(grid.data.teachers.some((t) => t.id === ctx.users.teacherA));
  const col = grid.data.teachers.findIndex((t) => t.id === ctx.users.teacherA);
  const cell = grid.data.grid.find((r) => r.slot_number === 4).cells[col];
  assert.ok(cell.booking_id);
  assert.equal(cell.student_name, "Bravo Two");
  assert.equal(cell.parent_name, "Guardian A");
  assert.equal(grid.data.stats.booked, 1);
  // Families never see the whole grid.
  assert.equal((await parentA.req("GET", `/api/ptm/${id}/schedule`)).status, 403);
  assert.equal((await teacherA.req("GET", `/api/ptm/${id}/schedule`)).status, 403);
});

test("the CSV export lists the bookings for administrators only", async () => {
  const id = await makeSession(adminA);
  await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 1,
  });
  const res = await adminA.req("GET", `/api/ptm/${id}/export.csv`);
  assert.equal(res.status, 200);
  assert.match(res.res.headers.get("content-type") || "", /csv/);
  const text = await res.res.text();
  assert.match(text, /Teacher/);
  assert.match(text, /Alpha One/);
  assert.match(text, /Guardian A/);
  assert.equal((await parentA.req("GET", `/api/ptm/${id}/export.csv`)).status, 403);
});

test("the teacher's own list carries their bookings with the parent's contact", async () => {
  const id = await makeSession(adminA);
  await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 5,
  });
  const mine = await teacherA.req("GET", "/api/ptm/mine");
  assert.equal(mine.status, 200);
  const session = mine.data.sessions.find((s) => s.id === id);
  assert.ok(session, "the session is listed");
  assert.equal(session.slots.length, 6);
  const booking = session.bookings.find((b) => b.slot_number === 5);
  assert.ok(booking);
  assert.equal(booking.parent_name, "Guardian A");
  assert.equal(booking.first_name, "Alpha");
});

/* ---------------------------- tenant isolation ---------------------------- */

test("madrasa B can never see, read, edit or book madrasa A's meeting", async () => {
  const id = await makeSession(adminA);
  await parentA.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentA1, slot_number: 1,
  });
  // Not in B's list.
  const listB = await adminB.req("GET", "/api/ptm");
  assert.ok(!(listB.data.sessions || []).some((s) => s.id === id), "A's session is absent from B's list");
  // Every direct read/write answers 404 — existence is not leaked.
  assert.equal((await adminB.req("GET", `/api/ptm/${id}`)).status, 404);
  assert.equal((await adminB.req("GET", `/api/ptm/${id}/schedule`)).status, 404);
  assert.equal((await adminB.req("GET", `/api/ptm/${id}/export.csv`)).status, 404);
  assert.equal((await adminB.api("PATCH", `/api/ptm/${id}`, { status: "closed" })).status, 404);
  assert.equal((await adminB.api("POST", `/api/ptm/${id}/availability`, { teacher_user_id: ctx.users.teacherA })).status, 404);
  assert.equal((await parentB.req("GET", `/api/ptm/${id}/teachers`)).status, 404);
  assert.equal((await parentB.req("GET", `/api/ptm/${id}/available-slots?teacherId=${ctx.users.teacherA}`)).status, 404);
  assert.equal((await parentB.api("POST", "/api/ptm/bookings", {
    ptm_session_id: id, teacher_user_id: ctx.users.teacherA, student_id: ctx.studentB1, slot_number: 2,
  })).status, 404);
  // And A cannot reach B's session either.
  const idB = (await adminB.api("POST", "/api/ptm", {
    title: "B meeting", date: dayOffset(9), session_start: "09:00", session_end: "10:00", status: "open",
  })).data.id;
  assert.equal((await adminA.req("GET", `/api/ptm/${idB}`)).status, 404);
  assert.equal((await parentA.req("GET", `/api/ptm/${idB}/teachers`)).status, 404);
  // Nothing crossed over in the database.
  const crossed = await ctx.db.get(
    "SELECT COUNT(*) AS n FROM ptm_bookings b JOIN ptm_sessions p ON p.id = b.ptm_session_id WHERE b.madrasa_id <> p.madrasa_id"
  );
  assert.equal(Number(crossed.n), 0, "no booking points at another tenant's session");
});

test("a Western academy uses the identical engine and endpoints", async () => {
  // The category only changes wording in the browser; the API must behave the
  // same. Flip madrasa B and run the same admin flow end to end.
  await ctx.db.run("UPDATE madaris SET category = 'western' WHERE id = ?", [ctx.madrasaB]);
  const westernAdmin = new Client(ctx.base);
  assert.equal((await westernAdmin.login("admin-b", U)).status, 200);
  const created = await westernAdmin.api("POST", "/api/ptm", {
    title: "Fall Parent-Teacher Conference", date: dayOffset(12),
    session_start: "13:00", session_end: "14:00", slot_duration_mins: 15, location: "Gym", status: "open",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.slots.length, 4);
  assert.equal(created.data.session.status, "open");
  const grid = await westernAdmin.req("GET", `/api/ptm/${created.data.id}/schedule`);
  assert.equal(grid.status, 200);
  assert.equal(grid.data.grid.length, 4);
  assert.equal(grid.data.grid[0].start, "13:00");
  await ctx.db.run("UPDATE madaris SET category = 'islamic' WHERE id = ?", [ctx.madrasaB]);
});

/* ------------------------------- regressions ------------------------------ */

test("existing endpoints still answer normally alongside the PTM module", async () => {
  for (const path of ["/api/students", "/api/classes", "/api/teachers", "/api/notifications", "/api/announcements"]) {
    const r = await adminA.req("GET", path);
    assert.ok(r.status === 200, `${path} -> ${r.status}`);
  }
  assert.equal((await adminA.req("GET", "/api/ptm/does-not-exist-at-all/schedule")).status, 400);
  assert.equal((await adminA.req("GET", "/api/ptm/999999")).status, 404);
});
