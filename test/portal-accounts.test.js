"use strict";
/* ============================================================================
   STUDENT & PARENT PORTAL ACCOUNTS
   ----------------------------------------------------------------------------
   The account-creation UI gap was in the browser, not the API — these tests
   pin the server contract the new "Portal access" tab and the admission
   conversion dialog depend on:

     • an institution admin can create AND reset a student login
     • the created login actually works at /api/auth/login, as role "student"
     • username/password validation is enforced server-side
     • teachers, parents and students can never reach these endpoints
     • cross-tenant student ids are refused (404 — existence is not leaked)
     • a parent account can be linked to one or many children, and sees
       exactly those children through the existing parent portal
     • admission conversion can create both logins in one request
     • GET /students/:id reports portal status without leaking hashes

   The final two tests are source-contract checks over the frontend: they
   confirm the profile tab and the conversion payload exist, without adding a
   new frontend test framework.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { initEnv, setup, Client, PASSWORD, SA_PASSWORD } = require("./helpers");
initEnv();

let ctx;
let admin;
before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base);
  await admin.login("admin-a", PASSWORD);
});
after(async () => { await ctx.close(); });

/** A throwaway student in madrasa A, so each test owns its own fixtures. */
async function makeStudent(admissionNo, first = "Portal", last = "Tester") {
  return (await ctx.db.run(
    "INSERT INTO students (madrasa_id,admission_no,first_name,last_name,class_id,session_id,parent_name,parent_phone) VALUES (?,?,?,?,?,?,?,?)",
    [ctx.madrasaA, admissionNo, first, last, ctx.classA1, ctx.sessionA, `Parent of ${first}`, "+2348044444444"]
  )).lastInsertRowid;
}

/** An accepted admission application in madrasa A, ready to convert. */
async function makeApplication(reference, first, last) {
  const id = (await ctx.db.run(
    "INSERT INTO admission_requests (madrasa_id,reference,first_name,last_name,status,class_id,parent_name,parent_phone) VALUES (?,?,?,?,'accepted',?,?,?)",
    [ctx.madrasaA, reference, first, last, ctx.classA1, `Guardian of ${first}`, "+2348066666666"]
  )).lastInsertRowid;
  return id;
}

/* --------------------------- A. student account -------------------------- */

test("an admin creates a student login and the student can sign in with it", async () => {
  const sid = await makeStudent("TTA9001", "Delta", "Four");
  const r = await admin.api("POST", `/api/students/${sid}/portal-account`, {
    username: "delta.four", password: "Portal1234!",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.created, true);

  const row = await ctx.db.get("SELECT * FROM users WHERE id = ?", [r.data.id]);
  assert.equal(row.role, "student");
  assert.equal(Number(row.student_id), Number(sid));
  assert.equal(Number(row.madrasa_id), Number(ctx.madrasaA), "tenant comes from the session, not the client");

  const c = new Client(ctx.base);
  const login = await c.login("delta.four", "Portal1234!");
  assert.equal(login.status, 200);
  assert.equal(login.data.role, "student");
  const me = await c.api("GET", "/api/auth/me");
  assert.equal(me.data.role, "student", "the SERVER reports the role — the client never supplies it");
});

/* ------------------------- B. student password reset --------------------- */

test("resetting a student login replaces the password and keeps one account", async () => {
  const sid = await makeStudent("TTA9002", "Echo", "Five");
  const created = await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "echo.five", password: "Portal1234!" });
  assert.equal(created.data.created, true);

  const reset = await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "echo.five", password: "Changed5678!" });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.created, false, "resetting an existing account reports created:false");
  assert.equal(reset.data.id, created.data.id, "no duplicate account is created");

  assert.equal((await new Client(ctx.base).login("echo.five", "Portal1234!")).status, 401, "the old password is dead");
  const ok = await new Client(ctx.base).login("echo.five", "Changed5678!");
  assert.equal(ok.status, 200);
  assert.equal(ok.data.role, "student");

  const n = await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE student_id = ? AND role='student'", [sid]);
  assert.equal(Number(n.n), 1);
});

/* ------------------------------ C. validation ---------------------------- */

test("portal-account creation validates the username and password server-side", async () => {
  const sid = await makeStudent("TTA9003", "Foxtrot", "Six");

  const short = await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "foxtrot.six", password: "short1" });
  assert.equal(short.status, 400, "a password under 8 characters is refused");

  const bad = await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "Bad User!", password: "Portal1234!" });
  assert.equal(bad.status, 400, "an invalid username format is refused");

  // "student-a1" already exists (seeded in helpers.js) on another student.
  const dupe = await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "student-a1", password: "Portal1234!" });
  assert.equal(dupe.status, 400, "a duplicate username is refused");

  const none = await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE student_id = ?", [sid]);
  assert.equal(Number(none.n), 0, "no partial account survives a rejected request");
});

/* ----------------------------- D. authorization -------------------------- */

test("only the institution's administrator may create or reset portal logins", async () => {
  const sid = await makeStudent("TTA9004", "Golf", "Seven");
  const body = { username: "golf.seven", password: "Portal1234!" };

  const teacher = new Client(ctx.base); await teacher.login("teacher-a", PASSWORD);
  const student = new Client(ctx.base); await student.login("student-a1", PASSWORD);
  const parent = new Client(ctx.base); await parent.login("parent-a", PASSWORD);

  for (const [label, client] of [["teacher", teacher], ["student", student], ["parent", parent]]) {
    for (const route of ["portal-account", "parent-account"]) {
      const r = await client.api("POST", `/api/students/${sid}/${route}`, body);
      assert.equal(r.status, 403, `${label} must be refused on ${route}, got ${r.status}`);
    }
  }
  const leaked = await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE username = ?", ["golf.seven"]);
  assert.equal(Number(leaked.n), 0);
});

test("a cross-tenant student id is refused without leaking that it exists", async () => {
  const r = await admin.api("POST", `/api/students/${ctx.studentB1}/portal-account`, {
    username: "cross.tenant", password: "Portal1234!",
  });
  assert.equal(r.status, 404, "madrasa A's admin cannot reach madrasa B's student");

  const p = await admin.api("POST", `/api/students/${ctx.studentB1}/parent-account`, {
    username: "cross.parent", password: "Portal1234!",
  });
  assert.equal(p.status, 404);

  const none = await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE username IN ('cross.tenant','cross.parent')");
  assert.equal(Number(none.n), 0);
});

/* ---------------------------- E. parent account -------------------------- */

test("a created parent login reaches the parent portal and sees only its child", async () => {
  const sid = await makeStudent("TTA9005", "Hotel", "Eight");
  const r = await admin.api("POST", `/api/students/${sid}/parent-account`, {
    username: "hotel.parent", password: "Portal1234!", full_name: "Guardian of Hotel", phone: "+2348055555555",
  });
  assert.equal(r.status, 200);

  const row = await ctx.db.get("SELECT * FROM users WHERE id = ?", [r.data.id]);
  assert.equal(row.role, "parent");
  assert.equal(Number(row.madrasa_id), Number(ctx.madrasaA));

  const parent = new Client(ctx.base);
  const login = await parent.login("hotel.parent", "Portal1234!");
  assert.equal(login.status, 200);
  assert.equal(login.data.role, "parent");

  const dash = await parent.api("GET", "/api/portal/dashboard");
  assert.equal(dash.status, 200);
  assert.deepEqual(dash.data.children.map((c) => c.studentId), [Number(sid)], "exactly the linked child");

  // An unrelated student in the same madrasa, and one in another tenant.
  assert.equal((await parent.api("GET", `/api/portal/assignments?studentId=${ctx.studentA1}`)).status, 404,
    "an unlinked child in the same institution is not visible");
  assert.equal((await parent.api("GET", `/api/portal/assignments?studentId=${ctx.studentB1}`)).status, 404,
    "a child in another institution is not visible");
  // The staff student record stays staff-only.
  assert.equal((await parent.api("GET", `/api/students/${sid}`)).status, 403);
});

/* ------------------------ F. multi-child parent linking ------------------ */

test("student_ids links one parent login to several children", async () => {
  const first = await makeStudent("TTA9006", "India", "Nine");
  const second = await makeStudent("TTA9007", "Juliet", "Ten");
  const r = await admin.api("POST", `/api/students/${first}/parent-account`, {
    username: "family.parent", password: "Portal1234!", full_name: "Guardian of two",
    student_ids: [first, second],
  });
  assert.equal(r.status, 200);

  const links = await ctx.db.all("SELECT student_id FROM parent_links WHERE user_id = ? ORDER BY student_id", [r.data.id]);
  assert.deepEqual(links.map((l) => Number(l.student_id)).sort((a, b) => a - b), [Number(first), Number(second)].sort((a, b) => a - b));

  const parent = new Client(ctx.base);
  await parent.login("family.parent", "Portal1234!");
  const dash = await parent.api("GET", "/api/portal/dashboard");
  assert.deepEqual(dash.data.children.map((c) => Number(c.studentId)).sort((a, b) => a - b),
    [Number(first), Number(second)].sort((a, b) => a - b));
});

test("student_ids from another tenant are silently ignored, never linked", async () => {
  const mine = await makeStudent("TTA9008", "Kilo", "Eleven");
  const r = await admin.api("POST", `/api/students/${mine}/parent-account`, {
    username: "tenant.parent", password: "Portal1234!", student_ids: [mine, ctx.studentB1],
  });
  assert.equal(r.status, 200);
  const links = await ctx.db.all("SELECT student_id FROM parent_links WHERE user_id = ?", [r.data.id]);
  assert.deepEqual(links.map((l) => Number(l.student_id)), [Number(mine)]);
});

/* --------------------------- G. admission conversion --------------------- */

test("admission conversion can create the student and parent logins in one step", async () => {
  const applicationId = await makeApplication("APP-TEST-0001", "Lima", "Twelve");

  const converted = await admin.api("POST", `/api/admissions/${applicationId}/convert`, {
    create_student_account: true, create_parent_account: true,
    student_username: "lima.twelve", parent_username: "lima.twelve-p",
    password: "Convert1234!",
  });
  assert.equal(converted.status, 200);
  assert.equal(converted.data.username, "lima.twelve");
  assert.equal(converted.data.parentUsername, "lima.twelve-p");
  assert.equal(converted.data.portalCreated, true);

  const studentLogin = await new Client(ctx.base).login("lima.twelve", "Convert1234!");
  assert.equal(studentLogin.status, 200);
  assert.equal(studentLogin.data.role, "student");

  const parentClient = new Client(ctx.base);
  const parentLogin = await parentClient.login("lima.twelve-p", "Convert1234!");
  assert.equal(parentLogin.status, 200);
  assert.equal(parentLogin.data.role, "parent");
  const dash = await parentClient.api("GET", "/api/portal/dashboard");
  assert.deepEqual(dash.data.children.map((c) => Number(c.studentId)), [Number(converted.data.studentId)]);
});

test("conversion refuses a portal password shorter than 8 characters", async () => {
  const applicationId = await makeApplication("APP-TEST-0002", "Mike", "Thirteen");
  const r = await admin.api("POST", `/api/admissions/${applicationId}/convert`, {
    create_student_account: true, student_username: "mike.thirteen", password: "short",
  });
  assert.equal(r.status, 400);
  const none = await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE username = ?", ["mike.thirteen"]);
  assert.equal(Number(none.n), 0, "the whole conversion rolls back");
});

/* --------------------------- H. student profile API ---------------------- */

test("GET /students/:id reports portal accounts without exposing password hashes", async () => {
  const sid = await makeStudent("TTA9009", "November", "Fourteen");
  const sibling = await makeStudent("TTA9010", "Oscar", "Fifteen");

  const before = await admin.api("GET", `/api/students/${sid}`);
  assert.equal(before.status, 200);
  assert.equal(before.data.portalAccount, null, "no login yet");
  assert.deepEqual(before.data.parentAccounts, []);
  assert.ok(before.data.student && before.data.finance, "the existing response contract is intact");

  await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "november.14", password: "Portal1234!" });
  await admin.api("POST", `/api/students/${sid}/parent-account`, {
    username: "november.parent", password: "Portal1234!", full_name: "Guardian of November",
    student_ids: [sid, sibling],
  });

  const after = await admin.api("GET", `/api/students/${sid}`);
  assert.equal(after.status, 200);
  assert.equal(after.data.portalAccount.username, "november.14");
  assert.equal(after.data.portalAccount.is_active, true);
  assert.ok(after.data.portalAccount.created_at, "created_at is reported");

  assert.equal(after.data.parentAccounts.length, 1);
  const parentInfo = after.data.parentAccounts[0];
  assert.equal(parentInfo.username, "november.parent");
  assert.equal(parentInfo.is_active, true);
  assert.deepEqual(parentInfo.children.map((c) => Number(c.id)).sort((a, b) => a - b),
    [Number(sid), Number(sibling)].sort((a, b) => a - b), "linked children are listed");

  const serialised = JSON.stringify(after.data);
  assert.ok(!/password_hash/.test(serialised), "no password hash field is returned");
  assert.ok(!/\$2[aby]\$/.test(serialised), "no bcrypt hash value is returned");
});

test("the portal-account fields on /students/:id stay behind the existing staff-only rule", async () => {
  const sid = await makeStudent("TTA9011", "Papa", "Sixteen");
  await admin.api("POST", `/api/students/${sid}/portal-account`, { username: "papa.16", password: "Portal1234!" });

  const parent = new Client(ctx.base); await parent.login("parent-a", PASSWORD);
  assert.equal((await parent.api("GET", `/api/students/${sid}`)).status, 403);
  const student = new Client(ctx.base); await student.login("student-a1", PASSWORD);
  assert.equal((await student.api("GET", `/api/students/${sid}`)).status, 403);

  // Madrasa B's admin must not see madrasa A's student at all.
  const adminB = new Client(ctx.base); await adminB.login("admin-b", PASSWORD);
  assert.equal((await adminB.api("GET", `/api/students/${sid}`)).status, 404);
});

/* ------------------------- I. frontend source contract ------------------- */

const readPublic = (file) => fs.readFileSync(path.join(__dirname, "..", "public", "js", file), "utf8");

test("the student profile exposes a Portal access tab wired to the existing APIs", () => {
  const src = readPublic("dashboard.js");
  assert.match(src, /data-profile-tab="portal"/, "the tab button uses the existing tab architecture");
  assert.match(src, /portal:\s*`/, "the tab has an entry in the profile render map");
  assert.match(src, /\/students\/\$\{id\}\/portal-account/, "it posts to the existing student portal-account endpoint");
  assert.match(src, /\/students\/\$\{id\}\/parent-account/, "it posts to the existing parent-account endpoint");
  assert.match(src, /Students, parents, teachers and administrators sign in through/, "the single-login guidance is shown");
  assert.match(src, /canWritePortalAccounts/, "the forms follow the existing role-visibility pattern");
  assert.ok(!/["']student["']\s*:\s*["']\/student["']\s*,\s*role/.test(src), "no hard-coded role assignment is introduced");
});

test("the admission conversion dialog sends the documented account-creation fields", () => {
  const src = readPublic("academic-admissions.js");
  for (const field of ["create_student_account", "create_parent_account", "student_username", "parent_username"]) {
    assert.ok(src.includes(field), `the conversion payload carries ${field}`);
  }
  assert.match(src, /\/admissions\/\$\{id\}\/convert/, "it reuses the existing conversion endpoint");
  assert.match(src, /Student account created/, "created usernames are confirmed back to the admin");
  assert.match(src, /Parent account created/);
  assert.ok(!/toast\([^)]*password/i.test(src), "passwords are never placed in a toast");
});
