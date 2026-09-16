"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();
let ctx;
let admin;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base);
  const login = await admin.login("admin-a", PASSWORD);
  assert.equal(login.status, 200);
});

test.after(async () => {
  await ctx.close();
});

test("teachers module creates full staff profiles, assignments, status history and CSV exports", async () => {
  const create = await admin.api("POST", "/api/teachers", {
    first_name: "Zainab",
    last_name: "Hassan",
    gender: "Female",
    phone: "+2348099900001",
    email: "zainab.hassan@test.example",
    nationality: "Nigerian",
    employment_date: "2026-09-16",
    employment_type: "Full-time",
    position: "Arabic Teacher",
    department: "Islamic Studies",
    education_track: "islamic",
    qualifications: "B.A. Arabic and Islamic Studies",
    certifications: "TRCN",
    specialization: "Arabic Grammar",
    years_experience: 6,
    available_days: ["Mon", "Tue", "Wed"],
    assignments: [{ class_id: ctx.classA1, subject_id: ctx.subjA1, role: "subject_teacher" }],
  });
  assert.equal(create.status, 200);
  assert.match(create.data.staffId, /^[A-Z0-9]+\d{4}$/);
  assert.ok(create.data.tempPassword, "a secure temporary password is returned when none is supplied");

  const list = await admin.api("GET", `/api/teachers?search=${encodeURIComponent(create.data.staffId)}&education_track=islamic`);
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.teachers[0].staff_id, create.data.staffId);
  assert.equal(list.data.teachers[0].subjects[0].id, ctx.subjA1);

  const detail = await admin.api("GET", `/api/teachers/${create.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.teacher.full_name, "Zainab Hassan");
  assert.equal(detail.data.assignments.length, 1);
  assert.deepEqual(JSON.parse(detail.data.teacher.available_days), ["Mon", "Tue", "Wed"]);

  const status = await admin.api("PATCH", `/api/teachers/${create.data.id}/status`, { status: "on_leave", reason: "Maternity leave" });
  assert.equal(status.status, 200);
  const afterStatus = await admin.api("GET", `/api/teachers/${create.data.id}`);
  assert.equal(afterStatus.data.teacher.status, "on_leave");
  assert.equal(afterStatus.data.statusHistory[0].to_status, "on_leave");

  const csv = await admin.req("GET", `/api/exports/teachers.csv?search=${encodeURIComponent(create.data.staffId)}`);
  assert.equal(csv.status, 200);
  const body = await csv.res.text();
  assert.match(body, /Staff ID,Full Name/);
  assert.match(body, new RegExp(create.data.staffId));

  const archive = await admin.api("DELETE", `/api/teachers/${create.data.id}`);
  assert.equal(archive.status, 200);
  const hidden = await admin.api("GET", `/api/teachers?search=${encodeURIComponent(create.data.staffId)}`);
  assert.equal(hidden.data.total, 0, "archived teachers disappear from the active directory");
  const restore = await admin.api("PATCH", `/api/teachers/${create.data.id}/status`, { status: "active", reason: "Returned" });
  assert.equal(restore.status, 200);
  const restored = await admin.api("GET", `/api/teachers?search=${encodeURIComponent(create.data.staffId)}`);
  assert.equal(restored.data.total, 1);
});

test("teacher applications can be reviewed and converted to real teacher accounts", async () => {
  const app = await admin.api("POST", "/api/teachers/applications", {
    first_name: "Maryam",
    last_name: "Bello",
    email: "maryam.bello@test.example",
    phone: "+2348099900002",
    position_applied: "English Teacher",
    subjects_specialization: "English Language",
    qualifications: "B.Ed English",
    certifications: "PGDE",
    education_track: "western",
    experience_years: 4,
  });
  assert.equal(app.status, 200);
  assert.match(app.data.applicationId, /^TAPP/);

  const review = await admin.api("PATCH", `/api/teachers/applications/${app.data.id}`, {
    status: "accepted",
    review_note: "Strong interview and references.",
    interview_date: "2026-09-20",
    interview_time: "09:30",
    interview_location: "Admin office",
  });
  assert.equal(review.status, 200);

  const converted = await admin.api("POST", `/api/teachers/applications/${app.data.id}/convert`, {
    assignments: [{ class_id: ctx.classA2, subject_id: ctx.subjA2, role: "subject_teacher" }],
  });
  assert.equal(converted.status, 200);
  assert.ok(converted.data.teacherId);
  assert.match(converted.data.staffId, /^[A-Z0-9]+\d{4}$/);

  const detail = await admin.api("GET", `/api/teachers/${converted.data.teacherId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.teacher.source_application_id, app.data.id);
  assert.equal(detail.data.teacher.position, "English Teacher");
  assert.equal(detail.data.assignments[0].class.id, ctx.classA2);

  const appDetail = await admin.api("GET", `/api/teachers/applications/${app.data.id}`);
  assert.equal(appDetail.data.application.status, "accepted");
  assert.equal(appDetail.data.application.teacher_user_id, converted.data.teacherId);
  assert.ok(appDetail.data.history.some((h) => h.to_status === "accepted"));
});

test("classes module creates shared-track classes, moves rosters, assigns teachers and detects room conflicts", async () => {
  const klass = await admin.api("POST", "/api/classes", {
    name_en: "Integrated Grade 1",
    name_ar: "الصف المتكامل ١",
    education_track: "both",
    program: "Integrated",
    level: "Primary 1",
    section_arm: "Blue",
    session_id: ctx.sessionA,
    term_id: ctx.termA1,
    max_capacity: 30,
    class_teacher_id: ctx.users.teacherA,
    subject_ids: [ctx.subjA1, ctx.subjA2],
  });
  assert.equal(klass.status, 200);
  assert.ok(klass.data.id);

  const list = await admin.api("GET", "/api/classes?education_track=both&search=Integrated");
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.classes[0].student_count, 0);
  assert.equal(list.data.classes[0].class_teacher_id, ctx.users.teacherA);

  const place = await admin.api("POST", `/api/classes/${klass.data.id}/students`, { student_id: ctx.studentA2, notes: "Moved from admissions list" });
  assert.equal(place.status, 200);
  assert.equal(place.data.moved, 1);
  const roster = await admin.api("GET", `/api/classes/${klass.data.id}/students`);
  assert.equal(roster.status, 200);
  assert.equal(roster.data.stats.total, 1);
  assert.equal(roster.data.students[0].id, ctx.studentA2);

  const assign = await admin.api("POST", `/api/classes/${klass.data.id}/teachers`, {
    teacher_id: ctx.users.teacherA,
    subject_id: ctx.subjA2,
    role: "subject_teacher",
    assigned_periods: "Tue P2",
  });
  assert.equal(assign.status, 200);
  const classTeachers = await admin.api("GET", `/api/classes/${klass.data.id}/teachers`);
  assert.ok(classTeachers.data.teachers.some((t) => t.assignment_id === assign.data.assignmentId && t.subject.id === ctx.subjA2));

  const firstSave = await admin.api("PUT", "/api/timetable", {
    classId: ctx.classA1,
    termId: ctx.termA1,
    slots: [{ day: "Mon", period: 1, startTime: "08:00", endTime: "08:40", subjectId: ctx.subjA1, room: "LAB-1" }],
  });
  assert.equal(firstSave.status, 200);
  const conflict = await admin.api("PUT", "/api/timetable", {
    classId: klass.data.id,
    termId: ctx.termA1,
    slots: [{ day: "Mon", period: 1, startTime: "08:00", endTime: "08:40", subjectId: ctx.subjA2, room: "LAB-1" }],
  });
  assert.equal(conflict.status, 400);
  assert.match(conflict.data.error, /LAB-1 is already assigned/);

  const okSave = await admin.api("PUT", "/api/timetable", {
    classId: klass.data.id,
    termId: ctx.termA1,
    slots: [{ day: "Mon", period: 1, startTime: "08:00", endTime: "08:40", subjectId: ctx.subjA2, teacherId: ctx.users.teacherA, room: "LAB-2" }],
  });
  assert.equal(okSave.status, 200);
  const timetableCsv = await admin.req("GET", `/api/exports/timetable.csv?classId=${klass.data.id}&termId=${ctx.termA1}`);
  assert.equal(timetableCsv.status, 200);
  assert.match(await timetableCsv.res.text(), /Integrated Grade 1/);

  const classesCsv = await admin.req("GET", `/api/exports/classes.csv?classId=${klass.data.id}`);
  assert.equal(classesCsv.status, 200);
  assert.match(await classesCsv.res.text(), /Integrated Grade 1/);

  const archive = await admin.api("DELETE", `/api/classes/${klass.data.id}`);
  assert.equal(archive.status, 200);
  const archived = await admin.api("GET", "/api/classes?status=archived&search=Integrated");
  assert.equal(archived.data.total, 1);
  const restored = await admin.api("PATCH", `/api/classes/${klass.data.id}`, { status: "active" });
  assert.equal(restored.status, 200);
  const active = await admin.api("GET", "/api/classes?search=Integrated");
  assert.equal(active.data.total, 1);
});
