"use strict";
/* ============================================================================
   BELLO-INSTITUTE LOAD TEST — cross-tenant isolation probes
   ----------------------------------------------------------------------------
   Runs CONTINUOUSLY while load is being generated. A user from tenant A
   repeatedly asks for tenant B's resources — by straight ID, by manipulated
   ID, and via search — and asserts that the answer is ALWAYS a denial
   (403/404) or tenant-A-only data. Any 200 response carrying tenant-B data
   is a critical isolation failure and fails the probe.

     node loadtest/probe-isolation.js --url http://127.0.0.1:3000 --duration 60
   ========================================================================== */
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BASE = arg("url", "http://127.0.0.1:3000");
const DURATION_MS = Number(arg("duration", 60)) * 1000;

const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, "accounts.json"), "utf8"));

async function login(username, password) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error("probe login failed for " + username + ": " + res.status);
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const me = await (await fetch(BASE + "/api/auth/me", { headers: { cookie } })).json();
  const tok = await (await fetch(BASE + "/api/csrf-token", { headers: { cookie } })).json();
  return { cookie, csrf: tok.csrfToken, me };
}

async function get(cookie, p) {
  const res = await fetch(BASE + p, { headers: { cookie, "x-csrf-token": "not-needed-for-get" } });
  let body = null;
  try { body = await res.json(); } catch (e) { /* html */ }
  return { status: res.status, body };
}

/** Depth-search a response for any student id belonging to another tenant. */
function containsForeignStudent(body, foreignIds) {
  const seen = [];
  const walk = (v, depth) => {
    if (depth > 6 || v == null) return false;
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    if (typeof v === "object") {
      const id = Number(v.student_id !== undefined ? v.student_id : v.id !== undefined && v.first_name !== undefined ? v.id : NaN);
      if (Number.isInteger(id) && foreignIds.has(id)) { seen.push(id); return true; }
      return Object.values(v).some((x) => walk(x, depth + 1));
    }
    return false;
  };
  const hit = walk(body, 0);
  return hit ? seen : null;
}

(async () => {
  // Two users from DIFFERENT tenants (admins for the widest endpoint access).
  const admins = accounts.users.filter((u) => u.role === "madrasa_admin");
  const a = admins[0];
  const b = admins[admins.length - 1];
  if (!a || !b || a.madrasaId === b.madrasaId) { console.error("probe needs two distinct tenants"); process.exit(2); }

  const sessionA = await login(a.username, accounts.testPassword);
  const sessionB = await login(b.username, accounts.testPassword);

  // Foreign (tenant B) resource ids, gathered with tenant B's own session.
  const bStudents = await get(sessionB.cookie, "/api/students?perPage=50");
  const foreignStudentIds = new Set(
    ((bStudents.body && bStudents.body.students) || []).map((s) => Number(s.id)).slice(0, 40)
  );
  const bStudentId = [...foreignStudentIds][0];
  const bClasses = (await get(sessionB.cookie, "/api/classes")).body;
  const bClassId = bClasses && bClasses.classes && bClasses.classes[0] ? Number(bClasses.classes[0].id) : null;

  let checks = 0;
  const violations = [];
  const DENY = new Set([401, 403, 404]);

  /** One probe round. */
  async function round() {
    // 1. Straight cross-tenant reads by id.
    const byId = [
      "/api/students/" + bStudentId,
      "/api/students/" + bStudentId + "/profile",
      "/api/attendance/student/" + bStudentId,
      "/api/results/student/" + bStudentId,
      "/api/fees/records",
      "/api/students?classId=" + bClassId,
    ];
    for (const p of byId) {
      const r = await get(sessionA.cookie, p);
      checks++;
      if (!DENY.has(r.status)) {
        const foreign = containsForeignStudent(r.body, foreignStudentIds);
        if (foreign) violations.push({ probe: p, status: r.status, leak: "foreign student ids " + foreign.slice(0, 3) });
      }
    }
    // 2. Manipulated/absurd ids must never leak data.
    for (const p of [
      "/api/students/" + (bStudentId + 100000),
      "/api/students/-1",
      "/api/students/abc' OR '1'='1",
      "/api/attendance/student/" + bStudentId + "?limit=999999999",
      "/api/students?perPage=999999999",
    ]) {
      const r = await get(sessionA.cookie, encodeURI(p));
      checks++;
      if (r.status === 200 && /students|records/.test(p)) {
        const foreign = containsForeignStudent(r.body, foreignStudentIds);
        if (foreign) violations.push({ probe: p, status: 200, leak: "foreign student ids " + foreign.slice(0, 3) });
      }
      if (r.status >= 500) violations.push({ probe: p, status: r.status, leak: "server error" });
    }
    // 3. Search must stay inside tenant A.
    const r = await get(sessionA.cookie, "/api/admin/search?q=" + encodeURIComponent("a"));
    checks++;
    if (r.status === 200) {
      const foreign = containsForeignStudent(r.body, foreignStudentIds);
      if (foreign) violations.push({ probe: "admin/search", status: 200, leak: "foreign student ids " + foreign.slice(0, 3) });
    }
    // 4. Cross-tenant WRITE attempt: mark attendance for a foreign class.
    const res = await fetch(BASE + "/api/attendance/mark", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionA.cookie, "x-csrf-token": sessionA.csrf },
      body: JSON.stringify({ classId: bClassId, date: new Date().toISOString().slice(0, 10), statuses: { [bStudentId]: "present" } }),
    });
    checks++;
    if (res.status === 200) {
      const body = await res.json().catch(() => ({}));
      if (Number(body.saved) > 0) violations.push({ probe: "attendance/mark cross-tenant", status: 200, leak: "saved rows in foreign class" });
    } else if (res.status >= 500) violations.push({ probe: "attendance/mark cross-tenant", status: res.status, leak: "server error" });
    // 5. Session of tenant B must not be usable as tenant A (cookie mix-up).
    const meA = await get(sessionA.cookie, "/api/auth/me");
    checks++;
    if (meA.status === 200 && meA.body && meA.body.loggedIn && Number(meA.body.madrasaId) !== Number(a.madrasaId)) {
      violations.push({ probe: "auth/me", status: 200, leak: "wrong tenant on session: got " + meA.body.madrasaId + ", expected " + a.madrasaId });
    }
  }

  const start = Date.now();
  while (Date.now() - start < DURATION_MS) {
    try { await round(); } catch (e) { violations.push({ probe: "round", error: e.message }); }
    await new Promise((r) => setTimeout(r, 250));
  }
  const out = { startedAt: new Date(start).toISOString(), durationMs: Date.now() - start, checks, violations };
  fs.writeFileSync(path.join(__dirname, "results", "isolation-probe.json"), JSON.stringify(out, null, 2));
  console.log("ISOLATION PROBE: " + checks + " cross-tenant checks, " + violations.length + " violations");
  if (violations.length) {
    console.log(JSON.stringify(violations, null, 2));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
