"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, Client, PASSWORD } = require("./helpers");

initEnv();
let ctx;
let admin;
let templateId;

test.before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base);
  const login = await admin.login("admin-a", PASSWORD);
  assert.equal(login.status, 200);
});

test.after(async () => { await ctx.close(); });

test("ID card HTML is tenant-scoped and print-optimised", async () => {
  const own = await admin.req("GET", `/api/documents/id-card/${ctx.studentA1}?qr=1`);
  assert.equal(own.status, 200);
  const html = await own.res.text();
  assert.match(html, /@page\{size:85mm 54mm/);
  assert.match(html, /Alpha One/);
  assert.match(html, /student-profile/);

  const otherTenant = await admin.req("GET", `/api/documents/id-card/${ctx.studentB1}`);
  assert.equal(otherTenant.status, 404);
});

test("bulk ID cards render four-card sheet layout", async () => {
  const response = await admin.req("GET", `/api/documents/id-card/bulk?classId=${ctx.classA1}`);
  assert.equal(response.status, 200);
  const html = await response.res.text();
  assert.match(html, /@page\{size:A4 portrait/);
  assert.equal((html.match(/class="id-card /g) || []).length, 2);
  assert.match(html, /grid-template-columns:repeat\(2,85mm\)/);
});

test("certificate templates and issued certificates validate, render, and stay tenant-scoped", async () => {
  const bad = await admin.api("POST", "/api/documents/templates", { name: "Bad", type: "not-a-type", html_template: "<p>x</p>" });
  assert.equal(bad.status, 400);

  const created = await admin.api("POST", "/api/documents/templates", {
    name: "Achievement", type: "achievement", html_template: "<h1>{{student_name}}</h1><p>{{class}} · {{session}} · {{date}}</p><strong>{{custom_field_1}}</strong>",
  });
  assert.equal(created.status, 200);
  templateId = created.data.id;

  const issued = await admin.api("POST", "/api/documents/certificates", {
    student_id: ctx.studentA1, template_id: templateId, issued_date: "2026-09-17", custom_fields: { custom_field_1: "Excellent character" },
  });
  assert.equal(issued.status, 200);

  const list = await admin.req("GET", `/api/documents/certificates?studentId=${ctx.studentA1}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.certificates.length, 1);

  const printable = await admin.req("GET", `/api/documents/certificates/${issued.data.id}`);
  assert.equal(printable.status, 200);
  const html = await printable.res.text();
  assert.match(html, /@page\{size:A4 landscape/);
  assert.match(html, /Alpha One/);
  assert.match(html, /Excellent character/);
  assert.doesNotMatch(html, /\{\{student_name\}\}/);

  const archived = await admin.api("PATCH", `/api/documents/templates/${templateId}`, { archived: true });
  assert.equal(archived.status, 200);
  const noIssue = await admin.api("POST", "/api/documents/certificates", { student_id: ctx.studentA2, template_id: templateId });
  assert.equal(noIssue.status, 400);
});

test("teachers can print assigned-class cards but cannot manage templates", async () => {
  const teacher = new Client(ctx.base);
  assert.equal((await teacher.login("teacher-a", PASSWORD)).status, 200);
  assert.equal((await teacher.req("GET", `/api/documents/id-card/${ctx.studentA1}`)).status, 200);
  assert.equal((await teacher.req("GET", "/api/documents/templates")).status, 403);
});
