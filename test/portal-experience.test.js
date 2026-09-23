"use strict";
/* ============================================================================
   STUDENT & PARENT PORTAL EXPERIENCE — tests
   ----------------------------------------------------------------------------
   The portal aggregates and family views built on the existing
   student/parent-scoped API: dashboards, assignment list/detail/submit
   (with resubmission), exams, contacts, library self-service, Qur'an
   progress visibility, teacher dashboard scoping, and the family-account
   messaging restriction. Every "trust" boundary (other children, other
   tenants, other classes) is tested from the outside.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();

let ctx;
let admin, adminB, teacher, student, parent, parentB, studentB;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base); await admin.login("admin-a", PASSWORD);
  teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
  student = new Client(ctx.base); await student.login("student-a1", PASSWORD);
  parent = new Client(ctx.base); await parent.login("parent-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  parentB = new Client(ctx.base); await parentB.login("parent-b", PASSWORD);

  // An account for B's student so cross-tenant boundaries can be probed.
  await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, student_id) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaB, "student-b1", require("bcryptjs").hashSync(PASSWORD, 10), "student", "Charlie Three", ctx.studentB1]
  );
  studentB = new Client(ctx.base); await studentB.login("student-b1", PASSWORD);
});
test.after(async () => { await ctx.close(); });

/* ------------------------------ dashboards ------------------------------- */

test("the student dashboard aggregates exactly the student's own context", async () => {
  const r = await student.api("GET", "/api/portal/dashboard");
  assert.equal(r.status, 200);
  const d = r.data;
  assert.equal(d.role, "student");
  assert.equal(d.children.length, 1, "a student has exactly one 'child' — themselves");
  const me = d.children[0];
  assert.equal(me.studentId, ctx.studentA1);
  assert.equal(me.className, "Class A1");
  assert.equal(me.attendance.total, 1);
  assert.equal(me.attendance.present, 1);
  assert.ok(me.fee && typeof me.fee.balance === "number", "fee summary included");
  assert.equal(d.madrasa.name_en, "Test Madrasa A");
});

test("the parent dashboard covers every linked child and nothing else", async () => {
  const r = await parent.api("GET", "/api/portal/dashboard");
  assert.equal(r.status, 200);
  const ids = r.data.children.map((c) => c.studentId).sort();
  assert.deepEqual(ids, [ctx.studentA1, ctx.studentA2].sort(), "both linked children");
  // Parent B is linked to B's student only.
  const rb = await parentB.api("GET", "/api/portal/dashboard");
  assert.deepEqual(rb.data.children.map((c) => c.studentId), [ctx.studentB1]);
});

test("staff cannot use the family dashboard; a student cannot use the teacher's", async () => {
  assert.equal((await teacher.api("GET", "/api/portal/dashboard")).status, 403, "teachers are refused on /portal/*");
  assert.equal((await admin.api("GET", "/api/portal/dashboard")).status, 403, "administrators are refused");
  assert.equal((await student.api("GET", "/api/teachers/dashboard")).status, 403, "students cannot see the teacher aggregate");
});

/* ----------------------------- assignments -------------------------------- */

test("a student sees their class assignments, submits, and can resubmit until graded", async () => {
  // Created by the teacher (assignments belong to their author; only the
  // owning teacher or an administrator grades submissions).
  const created = await teacher.api("POST", "/api/academic/assignments", {
    class_id: ctx.classA1, subject_id: ctx.subjA1, title: "Fiqh homework 1", session_id: ctx.sessionA, term_id: ctx.termA1,
    assigned_date: "2026-09-20", due_date: "2030-12-31", maximum_score: 20, status: "published", details: "Answer all questions",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.id;

  const list = await student.api("GET", "/api/portal/assignments");
  assert.equal(list.status, 200);
  const mine = (list.data.assignments || []).find((a) => a.id === id);
  assert.ok(mine, "published class assignments are listed");
  assert.equal(mine.submission, null, "nothing submitted yet");
  assert.equal(mine.canSubmit, true, "submission is open while published and not past due");

  const detail = await student.api("GET", `/api/portal/assignments/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.assignment.maximumScore, 20);
  assert.equal(detail.data.canSubmit, true);

  const submit = await student.api("POST", `/api/academic/assignments/${id}/submissions/me`, { submission_text: "My answers" });
  assert.equal(submit.status, 200);
  const after = await student.api("GET", `/api/portal/assignments/${id}`);
  assert.equal(after.data.submission.status, "submitted");
  assert.equal(after.data.canSubmit, true, "resubmission is permitted while ungraded");

  const resubmit = await student.api("POST", `/api/academic/assignments/${id}/submissions/me`, { submission_text: "Corrected answers" });
  assert.equal(resubmit.status, 200);
  const after2 = await student.api("GET", `/api/portal/assignments/${id}`);
  assert.equal(after2.data.submission.submission_text, "Corrected answers", "resubmission replaces the text");

  // Grading releases it; the portal shows score + feedback and stops resubmission.
  const grade = await teacher.api("PUT", `/api/academic/assignments/${id}/submissions/${ctx.studentA1}`, { score: 18, feedback: "Excellent work" });
  assert.equal(grade.status, 200);
  const graded = await student.api("GET", `/api/portal/assignments/${id}`);
  assert.equal(graded.data.submission.status, "graded");
  assert.equal(graded.data.submission.score, 18);
  assert.equal(graded.data.submission.feedback, "Excellent work");

  // Draft and closed assignments are invisible; other classes are invisible.
  const draft = await admin.api("POST", "/api/academic/assignments", {
    class_id: ctx.classA1, subject_id: ctx.subjA1, title: "Draft homework", session_id: ctx.sessionA, term_id: ctx.termA1, assigned_date: "2026-09-20", due_date: "2030-12-31", status: "draft",
  });
  assert.equal(draft.status, 200);
  const bClassAssignment = await adminB.api("POST", "/api/academic/assignments", {
    class_id: ctx.classB1, subject_id: ctx.subjB1, title: "B homework", session_id: (await ctx.db.get("SELECT id FROM academic_sessions WHERE madrasa_id = ?", [ctx.madrasaB])).id, term_id: (await ctx.db.get("SELECT id FROM terms WHERE madrasa_id = ? AND position = 1", [ctx.madrasaB])).id, assigned_date: "2026-09-20", due_date: "2030-12-31", status: "published",
  });
  assert.equal(bClassAssignment.status, 200);
  const list2 = await student.api("GET", "/api/portal/assignments");
  const titles = (list2.data.assignments || []).map((a) => a.title);
  assert.ok(!titles.includes("Draft homework"), "drafts are hidden");
  assert.ok(!titles.includes("B homework"), "another tenant's assignment is invisible");
  assert.equal((await student.api("GET", `/api/portal/assignments/${bClassAssignment.data.id}`)).status, 404,
    "existence is not leaked across tenants");
});

test("a parent follows a linked child's assignments but cannot read another child's", async () => {
  const created = await admin.api("POST", "/api/academic/assignments", {
    class_id: ctx.classA1, subject_id: ctx.subjA1, title: "Fiqh homework 2", session_id: ctx.sessionA, term_id: ctx.termA1,
    assigned_date: "2026-09-21", due_date: "2030-12-31", status: "published",
  });
  assert.equal(created.status, 200);
  const mine = await parent.api("GET", `/api/portal/assignments?studentId=${ctx.studentA1}`);
  assert.equal(mine.status, 200);
  assert.ok((mine.data.assignments || []).some((a) => a.id === created.data.id), "the child's assignments are listed");

  assert.equal((await parent.api("GET", `/api/portal/assignments?studentId=${ctx.studentB1}`)).status, 404,
    "another tenant's child is not found");
  assert.equal((await parent.api("GET", `/api/portal/assignments?studentId=999999`)).status, 404);
  assert.equal((await parent.api("GET", `/api/portal/assignments`)).status, 404,
    "a parent must name the child");
});

/* -------------------------------- exams ----------------------------------- */

test("the exam timetable shows the class's scheduled sittings only", async () => {
  const created = await admin.api("POST", "/api/academic/exams", {
    class_id: ctx.classA1, subject_id: ctx.subjA1, session_id: ctx.sessionA, term_id: ctx.termA1,
    title: "Fiqh mid-term", exam_date: "2030-10-10", total_marks: 40, status: "published", start_time: "09:00", end_time: "11:00",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const r = await student.api("GET", "/api/portal/exams");
  assert.equal(r.status, 200);
  assert.ok((r.data.exams || []).some((e) => e.title === "Fiqh mid-term"));
  assert.ok((r.data.exams || []).every((e) => ["scheduled", "ongoing", "published"].includes(e.status)),
    "cancelled and draft sittings never appear");
  assert.equal((await studentB.api("GET", "/api/portal/exams")).data.exams.every((e) => e.title !== "Fiqh mid-term"), true,
    "B's student never sees A's exam");
});

/* -------------------------------- contacts --------------------------------- */

test("portal contacts list exactly the teachers of the student's classes plus administrators", async () => {
  const r = await student.api("GET", "/api/portal/contacts");
  assert.equal(r.status, 200);
  const roles = new Set(r.data.contacts.map((c) => c.role));
  assert.ok([...roles].every((x) => ["madrasa_admin", "teacher"].includes(x)), "family accounts only see staff contacts");
  assert.ok(r.data.contacts.some((c) => c.role === "teacher"), "the class teacher is listed");
  assert.ok(r.data.contacts.some((c) => c.role === "madrasa_admin"), "the administrator is listed");
});

test("family accounts can only message staff — the backend refuses anything else", async () => {
  const msgToAdmin = await student.api("POST", "/api/communication/messages", { subject: "Question", body: "Salaam", recipient_user_ids: [ctx.users.adminA] });
  assert.equal(msgToAdmin.status, 200, "student → administrator is allowed");
  const msgToTeacher = await parent.api("POST", "/api/communication/messages", { body: "About homework", recipient_user_ids: [ctx.users.teacherA] });
  assert.equal(msgToTeacher.status, 200, "parent → teacher is allowed");
  assert.equal((await student.api("POST", "/api/communication/messages", { body: "hi", recipient_user_ids: [ctx.users.parentUserA || (await uid("parent-a"))] })).status, 400,
    "student → parent is refused");
  const otherStudent = await ctx.db.get("SELECT id FROM users WHERE username = 'student-b1'");
  assert.equal((await student.api("POST", "/api/communication/messages", { body: "hi", recipient_user_ids: [otherStudent.id] })).status, 400,
    "student → another student is refused");
  assert.equal((await parent.api("POST", "/api/communication/messages", { body: "hi", recipient_user_ids: [otherStudent.id] })).status, 400,
    "parent → someone else's child is refused");
});

async function uid(username) {
  return (await ctx.db.get("SELECT id FROM users WHERE username = ?", [username])).id;
}

/* -------------------------------- library ---------------------------------- */

test("library self-service shows only the caller's own loans", async () => {
  // Alpha One (student-a1) borrows a book.
  const book = await admin.api("POST", "/api/library/books", { title: "Tafsir vol.1", total_copies: 2 });
  assert.equal(book.status, 200);
  const studentUser = await ctx.db.get("SELECT id FROM users WHERE username = 'student-a1'");
  const issue = await admin.api("POST", "/api/library/loans", { book_id: book.data.id, borrower_user_id: studentUser.id, borrower_type: "student" });
  assert.equal(issue.status, 200, JSON.stringify(issue.data));

  const mine = await student.api("GET", "/api/library/my-loans");
  assert.equal(mine.status, 200);
  assert.equal(mine.data.summary.active, 1);
  assert.ok(mine.data.loans.some((l) => l.title === "Tafsir vol.1"));

  const parentView = await parent.api("GET", "/api/library/my-loans");
  assert.ok(parentView.data.loans.some((l) => l.title === "Tafsir vol.1"), "the parent sees the child's loan");

  const otherStudentView = await studentB.api("GET", "/api/library/my-loans");
  assert.equal(otherStudentView.data.summary.active, 0, "another student's loans are not visible");

  const teacherView = await teacher.api("GET", "/api/library/my-loans");
  assert.equal(teacherView.status, 200, "staff can check their own borrowing record");
  assert.equal(teacherView.data.summary.active, 0);

  assert.equal((await admin.api("GET", "/api/library/my-loans")).status, 403,
    "administrators use the loans register instead");
});

/* ---------------------------- quran progress -------------------------------- */

test("Qur'an progress is readable by the family but never writable, and only for Islamic institutions", async () => {
  const rec = await admin.api("POST", "/api/quran-progress", {
    student_id: ctx.studentA1, surah: "Al-Baqarah", juz: "2", memorization_progress: 40, revision_progress: 20,
  });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));

  const mine = await student.api("GET", "/api/quran-progress/me");
  assert.equal(mine.status, 200);
  assert.ok((mine.data.records || []).some((r) => r.surah === "Al-Baqarah"));

  const parentView = await parent.api("GET", "/api/quran-progress/me");
  assert.ok((parentView.data.records || []).some((r) => r.student_id === ctx.studentA1));

  assert.equal((await teacher.api("GET", "/api/quran-progress/me")).status, 403,
    "staff use the management workspace, not the family view");

  // A Western academy must not expose the family view at all (category gate).
  await ctx.db.run("UPDATE madaris SET category = 'western' WHERE id = ?", [ctx.madrasaA]);
  try {
    assert.equal((await student.api("GET", "/api/quran-progress/me")).status, 404, "Western institutions have no Qur'an module");
  } finally {
    await ctx.db.run("UPDATE madaris SET category = 'islamic' WHERE id = ?", [ctx.madrasaA]);
  }
});

/* --------------------------- teacher dashboard ------------------------------ */

test("the teacher dashboard is scoped to the teacher's own assignments", async () => {
  const r = await teacher.api("GET", "/api/teachers/dashboard");
  assert.equal(r.status, 200);
  const d = r.data;
  // teacher-a is assigned Class A1 (Fiqh) only.
  assert.deepEqual(d.classes.map((c) => c.name_en), ["Class A1"]);
  assert.ok(d.classes.every((c) => c.name_en !== "Class A2"), "classes they are not assigned to never appear");
  assert.ok(Array.isArray(d.todaySlots), "timetable for today is included");
  assert.ok(Array.isArray(d.assignmentsPending), "grading queue is included");
  assert.ok(["draft", "submitted", "returned", "approved", "published"].every((k) => typeof d.resultCounts[k] === "number"));
  assert.ok(typeof d.unreadNotifications === "number");

  // A second teacher with no assignments gets an empty (not broken) dashboard.
  const b2 = require("bcryptjs");
  await ctx.db.run("INSERT INTO users (madrasa_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)",
    [ctx.madrasaA, "teacher-unassigned", b2.hashSync(PASSWORD, 10), "teacher", "Unassigned Teacher"]);
  const unassigned = new Client(ctx.base);
  await unassigned.login("teacher-unassigned", PASSWORD);
  const ru = await unassigned.api("GET", "/api/teachers/dashboard");
  assert.equal(ru.status, 200);
  assert.deepEqual(ru.data.classes, []);
  assert.deepEqual(ru.data.subjects, []);
});
