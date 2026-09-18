"use strict";
/* ============================================================================
   STUDENT HEALTH & MEDICAL — browser-level regression (jsdom)
   ----------------------------------------------------------------------------
   Drives the real admin SPA against the real API to prove the Health module
   is wired end-to-end: the "Health Reports" sidebar page for BOTH institution
   categories, the "Health" tab inside the existing student profile modal
   (medical profile pills, sick-bay visit logging, vaccination records, the
   edit form), and the existing pages still working afterwards — all without a
   single script error.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, PASSWORD } = require("./helpers");
initEnv();

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { /* production install */ }
const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dayOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function openAdmin(base, username) {
  let cookie = "";
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => {
    if (!/Not implemented: window\.(scrollTo|HTMLCanvasElement)/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.open = () => null;
      window.fetch = async (input, init = {}) => {
        const url = String(input).startsWith("http") ? input : base + input;
        const headers = new Headers(init.headers || {});
        if (cookie) headers.set("cookie", cookie);
        const response = await fetch(url, { ...init, headers });
        for (const value of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
          const pair = value.split(";", 1)[0]; const i = pair.indexOf("=");
          cookie = pair.slice(0, i) + "=" + pair.slice(i + 1);
        }
        return response;
      };
    },
  });
  const { window } = dom;
  for (let i = 0; i < 80 && !window.document.querySelector("#dashLoginForm"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashLoginForm"), "admin sign-in form rendered");
  window.document.querySelector("#dlUser").value = username;
  window.document.querySelector("#dlPass").value = PASSWORD;
  window.document.querySelector("#dashLoginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 100 && !window.document.querySelector("#dashContent"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashContent"), "authenticated dashboard shell rendered");
  await sleep(900);
  return {
    window, doc: window.document, errors,
    content: () => window.document.querySelector("#dashContent"),
    async route(route) { window.BelloDashboard.go(route); await sleep(1000); },
    click(el) { el.dispatchEvent(new window.Event("click", { bubbles: true })); },
    submit(form) { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); },
    close() { window.close(); },
  };
}

let ctx;
before(async () => {
  ctx = await setup();
  // Madrasa B becomes a Western Academy (category-gating check).
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
  // Seed one medical file + one soon-due vaccination in each tenant.
  await ctx.db.run(
    "INSERT INTO student_health (madrasa_id, student_id, blood_group, genotype, allergies, chronic_conditions, dietary_restrictions) VALUES (?,?,?,?,?,?,?)",
    [ctx.madrasaA, ctx.studentA1, "O+", "AS", "Peanuts, Bee stings", "Mild asthma", "No beef"]
  );
  await ctx.db.run(
    "INSERT INTO student_health (madrasa_id, student_id, blood_group, genotype, allergies) VALUES (?,?,?,?,?)",
    [ctx.madrasaB, ctx.studentB1, "A-", "AA", "Shellfish"]
  );
  await ctx.db.run(
    "INSERT INTO vaccinations (madrasa_id, student_id, vaccine_name, dose, date_given, next_due, administered_by) VALUES (?,?,?,?,?,?,?)",
    [ctx.madrasaA, ctx.studentA1, "Yellow fever", "Booster", dayOffset(-10), dayOffset(9), "State PHC nurse"]
  );
  await ctx.db.run(
    "INSERT INTO vaccinations (madrasa_id, student_id, vaccine_name, dose, date_given, next_due, administered_by) VALUES (?,?,?,?,?,?,?)",
    [ctx.madrasaB, ctx.studentB1, "Typhoid", "1st dose", dayOffset(-5), dayOffset(20), "Clinic"]
  );
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic admin: Health Reports page + profile Health tab work through the real UI", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloHealth, "the health module is loaded");
    assert.ok(page.doc.body.classList.contains("dash-islamic"), "Islamic theme applied");

    // --- Sidebar: Students group exposes Health Reports.
    const studentsGroup = [...page.doc.querySelectorAll(".dash-nav-link")].find((b) => b.textContent.trim() === "Students");
    assert.ok(studentsGroup, "Students group present in the sidebar");
    page.click(studentsGroup);
    await sleep(200);
    const items = [...page.doc.querySelectorAll(".dash-nav-sub.is-open button")].map((b) => b.textContent.trim());
    assert.ok(items.includes("Health Reports"), "Health Reports sidebar item present");

    // --- Health Reports page: allergy list + upcoming vaccinations.
    await page.route("students/health");
    let content = page.content();
    assert.match(content.querySelector("h2").textContent, /Health Reports/);
    assert.match(content.textContent, /Known allergies/);
    assert.match(content.textContent, /Peanuts/, "the seeded allergy renders");
    assert.match(content.textContent, /Bee stings/);
    assert.match(content.textContent, /Yellow fever/, "the seeded vaccination renders");
    assert.ok(content.textContent.includes("Due in 9 day"), "the due-in pill renders");
    assert.match(content.textContent, /Vaccinations due in the next 30 days/);
    assert.doesNotMatch(content.textContent, /Charlie/, "madrasa B's student never appears");
    assert.ok(content.querySelector('a[href*="/api/health/export.csv"]'), "admin export link present");

    // --- Profile modal: the Health tab sits among the existing tabs.
    await page.route("students/profiles");
    content = page.content();
    const alphaRow = [...content.querySelectorAll("tbody tr")].find((tr) => /Alpha/.test(tr.textContent));
    assert.ok(alphaRow, "Alpha is listed");
    page.click(alphaRow.querySelector("[data-profile-open]"));
    for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal-backdrop"); i++) await sleep(50);
    await sleep(600);
    const modal = page.doc.querySelector(".dash-modal");
    assert.ok(modal, "profile modal opened");
    const tabs = [...modal.querySelectorAll("[data-profile-tab]")].map((b) => b.textContent.trim());
    assert.ok(tabs.includes("Health"), "the Health tab exists beside the existing tabs");
    for (const expected of ["Overview", "Personal & family", "Academic", "Student life", "Finance", "Documents", "Communication"]) {
      assert.ok(tabs.includes(expected), `existing tab "${expected}" still present`);
    }

    // --- Open the Health tab: read-only pills + tables render.
    page.click(modal.querySelector('[data-profile-tab="health"]'));
    await sleep(900);
    const panel = page.doc.querySelector("#studentProfilePanel");
    assert.ok(panel, "the profile panel is present");
    assert.match(panel.textContent, /Medical profile/);
    assert.match(panel.textContent, /O\+/, "blood group renders");
    assert.match(panel.textContent, /AS/, "genotype renders");
    assert.match(panel.textContent, /Mild asthma/, "chronic conditions render");
    assert.match(panel.textContent, /Sick-bay visits/);
    assert.match(panel.textContent, /Vaccinations/);
    assert.match(panel.textContent, /Yellow fever/, "the seeded vaccination is listed");
    assert.ok(panel.querySelector("#healthEditBtn"), "edit button offered");
    assert.ok(panel.querySelector("#healthLogVisitBtn"), "log visit button offered");
    assert.ok(panel.querySelector("#healthAddVaccineBtn"), "add vaccination button offered");

    // --- Log a sick-bay visit through the modal.
    page.click(panel.querySelector("#healthLogVisitBtn"));
    for (let i = 0; i < 40 && !page.doc.querySelector("#healthVisitForm"); i++) await sleep(50);
    const visitForm = page.doc.querySelector("#healthVisitForm");
    assert.ok(visitForm, "visit modal opened");
    visitForm.elements.complaint.value = "Stomach pain after break";
    visitForm.elements.treatment.value = "Rest and water";
    page.submit(visitForm);
    await sleep(1500);
    let repanel = page.doc.querySelector("#studentProfilePanel");
    assert.ok(repanel, "the profile re-opened on the health tab");
    assert.match(repanel.textContent, /Stomach pain after break/, "the logged visit is listed");
    assert.match(repanel.textContent, /Admin A/, "attended-by defaults to the signed-in admin");

    // --- Soft-delete that visit from the table.
    const delBtn = repanel.querySelector("[data-health-del-visit]");
    assert.ok(delBtn, "a remove action is offered");
    page.click(delBtn);
    await sleep(1500);
    repanel = page.doc.querySelector("#studentProfilePanel");
    assert.doesNotMatch(repanel.textContent, /Stomach pain after break/, "the visit is hidden after soft delete");
    const dbVisit = await ctx.db.get("SELECT is_deleted FROM health_visits WHERE madrasa_id = ? ORDER BY id DESC", [ctx.madrasaA]);
    assert.equal(Number(dbVisit.is_deleted), 1, "soft delete, not destruction");

    // --- Add a vaccination through the modal.
    page.click(repanel.querySelector("#healthAddVaccineBtn"));
    for (let i = 0; i < 40 && !page.doc.querySelector("#healthVaccinationForm"); i++) await sleep(50);
    const vacForm = page.doc.querySelector("#healthVaccinationForm");
    assert.ok(vacForm, "vaccination modal opened");
    vacForm.elements.vaccine_name.value = "Meningitis";
    vacForm.elements.next_due.value = dayOffset(25);
    page.submit(vacForm);
    await sleep(1500);
    repanel = page.doc.querySelector("#studentProfilePanel");
    assert.match(repanel.textContent, /Meningitis/, "the new vaccination is listed");

    // --- Edit the medical profile.
    page.click(repanel.querySelector("#healthEditBtn"));
    for (let i = 0; i < 40 && !page.doc.querySelector("#healthProfileForm"); i++) await sleep(50);
    const healthForm = page.doc.querySelector("#healthProfileForm");
    assert.ok(healthForm, "health edit modal opened");
    healthForm.elements.blood_group.value = "B+";
    page.submit(healthForm);
    await sleep(1500);
    repanel = page.doc.querySelector("#studentProfilePanel");
    assert.match(repanel.textContent, /B\+/, "the updated blood group renders");
    const dbProfile = await ctx.db.get("SELECT blood_group FROM student_health WHERE madrasa_id = ? AND student_id = ?", [ctx.madrasaA, ctx.studentA1]);
    assert.equal(dbProfile.blood_group, "B+");

    // --- Existing pages still work after the new module has rendered.
    await page.route("students/profiles");
    assert.match(page.content().querySelector("h2").textContent, /Student profiles/);
    await page.route("students/all");
    assert.ok(page.content().textContent.length > 0, "the students list still renders");
    await page.route("dashboard");
    assert.ok(page.content().querySelector(".dash-stats-grid, .dash-stat-card"), "the dashboard home still renders");

    assert.deepEqual(page.errors, [], "no script errors anywhere in the flow");
  } finally { page.close(); }
});

test("Western academy admin gets the identical Health module", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"), "Western theme applied");
    const sidebar = page.doc.querySelector(".dash-sidebar").textContent;
    assert.match(sidebar, /Health Reports/, "health is never category-gated");
    assert.doesNotMatch(sidebar, /Qur'an \/ Islamic Education/, "the Islamic group stays Islamic-only");

    await page.route("students/health");
    const content = page.content();
    assert.match(content.querySelector("h2").textContent, /Health Reports/);
    assert.match(content.textContent, /Shellfish/, "the academy's own allergy renders");
    assert.match(content.textContent, /Typhoid/, "the academy's own vaccination renders");
    // Tenant isolation is visible in the UI: madrasa A's data never appears.
    assert.doesNotMatch(content.textContent, /Peanuts/);
    assert.doesNotMatch(content.textContent, /Yellow fever/);

    // The profile modal's Health tab is identical for the Western category.
    await page.route("students/profiles");
    page.click(page.content().querySelector("[data-profile-open]"));
    for (let i = 0; i < 40 && !page.doc.querySelector(".dash-modal-backdrop"); i++) await sleep(50);
    await sleep(600);
    const modal = page.doc.querySelector(".dash-modal");
    page.click(modal.querySelector('[data-profile-tab="health"]'));
    await sleep(900);
    const panel = page.doc.querySelector("#studentProfilePanel");
    assert.match(panel.textContent, /Medical profile/);
    assert.match(panel.textContent, /A-/, "the academy's student blood group renders");

    assert.deepEqual(page.errors, [], "no script errors on the Western side either");
  } finally { page.close(); }
});
