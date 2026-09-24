"use strict";
/* Browser-level regression for the single, category-configured admin SPA. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initEnv, setup, PASSWORD } = require("./helpers");
initEnv();

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { /* production install */ }
const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openAdmin(base, username) {
  let cookie = "";
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => {
    if (!/Not implemented: window\.scrollTo/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
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
  assert.ok(window.document.querySelector("#dashContent"), "one authenticated dashboard shell rendered");
  await sleep(1000); // dashboard cards resolve their own parallel API requests after shell mount
  return { window, doc: window.document, errors, async route(route) { window.BelloDashboard.go(route); await sleep(900); }, close() { window.close(); } };
}

let ctx;
before(async () => {
  ctx = await setup();
  await ctx.db.run("UPDATE madaris SET category = ?, institution_type = ? WHERE id = ?", ["western", "Academy", ctx.madrasaB]);
});
after(async () => { if (ctx) await ctx.close(); });

test("Islamic admin dashboard exposes Hifz and student attendance in the shared workspace", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.doc.body.classList.contains("dash-islamic"));
    const sidebarText = page.doc.querySelector(".dash-sidebar").textContent;
    // Subjects are DATA, not navigation: no individual subject (Qur'an,
    // Tajweed, Hadith, Fiqh…) may appear as a top-level sidebar item, and the
    // Hifz tracker is reached through the Academic section.
    assert.doesNotMatch(sidebarText, /Qur'an \/ Islamic Education/);
    assert.match(sidebarText, /Curriculum & Subjects/);
    assert.match(sidebarText, /Hifz Progress Tracker/);
    for (const subject of ["Tajweed", "Hadith", "Fiqh", "Tawheed", "Aqeedah", "Seerah", "Nahw", "Sarf"]) {
      assert.ok(!sidebarText.includes(subject), `the sidebar must not list the ${subject} subject`);
    }
    assert.match(page.doc.querySelector("#dashContent").textContent, /Qur'an & Hifz Progress/);
    await page.route("attendance/students");
    assert.match(page.doc.querySelector("#dashContent").textContent, /Student Attendance/);
    assert.ok(page.doc.querySelector("#attendanceClass"), "student register can be opened from the sidebar route");
    await page.route("quran/progress");
    assert.match(page.doc.querySelector("#dashContent").textContent, /Qur'an Progress/);
    assert.ok(page.doc.querySelector("#addQuranProgress"), "the Islamic tracker presents an add-progress workflow");
    // The Academic → Curriculum & Subjects workspace lists the categories and
    // reaches the exact same per-category management screens as before.
    await page.route("academic/subjects");
    assert.match(page.doc.querySelector("#dashContent").textContent, /Curriculum & Subjects/, "the subjects workspace opens from Academic");
    await page.route("subjects/Qur'an");
    page.doc.querySelector("#addCustomSubject").click();
    page.doc.querySelector("#customSubjectForm [name=name_en]").value = "Qur'an Writing";
    page.doc.querySelector("#customSubjectForm").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(900);
    assert.match(page.doc.querySelector("#dashContent").textContent, /Qur'an Writing/, "administrators can extend the starter subject catalogue");
    assert.deepEqual(page.errors, []);
  } finally { page.close(); }
});

test("Western admin dashboard uses academy vocabulary and never exposes Hifz", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-b");
  try {
    assert.ok(page.doc.body.classList.contains("dash-western"));
    const sidebarText = page.doc.querySelector(".dash-sidebar").textContent;
    assert.match(sidebarText, /My Academy/);
    assert.match(sidebarText, /Curriculum & Subjects/);
    assert.match(sidebarText, /Academy Fees/);
    assert.doesNotMatch(sidebarText, /Qur'an \/ Islamic Education/);
    assert.ok(!sidebarText.includes("Qur'an"), "the Western sidebar never exposes the Hifz tracker");
    for (const subject of ["Mathematics", "Computer Science", "Business", "Social Sciences", "Languages"]) {
      assert.ok(!sidebarText.includes(subject), `the sidebar must not list the ${subject} subject`);
    }
    assert.match(page.doc.querySelector("#dashContent").textContent, /Academic Performance/);
    await page.route("attendance/students");
    assert.ok(page.doc.querySelector("#attendanceClass"), "the same attendance workspace works for academies");
    assert.deepEqual(page.errors, []);
  } finally { page.close(); }
});
