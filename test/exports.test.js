"use strict";
/* ============================================================================
   CSV EXPORTS — one file per screen, tenant-scoped, Excel-safe.
   Run: npm test
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

const csv = require("../server/services/csv");

let ctx, adminA, adminB, sa, teacher;
before(async () => {
  ctx = await setup();
  adminA = new Client(ctx.base); await adminA.login("admin-a", PASSWORD);
  adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  sa = new Client(ctx.base); await sa.login("testadmin", SA_PASSWORD);
  teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
});
after(async () => { await ctx.close(); });

/** Returns { status, text, headers } for a download. */
async function download(client, path) {
  const r = await client.api("GET", path);
  const text = r.data === null ? await r.res.text() : r.data;
  return { status: r.status, text: typeof text === "string" ? text : "", headers: r.res.headers };
}

function lines(text) {
  return text.replace(/^/u, "").split("\r\n").filter((l) => l.length);
}

test("the writer quotes, escapes and protects against formula injection", () => {
  assert.equal(csv.cell("Plain"), "Plain");
  assert.equal(csv.cell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csv.cell("a,b"), '"a,b"');
  assert.equal(csv.cell("line1\nline2"), '"line1\nline2"');
  assert.equal(csv.cell(" padded "), '" padded "');
  assert.equal(csv.cell("=HYPERLINK(\"http://evil\")"), '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(csv.cell("+39 12345"), "'+39 12345", "a phone number is not a formula");
  assert.equal(csv.cell("-12"), "'-12");
  assert.equal(csv.cell("@cmd"), "'@cmd");
  assert.equal(csv.num(12.3456, 1), "12.3");
  assert.equal(csv.num(5), "5", "whole numbers are not padded with .00");
  assert.equal(csv.num(null), "", "a missing value is a blank cell, not a zero");
  assert.equal(csv.num(undefined), "");
  assert.equal(csv.num(""), "");
  assert.equal(csv.num("not a number"), "");
  const out = csv.toCsv([{ a: 1, b: "x,y" }], [{ label: "A", key: "a" }, { label: "B", key: "b" }]);
  assert.equal(out, csv.BOM + "A,B\r\n1,\"x,y\"\r\n");
  assert.equal(csv.toCsv([], []), csv.BOM + "\r\n", "an empty export is still a valid file");
});

test("students.csv carries the register with computed columns", async () => {
  const d = await download(adminA, "/api/exports/students.csv");
  assert.equal(d.status, 200);
  assert.match(d.headers.get("content-type"), /^text\/csv/);
  assert.match(d.headers.get("content-disposition"), /filename="students-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.equal(d.headers.get("cache-control"), "no-store");
  const rows = lines(d.text);
  assert.match(rows[0], /^Admission No,First Name,Last Name,/);
  assert.equal(rows.length, 3, "header + the two pupils of madrasa A");
  assert.match(rows[1], /^TTA0001,Alpha,One/);
  assert.doesNotMatch(d.text, /TTA100|Beta B/, "tenant B rows never appear");
  assert.ok(rows[1].includes("Parent of Alpha"), "guardians are on the sheet");
});

test("filters narrow the export the same way the screen does", async () => {
  const one = await download(adminA, "/api/exports/students.csv?classId=" + ctx.classA2);
  assert.equal(lines(one.text).length, 1, "class A2 has no pupils yet, so only the header is written");
  const both = await download(adminA, "/api/exports/students.csv?classId=" + ctx.classA1);
  assert.equal(lines(both.text).length, 3, "class A1 holds both pupils");

  const inactive = await download(adminA, "/api/exports/students.csv?status=inactive");
  assert.equal(lines(inactive.text).length, 1, "no matches leaves only the header");

  const bad = await adminA.api("GET", "/api/exports/results.csv");
  assert.equal(bad.status, 400, "results.csv demands a term");
});

test("results and summary exports follow the marks in the database", async () => {
  const pub = await adminA.api("PUT", "/api/results/summaries/publish", { classId: ctx.classA1, termId: ctx.termA1 });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));

  const res = await download(adminA, `/api/exports/results.csv?classId=${ctx.classA1}&termId=${ctx.termA1}`);
  assert.equal(res.status, 200);
  const rows = lines(res.text);
  assert.match(rows[0], /^Class,Admission No,Student,Subject,CA,Exam,Total/);
  assert.equal(rows.length, 1 + 2 * 2, "both pupils × the two subjects of the fixture");
  for (const line of rows.slice(1)) {
    const cols = line.split(",");
    assert.equal(Number(cols[6]), Number(cols[4]) + Number(cols[5]), "Total always equals CA + Exam");
  }

  const sum = await download(adminA, `/api/exports/summary.csv?classId=${ctx.classA1}&termId=${ctx.termA1}`);
  assert.equal(sum.status, 200);
  const srows = lines(sum.text);
  assert.match(srows[0], /Average %,Grade,Position,Attendance \(days\),Promotion,Published/);
  assert.equal(srows.length, 3);
  assert.match(srows[1], /,yes$/, "the published term is marked yes");
});

test("attendance percentages are computed, not copied from the client", async () => {
  const d = await download(adminA, `/api/exports/attendance.csv?classId=${ctx.classA1}`);
  assert.equal(d.status, 200);
  const rows = lines(d.text);
  assert.match(rows[0], /^Class,Admission No,Student,Days Present,Days Absent,Excused,Sessions Recorded,Attendance %/);
  assert.equal(rows.length, 3, "one row per pupil in the class");
  for (const line of rows.slice(1)) {
    const c = line.split(",");
    const present = Number(c[3]), absent = Number(c[4]), excused = Number(c[5]), days = Number(c[6]);
    assert.equal(present + absent + excused, days, "the day counts add up");
    assert.equal(c[7], (present / days * 100).toFixed(1), "the percentage matches its own columns");
  }
  const empty = await download(adminA, "/api/exports/attendance.csv?from=2030-01-01&to=2030-02-01");
  assert.equal(lines(empty.text).length, 1, "a date range with no records exports a header only");
});

test("fees.csv shows what is still owed", async () => {
  const item = await adminA.api("POST", "/api/fees/items", {
    term_id: ctx.termA1, name_en: "Term Fee", name_ar: "رسوم الفصل", amount_ngn: 5000,
  });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const paid = await adminA.api("POST", "/api/fees/payments", {
    student_id: ctx.studentA1, fee_item_id: item.data.id, amount_ngn: 2000, payment_date: "2026-09-01", method: "cash",
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));

  const rows = lines((await download(adminA, "/api/exports/fees.csv?termId=" + ctx.termA1)).text);
  assert.match(rows[0], /^Class,Admission No,Student,Parent,Parent Phone,Billed \(N\),Paid \(N\),Outstanding \(N\)/);
  const alpha = rows.find((l) => l.includes("TTA0001"));
  assert.ok(alpha, "the billed pupil is on the sheet");
  const c = alpha.split(",");
  assert.equal(Number(c[5]), 5000, "billed");
  assert.equal(Number(c[6]), 2000, "paid");
  assert.equal(Number(c[7]), 3000, "the balance is what the collector will chase");
  const bravo = rows.find((l) => l.includes("TTA0002"));
  assert.equal(Number(bravo.split(",")[6]), 0, "an unpaid pupil shows zero, not a blank");

  // B does not get A's ledger.
  const other = await download(adminB, "/api/exports/fees.csv?termId=" + ctx.termA1);
  assert.ok(!other.text.includes("TTA0001"));
});

test("a teacher may export only the classes assigned to them", async () => {
  const all = await download(adminA, "/api/exports/students.csv");
  const mine = await download(teacher, "/api/exports/students.csv");
  assert.equal(mine.status, 200);
  assert.ok(lines(mine.text).length <= lines(all.text).length, "never more rows than the admin");
  const denied = await teacher.api("GET", "/api/exports/fees.csv");
  assert.equal(denied.status, 403, "money is admin-only");
  const adm = await teacher.api("GET", "/api/exports/admissions.csv");
  assert.equal(adm.status, 403);
});

test("parents and students have no export route at all", async () => {
  const stu = new Client(ctx.base);
  await stu.login("student-a1", PASSWORD);
  assert.equal((await stu.api("GET", "/api/exports/students.csv")).status, 403);
  assert.equal((await stu.api("GET", "/api/exports/summary.csv?termId=1&classId=1")).status, 403);
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("GET", "/api/exports/students.csv")).status, 401);
});

test("a super admin names the tenant they export", async () => {
  const noTenant = await sa.api("GET", "/api/exports/students.csv");
  assert.equal(noTenant.status, 400, "a platform login must say which madrasa");
  const withTenant = await download(sa, "/api/exports/students.csv?madrasaId=" + ctx.madrasaB);
  assert.equal(withTenant.status, 200);
  assert.ok(!lines(withTenant.text).some((l) => l.includes("Alpha")), "tenant A's pupil is not in B's file");
});

test("another tenant's ids in a filter change nothing", async () => {
  const d = await download(adminB, "/api/exports/students.csv?classId=" + ctx.classA1);
  assert.equal(d.status, 200);
  assert.equal(lines(d.text).length, 1, "A's class id selects nobody in B — no cross-tenant rows");
});
