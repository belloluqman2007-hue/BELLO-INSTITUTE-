"use strict";
/* ============================================================================
   STUDENT HEALTH & MEDICAL — API tests
   ----------------------------------------------------------------------------
   Covers: migration (implicit through setup), medical profile upsert/read,
   validation, sick-bay visits (create/list/soft-delete), vaccinations,
   role rules (teacher read-only + class scope, admin-only writes),
   madrasa_id tenant isolation, reports (allergies + upcoming vaccines),
   the sensitive CSV export, and the regression guarantee that the standard
   student export never leaks medical columns.
   ========================================================================== */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();
let ctx;
let adminA, adminB, teacherA, parentA, studentA1;
const U = "Passw0rd!123";

function dayOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base);
  adminB = new Client(ctx.base);
  teacherA = new Client(ctx.base);
  parentA = new Client(ctx.base);
  studentA1 = new Client(ctx.base);
  assert.equal((await adminA.login("admin-a", U)).status, 200);
  assert.equal((await adminB.login("admin-b", U)).status, 200);
  assert.equal((await teacherA.login("teacher-a", U)).status, 200);
  assert.equal((await parentA.login("parent-a", U)).status, 200);
  assert.equal((await studentA1.login("student-a1", U)).status, 200);
});
test.after(async () => { await ctx.close(); });

/* ------------------------- medical profile ------------------------------- */

test("medical tables exist and start empty", async () => {
  for (const table of ["student_health", "health_visits", "vaccinations"]) {
    const row = await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE madrasa_id = ?`, [ctx.madrasaA]);
    assert.equal(Number(row.n), 0, `${table} is empty for madrasa A`);
  }
  const none = await adminA.req("GET", `/api/health/students/${ctx.studentA1}`);
  assert.equal(none.status, 200);
  assert.equal(none.data.health, null);
  assert.equal(none.data.hasProfile, false);
});

test("admin creates and updates the medical profile (upsert)", async () => {
  const created = await adminA.api("PATCH", `/api/health/students/${ctx.studentA1}`, {
    blood_group: "O+", genotype: "AS", allergies: "Peanuts, Penicillin",
    chronic_conditions: "Mild asthma", dietary_restrictions: "No beef",
    emergency_medication: "Inhaler (salbutamol) — 2 puffs",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.health.blood_group, "O+");
  assert.equal(created.data.health.genotype, "AS");
  assert.equal(created.data.health.allergies, "Peanuts, Penicillin");

  const updated = await adminA.api("PATCH", `/api/health/students/${ctx.studentA1}`, {
    blood_group: "O+", genotype: "AS", allergies: "Peanuts", vision_notes: "Wears glasses",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.health.allergies, "Peanuts");
  assert.equal(updated.data.health.vision_notes, "Wears glasses");
  // A single row per student per madrasa.
  const rows = await ctx.db.all("SELECT * FROM student_health WHERE madrasa_id = ? AND student_id = ?", [ctx.madrasaA, ctx.studentA1]);
  assert.equal(rows.length, 1);

  const read = await adminA.req("GET", `/api/health/students/${ctx.studentA1}`);
  assert.equal(read.status, 200);
  assert.equal(read.data.hasProfile, true);
});

test("blood group / genotype are validated", async () => {
  assert.equal((await adminA.api("PATCH", `/api/health/students/${ctx.studentA2}`, { blood_group: "Z+" })).status, 400);
  assert.equal((await adminA.api("PATCH", `/api/health/students/${ctx.studentA2}`, { genotype: "XX" })).status, 400);
  // Unknown student / wrong tenant
  assert.equal((await adminA.req("GET", "/api/health/students/99999")).status, 404);
  assert.equal((await adminA.req("GET", `/api/health/students/${ctx.studentB1}`)).status, 404);
  assert.equal((await adminA.api("PATCH", `/api/health/students/${ctx.studentB1}`, { blood_group: "A+" })).status, 404);
});

test("student / parent accounts cannot reach medical records", async () => {
  assert.equal((await studentA1.req("GET", `/api/health/students/${ctx.studentA1}`)).status, 403);
  assert.equal((await parentA.req("GET", `/api/health/students/${ctx.studentA1}`)).status, 403);
  assert.equal((await studentA1.api("PATCH", `/api/health/students/${ctx.studentA1}`, { blood_group: "A+" })).status, 403);
  assert.equal((await parentA.req("GET", "/api/health/reports/allergies")).status, 403);
});

/* ---------------------------- sick-bay visits ---------------------------- */

test("visits: log, list, soft delete", async () => {
  const empty = await adminA.req("GET", `/api/health/students/${ctx.studentA1}/visits`);
  assert.equal(empty.status, 200);
  assert.equal(empty.data.visits.length, 0);

  const logged = await adminA.api("POST", `/api/health/students/${ctx.studentA1}/visits`, {
    visit_date: dayOffset(-3), complaint: "Headache after break", diagnosis: "Mild dehydration",
    treatment: "Rest + water", referred_out: false,
  });
  assert.equal(logged.status, 200);
  const referred = await adminA.api("POST", `/api/health/students/${ctx.studentA1}/visits`, {
    complaint: "Suspected fracture (wrist)", treatment: "Splint applied",
    referred_out: true, referral_notes: "General hospital, Ijebu-Ode",
  });
  assert.equal(referred.status, 200);

  // Complaint is required; a bad date is rejected.
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentA1}/visits`, { complaint: "" })).status, 400);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentA1}/visits`, { complaint: "x", visit_date: "17-09-2026" })).status, 400);

  const list = await adminA.req("GET", `/api/health/students/${ctx.studentA1}/visits`);
  assert.equal(list.data.visits.length, 2);
  const withReferral = list.data.visits.find((v) => v.id === referred.data.id);
  assert.equal(withReferral.referred_out, 1);
  assert.equal(withReferral.attended_by, "Admin A", "attended_by defaults to the signed-in admin");
  // newest first (the undated visit defaulted to today)
  assert.equal(list.data.visits[0].id, referred.data.id);

  // Soft delete: hidden from the list, row kept for audit.
  const removed = await adminA.api("DELETE", `/api/health/visits/${referred.data.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await adminA.api("DELETE", `/api/health/visits/${referred.data.id}`)).status, 404);
  const after = await adminA.req("GET", `/api/health/students/${ctx.studentA1}/visits`);
  assert.equal(after.data.visits.length, 1);
  const dbRow = await ctx.db.get("SELECT * FROM health_visits WHERE id = ?", [referred.data.id]);
  assert.equal(Number(dbRow.is_deleted), 1, "the visit is soft-deleted, never destroyed");
});

/* ----------------------------- vaccinations ------------------------------ */

test("vaccinations: add, list, validate", async () => {
  const added = await adminA.api("POST", `/api/health/students/${ctx.studentA1}/vaccinations`, {
    vaccine_name: "Yellow fever", dose: "Booster", date_given: dayOffset(-10),
    next_due: dayOffset(5), administered_by: "State PHC nurse",
  });
  assert.equal(added.status, 200);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentA1}/vaccinations`, { vaccine_name: "" })).status, 400);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentA1}/vaccinations`, { vaccine_name: "MMR", date_given: "not-a-date" })).status, 400);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentA1}/vaccinations`, { vaccine_name: "MMR", date_given: dayOffset(-1), next_due: dayOffset(-2) })).status, 400);

  const list = await adminA.req("GET", `/api/health/students/${ctx.studentA1}/vaccinations`);
  assert.equal(list.data.vaccinations.length, 1);
  assert.equal(list.data.vaccinations[0].vaccine_name, "Yellow fever");
});

/* --------------------------- roles & isolation --------------------------- */

test("teacher: read-only, scoped to assigned classes; edits are 403", async () => {
  // studentA1 is in class A1 which teacher-a is assigned to.
  assert.equal((await teacherA.req("GET", `/api/health/students/${ctx.studentA1}`)).status, 200);
  assert.equal((await teacherA.req("GET", `/api/health/students/${ctx.studentA1}/visits`)).status, 200);
  // A student in an unassigned class (A2) is invisible.
  const other = (await ctx.db.run(
    "INSERT INTO students (madrasa_id,admission_no,first_name,last_name,class_id,session_id) VALUES (?,?,?,?,?,?)",
    [ctx.madrasaA, "TTA0099", "Delta", "Four", ctx.classA2, ctx.sessionA]
  )).lastInsertRowid;
  assert.equal((await teacherA.req("GET", `/api/health/students/${other}`)).status, 404);
  // Teacher may never write medical data.
  assert.equal((await teacherA.api("PATCH", `/api/health/students/${ctx.studentA1}`, { blood_group: "B+" })).status, 403);
  assert.equal((await teacherA.api("POST", `/api/health/students/${ctx.studentA1}/visits`, { complaint: "x" })).status, 403);
  assert.equal((await teacherA.api("POST", `/api/health/students/${ctx.studentA1}/vaccinations`, { vaccine_name: "x", date_given: dayOffset(0) })).status, 403);
  assert.equal((await teacherA.req("GET", `/api/health/students/${ctx.studentB1}`)).status, 404);
});

test("madrasa B data is invisible to madrasa A on every health route", async () => {
  // Seed a full medical file for B's student.
  assert.equal((await adminB.api("PATCH", `/api/health/students/${ctx.studentB1}`, {
    blood_group: "A-", genotype: "AA", allergies: "Shellfish",
  })).status, 200);
  assert.equal((await adminB.api("POST", `/api/health/students/${ctx.studentB1}/visits`, { complaint: "Fever" })).status, 200);
  assert.equal((await adminB.api("POST", `/api/health/students/${ctx.studentB1}/vaccinations`, {
    vaccine_name: "Typhoid", date_given: dayOffset(-1), next_due: dayOffset(10),
  })).status, 200);

  // Cross-tenant reads and writes all fail (404 — existence not leaked).
  assert.equal((await adminA.req("GET", `/api/health/students/${ctx.studentB1}`)).status, 404);
  assert.equal((await adminA.req("GET", `/api/health/students/${ctx.studentB1}/visits`)).status, 404);
  assert.equal((await adminA.req("GET", `/api/health/students/${ctx.studentB1}/vaccinations`)).status, 404);
  assert.equal((await adminA.api("PATCH", `/api/health/students/${ctx.studentB1}`, { blood_group: "O-" })).status, 404);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentB1}/visits`, { complaint: "x" })).status, 404);
  assert.equal((await adminA.api("POST", `/api/health/students/${ctx.studentB1}/vaccinations`, { vaccine_name: "x", date_given: dayOffset(0) })).status, 404);

  // Reports and the export are tenant-scoped too.
  const allergies = await adminA.req("GET", "/api/health/reports/allergies");
  assert.equal(allergies.status, 200);
  assert.ok(allergies.data.students.every((s) => s.first_name !== "Charlie"), "A's allergy report never lists B's student");
  const upcoming = await adminA.req("GET", "/api/health/reports/upcoming-vaccines");
  assert.equal(upcoming.status, 200);
  assert.ok(upcoming.data.vaccinations.every((v) => v.first_name !== "Charlie"), "A's vaccine report never lists B's student");
  const exportA = await adminA.req("GET", "/api/health/export.csv");
  assert.equal(exportA.status, 200);
  const textA = await exportA.res.text();
  assert.doesNotMatch(textA, /Charlie/, "A's medical export never contains B rows");
});

/* -------------------------------- reports -------------------------------- */

test("allergy report lists only students with recorded allergies", async () => {
  // studentA2 has no profile yet; A1 has "Peanuts".
  const report = await adminA.req("GET", "/api/health/reports/allergies");
  assert.equal(report.status, 200);
  assert.equal(report.data.students.length, 1);
  assert.equal(report.data.students[0].first_name, "Alpha");
  assert.equal(report.data.students[0].class_en, "Class A1");
  assert.equal(report.data.students[0].allergies, "Peanuts");
  // A whitespace-only allergy does not count.
  await adminA.api("PATCH", `/api/health/students/${ctx.studentA2}`, { allergies: "   " });
  const still = await adminA.req("GET", "/api/health/reports/allergies");
  assert.equal(still.data.students.length, 1);
});

test("upcoming-vaccine report covers exactly the next 30 days", async () => {
  await adminA.api("POST", `/api/health/students/${ctx.studentA2}/vaccinations`, { vaccine_name: "Due in 30 days", date_given: dayOffset(-1), next_due: dayOffset(30) });
  await adminA.api("POST", `/api/health/students/${ctx.studentA2}/vaccinations`, { vaccine_name: "Due in 31 days", date_given: dayOffset(-1), next_due: dayOffset(31) });
  await adminA.api("POST", `/api/health/students/${ctx.studentA2}/vaccinations`, { vaccine_name: "Overdue yesterday", date_given: dayOffset(-2), next_due: dayOffset(-1) });
  await adminA.api("POST", `/api/health/students/${ctx.studentA2}/vaccinations`, { vaccine_name: "No next dose", date_given: dayOffset(-2) });

  const report = await adminA.req("GET", "/api/health/reports/upcoming-vaccines");
  assert.equal(report.status, 200);
  const names = report.data.vaccinations.map((v) => v.vaccine_name);
  assert.ok(names.includes("Yellow fever"), "due in 5 days is included");
  assert.ok(names.includes("Due in 30 days"), "the 30-day boundary is inclusive");
  assert.ok(!names.includes("Due in 31 days"), "beyond 30 days is excluded");
  assert.ok(!names.includes("Overdue yesterday"), "overdue doses are not 'upcoming'");
  assert.ok(!names.includes("No next dose"), "records without next_due are excluded");
  const alpha = report.data.vaccinations.find((v) => v.first_name === "Alpha");
  assert.ok(alpha && alpha.parent_phone, "guardian contact is included for follow-up");
});

/* ------------------------- sensitive CSV export -------------------------- */

test("medical CSV export is admin-only and separate from student exports", async () => {
  // Anonymous: no session at all.
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/health/export.csv")).status, 401);
  // Teacher: explicitly denied.
  assert.equal((await teacherA.req("GET", "/api/health/export.csv")).status, 403);
  // Super admin must name the tenant.
  const superAdmin = new Client(ctx.base);
  assert.equal((await superAdmin.login("testadmin", "TestAdmin123!")).status, 200);
  assert.equal((await superAdmin.req("GET", "/api/health/export.csv")).status, 400);
  assert.equal((await superAdmin.req("GET", `/api/health/export.csv?madrasaId=${ctx.madrasaA}`)).status, 200);

  const csvRes = await adminA.req("GET", "/api/health/export.csv");
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.res.text();
  assert.match(csvText, /Blood Group/);
  assert.match(csvText, /Peanuts/);
  assert.doesNotMatch(csvText, /Charlie/);

  // REGRESSION: the standard student export never gains medical columns.
  const studentsCsv = await adminA.req("GET", "/api/exports/students.csv");
  assert.equal(studentsCsv.status, 200);
  const studentsText = await studentsCsv.res.text();
  assert.doesNotMatch(studentsText, /Blood Group/i);
  assert.doesNotMatch(studentsText, /Genotype/i);
  assert.doesNotMatch(studentsText, /Allerg/i);
  assert.doesNotMatch(studentsText, /Peanuts/);
});

test("the public /api/health service probe still works unauthenticated", async () => {
  const anon = new Client(ctx.base);
  const r = await anon.req("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});
