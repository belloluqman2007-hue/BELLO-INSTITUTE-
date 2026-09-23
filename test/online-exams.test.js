"use strict";
/* ============================================================================
   ONLINE EXAMINATION TESTS
   ----------------------------------------------------------------------------
   Covers the whole lifecycle and its security invariants:
     • teachers need the exams.create permission to create exams
     • an online exam needs questions before it can be published
     • students see/take only their own class's online exams
     • one attempt per student, no duplicates, locked submissions
     • server-side timing: expired attempts cannot be written to
     • objective auto-grading + teacher grading of subjective answers
     • correct answers never reach a student before results are released
     • tenant isolation for students, teachers and parents
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

const today = () => new Date().toISOString().slice(0, 10);

// The exams module refuses timetable clashes (same class, overlapping time on
// the same day), so every exam the tests create gets its own 30-minute slot.
let slot = 0;
function nextWindow() {
  slot += 1;
  const startMin = (slot * 37) % (22 * 60);
  const endMin = startMin + 29;
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start_time: fmt(startMin), end_time: fmt(endMin) };
}

async function createOnlineExam(client, over = {}) {
  const csrf = await client.csrf();
  const body = Object.assign({
    title: "Fiqh Online Test",
    class_id: ctx.classA1, subject_id: ctx.subjA1,
    session_id: ctx.sessionA, term_id: ctx.termA1,
    exam_date: today(), ...nextWindow(),
    status: "draft", mode: "online", instructions: "Answer all questions.",
  }, over);
  return client.req("POST", "/api/academic/exams", body, { headers: { "X-CSRF-Token": csrf } });
}

/** Seeds a TAKEABLE online exam directly (the timetable-conflict rule means
 *  only one same-class exam can be open per moment via the API — a real
 *  business rule the create/patch tests above already cover). The question,
 *  attempt and grading routes used below are still exercised over HTTP. */
async function seedTakeableExam(title, over = {}) {
  const cols = {
    title, mode: "online", status: "published",
    class_id: ctx.classA1, subject_id: ctx.subjA1, session_id: ctx.sessionA, term_id: ctx.termA1,
    exam_date: today(), start_time: "00:00", end_time: "23:59",
    total_marks: 7, instructions: "Answer all questions.",
  };
  Object.assign(cols, over);
  const r = await ctx.db.run(
    `INSERT INTO exams (madrasa_id, title, description, class_id, subject_id, session_id, term_id, exam_date, total_marks, status, created_by, start_time, end_time, duration_minutes, classroom, instructions, mode, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [ctx.madrasaA, cols.title, cols.description || null, cols.class_id, cols.subject_id, cols.session_id, cols.term_id,
     cols.exam_date, cols.total_marks, cols.status, cols.created_by || ctx.users.adminA, cols.start_time, cols.end_time,
     cols.duration_minutes || 1439, cols.classroom || "", cols.instructions, cols.mode]
  );
  return Number(r.lastInsertRowid);
}

async function addQuestion(client, examId, over = {}) {
  const csrf = await client.csrf();
  const body = Object.assign({
    question_text: "Capital of Nigeria?",
    question_type: "multiple_choice",
    options: JSON.stringify(["Lagos", "Abuja", "Kano"]),
    correct_answer: "Abuja",
    marks: 2,
  }, over);
  return client.req("POST", `/api/academic/exams/${examId}/questions`, body, { headers: { "X-CSRF-Token": csrf } });
}

test("a teacher WITHOUT exams.create cannot create an examination", async () => {
  const teacher = new Client(ctx.base);
  await teacher.login("teacher-a", PASSWORD);
  const r = await createOnlineExam(teacher);
  assert.equal(r.status, 403);
});

test("a teacher WITH exams.create can create an online exam for their own assignment only", async () => {
  await ctx.db.run(
    "INSERT INTO user_permissions (madrasa_id, user_id, permission, effect) VALUES (?,?,?,'allow')",
    [ctx.madrasaA, ctx.users.teacherA, "exams.create"]
  );
  const teacher = new Client(ctx.base);
  await teacher.login("teacher-a", PASSWORD);
  // Own class + subject works…
  const ok1 = await createOnlineExam(teacher, { title: "Teacher-made test" });
  assert.equal(ok1.status, 200);
  assert.equal(ok1.data.exam.mode, "online");
  // …someone else's class/subject does not.
  const bad = await createOnlineExam(teacher, { class_id: ctx.classA2 });
  assert.equal(bad.status, 403);
  await ctx.db.run("DELETE FROM user_permissions WHERE user_id = ? AND permission = 'exams.create'", [ctx.users.teacherA]);
});

test("admin can create an online exam, but it must start as a draft", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const r = await createOnlineExam(admin, { status: "published" });
  assert.equal(r.status, 400, "publishing an exam with no questions must be refused");
  const draft = await createOnlineExam(admin);
  assert.equal(draft.status, 200);
  const pub = await admin.req("PATCH", `/api/academic/exams/${draft.data.id}`, { status: "published" }, { headers: { "X-CSRF-Token": await admin.csrf() } });
  assert.equal(pub.status, 400, "still no questions — still refused");
});

test("questions: add, import from the bank, edit lock after attempts, total sync", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const examId = await seedTakeableExam("Question lifecycle", { total_marks: 0 });

  const mc = await addQuestion(admin, examId);
  assert.equal(mc.status, 200);
  const essay = await addQuestion(admin, examId, { question_text: "Explain taqwaa.", question_type: "essay", options: undefined, correct_answer: "", marks: 5 });
  assert.equal(essay.status, 200);

  // A multiple-choice question without a recorded correct answer is refused.
  const noAnswer = await addQuestion(admin, examId, { question_text: "No answer?", correct_answer: "" });
  assert.equal(noAnswer.status, 400);

  // The declared total tracks the paper while nobody has sat it (the seeded
  // exam is already published; the publish-validation itself is covered above).
  const paper = await admin.req("GET", `/api/academic/exams/${examId}/questions`);
  assert.equal(paper.status, 200);
  assert.equal(Number(paper.data.questionTotal), 7, "2 + 5 marks");
  assert.equal(paper.data.questions.length, 2);

  // Importing from the question bank works.
  const bank = await ctx.db.run(
    "INSERT INTO question_bank (madrasa_id, subject_id, question_text, question_type, options, correct_answer, marks, status) VALUES (?,?,?,?,?,?,?,'active')",
    [ctx.madrasaA, ctx.subjA1, "2+2?", "short_answer", "", "4", 3]
  );
  const imp = await admin.req("POST", `/api/academic/exams/${examId}/questions/import`, { question_ids: [Number(bank.lastInsertRowid)] }, { headers: { "X-CSRF-Token": await admin.csrf() } });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.imported, 1);

  // Once a student starts, the questions are locked.
  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const started = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": await student.csrf() } });
  assert.equal(started.status, 200);
  const locked = await addQuestion(admin, examId, { question_text: "Too late?" });
  assert.equal(locked.status, 409);
});

test("the student list never contains correct answers or explanations", async () => {
  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const list = await student.req("GET", "/api/portal/online-exams");
  assert.equal(list.status, 200);
  const blob = JSON.stringify(list.data);
  assert.ok(!blob.includes("correct_answer"), "no correct answers in the listing");
  assert.ok(!blob.includes("explanation"), "no explanations in the listing");
});

test("start/answer/submit: one attempt, autosave, auto-grading, no duplicates", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const examId = await seedTakeableExam("Take flow");
  await addQuestion(admin, examId); // MC, 2 marks, answer "Abuja"
  await addQuestion(admin, examId, { question_text: "Explain taqwaa.", question_type: "essay", options: undefined, correct_answer: "", marks: 5 });

  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const csrf = await student.csrf();
  const start = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(start.status, 200);
  assert.equal(start.data.questions.length, 2);
  assert.ok(!JSON.stringify(start.data.questions).includes("correct_answer"), "questions carry no answers");
  const qs = start.data.questions;
  assert.ok(start.data.attempt.expires_at, "attempt has a deadline");

  // Second start of the same attempt resumes it (same attempt id).
  const resume = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(resume.status, 200);
  assert.equal(resume.data.attempt.id, start.data.attempt.id);

  // Answers for foreign questions are refused.
  const foreign = await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, { answers: [{ question_id: 999999, answer: "x" }] }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(foreign.status, 400);

  // Save + submit.
  const save = await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, {
    answers: [{ question_id: qs[0].id, answer: "Abuja" }, { question_id: qs[1].id, answer: "God-consciousness." }],
  }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(save.status, 200);

  const submit = await student.req("POST", `/api/portal/online-exams/${examId}/submit`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(submit.status, 200);
  assert.equal(submit.data.auto_score, 2, "objective part auto-graded");

  // Duplicate submission and restart are both refused.
  const dup = await student.req("POST", `/api/portal/online-exams/${examId}/submit`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(dup.status, 409);
  const again = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(again.status, 409);
  const lateSave = await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, { answers: [{ question_id: qs[0].id, answer: "Kano" }] }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(lateSave.status, 409, "locked attempt cannot be written to");

  return { examId, qs };
});

test("an expired attempt auto-finalizes and can never be reopened", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const examId = await seedTakeableExam("Expiry", { duration_minutes: 30 });
  await addQuestion(admin, examId);

  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const csrf = await student.csrf();
  const start = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(start.status, 200);
  // Answer is saved while the attempt is live…
  const save = await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, { answers: [{ question_id: start.data.questions[0].id, answer: "Abuja" }] }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(save.status, 200);
  // …then the deadline is wound back by an hour.
  const past = new Date(Date.now() - 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  const pastSql = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(past.getHours())}:${pad(past.getMinutes())}:${pad(past.getSeconds())}`;
  await ctx.db.run("UPDATE exam_attempts SET expires_at = ? WHERE id = ?", [pastSql, start.data.attempt.id]);

  const lateSave = await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, { answers: [{ question_id: start.data.questions[0].id, answer: "Kano" }] }, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(lateSave.status, 409, "saving after the deadline is refused");
  const restart = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  assert.equal(restart.status, 409, "the expired attempt cannot be reopened");
  const attempt = await ctx.db.get("SELECT status, score FROM exam_attempts WHERE id = ?", [start.data.attempt.id]);
  assert.equal(attempt.status, "submitted", "the attempt was finalized with the saved answers");
  assert.equal(Number(attempt.score), 2, "the saved (correct) answer was graded");
});

test("teacher grading of subjective answers and results release", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const examId = await seedTakeableExam("Grading flow");
  await addQuestion(admin, examId); // 2 marks objective
  await addQuestion(admin, examId, { question_text: "Explain taqwaa.", question_type: "essay", options: undefined, correct_answer: "", marks: 5 });

  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const csrf = await student.csrf();
  const start = await student.req("POST", `/api/portal/online-exams/${examId}/start`, {}, { headers: { "X-CSRF-Token": csrf } });
  await student.req("PUT", `/api/portal/online-exams/${examId}/answers`, {
    answers: [{ question_id: start.data.questions[0].id, answer: "Lagos" }, { question_id: start.data.questions[1].id, answer: "A shield." }],
  }, { headers: { "X-CSRF-Token": csrf } });
  await student.req("POST", `/api/portal/online-exams/${examId}/submit`, {}, { headers: { "X-CSRF-Token": csrf } });

  // Review is closed until release (window is open today).
  const early = await student.req("GET", `/api/portal/online-exams/${examId}/review`);
  assert.equal(early.status, 403);

  // The assigned teacher lists attempts, grades the essay and releases.
  const teacher = new Client(ctx.base);
  await teacher.login("teacher-a", PASSWORD);
  const list = await teacher.req("GET", `/api/academic/exams/${examId}/attempts`);
  assert.equal(list.status, 200);
  assert.equal(list.data.attempts.length, 1);
  const attemptId = list.data.attempts[0].id;

  const detail = await teacher.req("GET", `/api/academic/exams/${examId}/attempts/${attemptId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.questions[0].correct_answer, "Abuja", "staff detail carries the answers");

  // Over-awarding is refused.
  const tooMuch = await teacher.req("PUT", `/api/academic/exams/${examId}/attempts/${attemptId}/grade`, {
    answers: [{ question_id: start.data.questions[1].id, marks_awarded: 6 }],
  }, { headers: { "X-CSRF-Token": await teacher.csrf() } });
  assert.equal(tooMuch.status, 400);

  const grade = await teacher.req("PUT", `/api/academic/exams/${examId}/attempts/${attemptId}/grade`, {
    answers: [{ question_id: start.data.questions[1].id, marks_awarded: 4 }],
  }, { headers: { "X-CSRF-Token": await teacher.csrf() } });
  assert.equal(grade.status, 200);
  assert.equal(grade.data.score, 4, "0 objective + 4 teacher-awarded");

  const release = await teacher.req("POST", `/api/academic/exams/${examId}/release-results`, {}, { headers: { "X-CSRF-Token": await teacher.csrf() } });
  assert.equal(release.status, 200);

  const review = await student.req("GET", `/api/portal/online-exams/${examId}/review`);
  assert.equal(review.status, 200);
  assert.equal(Number(review.data.attempt.score), 4);
  assert.equal(review.data.questions[0].correct_answer, "Abuja", "released papers show the correct answers");
  assert.equal(review.data.questions[0].is_correct, 0, "the wrong objective answer is marked incorrect");
});

test("students see and take only their own class's online exams", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  // An online exam for class A2 — student-a1 is in A1.
  const exam = await createOnlineExam(admin, { title: "Other class", class_id: ctx.classA2 });
  await addQuestion(admin, exam.data.id);
  await admin.req("PATCH", `/api/academic/exams/${exam.data.id}`, { status: "published" }, { headers: { "X-CSRF-Token": await admin.csrf() } });

  const student = new Client(ctx.base);
  await student.login("student-a1", PASSWORD);
  const list = await student.req("GET", "/api/portal/online-exams");
  assert.ok(!list.data.exams.some((e) => e.title === "Other class"), "other-class exam is invisible");
  const start = await student.req("POST", `/api/portal/online-exams/${exam.data.id}/start`, {}, { headers: { "X-CSRF-Token": await student.csrf() } });
  assert.equal(start.status, 404, "and cannot be started");
});

test("cross-tenant isolation: madrasa B users cannot touch madrasa A exams", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const exam = await createOnlineExam(admin, { title: "Tenant A exam" });
  await addQuestion(admin, exam.data.id);
  await admin.req("PATCH", `/api/academic/exams/${exam.data.id}`, { status: "published" }, { headers: { "X-CSRF-Token": await admin.csrf() } });

  // A student in madrasa B with a user account.
  const bcrypt = require("bcryptjs");
  await ctx.db.run(
    "INSERT INTO users (madrasa_id, username, password_hash, role, full_name, student_id) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaB, "student-b1", bcrypt.hashSync(PASSWORD, 10), "student", "Charlie Three", ctx.studentB1]
  );
  const bStudent = new Client(ctx.base);
  await bStudent.login("student-b1", PASSWORD);
  const bList = await bStudent.req("GET", "/api/portal/online-exams");
  assert.equal(bList.status, 200);
  assert.equal(bList.data.exams.length, 0, "no foreign exams in the listing");
  const bStart = await bStudent.req("POST", `/api/portal/online-exams/${exam.data.id}/start`, {}, { headers: { "X-CSRF-Token": await bStudent.csrf() } });
  assert.ok([403, 404].includes(bStart.status), "cross-tenant start is denied safely");

  // Madrasa B's admin cannot manage the questions or attempts either.
  const adminB = new Client(ctx.base);
  await adminB.login("admin-b", PASSWORD);
  const q = await addQuestion(adminB, exam.data.id, { question_text: "Inject?" });
  assert.equal(q.status, 404);
  const attempts = await adminB.req("GET", `/api/academic/exams/${exam.data.id}/attempts`);
  assert.equal(attempts.status, 404);
});

test("parents can follow their child's online exams but never take them", async () => {
  const parent = new Client(ctx.base);
  await parent.login("parent-a", PASSWORD);
  const list = await parent.req("GET", `/api/portal/online-exams?studentId=${ctx.studentA1}`);
  assert.equal(list.status, 200);
  const start = await parent.req("POST", `/api/portal/online-exams/1/start`, {}, { headers: { "X-CSRF-Token": await parent.csrf() } });
  assert.equal(start.status, 403);
  // A parent CANNOT read another child's online exams (student B1 is not linked).
  const foreign = await parent.req("GET", `/api/portal/online-exams?studentId=${ctx.studentB1}`);
  assert.equal(foreign.status, 404);
});

test("unauthenticated visitors are refused on every online-exam endpoint", async () => {
  const c = new Client(ctx.base);
  const list = await c.req("GET", "/api/portal/online-exams");
  assert.equal(list.status, 401);
  // A POST without a session is stopped by the CSRF guard first — 403 —
  // which is equally a safe denial; the route itself is behind requireAuth.
  const start = await c.req("POST", "/api/portal/online-exams/1/start", {});
  assert.ok([401, 403].includes(start.status), "denied safely, got " + start.status);
});

test("online exam publish notifies the class", async () => {
  const admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
  const yesterday = new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 10);
  const examId = await seedTakeableExam("Notify me", { status: "draft", exam_date: yesterday, published_at: null });
  await ctx.db.run("UPDATE exams SET status='draft', published_at=NULL WHERE id = ?", [examId]);
  await addQuestion(admin, examId);
  const pub = await admin.req("PATCH", `/api/academic/exams/${examId}`, { status: "published" }, { headers: { "X-CSRF-Token": await admin.csrf() } });
  assert.equal(pub.status, 200);
  const notif = await ctx.db.get(
    "SELECT id FROM notifications WHERE madrasa_id = ? AND type = 'online_exam_published'",
    [ctx.madrasaA]
  );
  assert.ok(notif, "the class was notified");
});
