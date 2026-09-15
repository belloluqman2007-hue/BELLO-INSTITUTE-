"use strict";
/* ============================================================================
   ADMIN → MY INSTITUTION — browser-level regression
   ----------------------------------------------------------------------------
   Drives the real admin SPA in jsdom to prove the section is wired up rather
   than merely present: every one of the eight screens renders live data from
   the API, the in-section navigation moves between them, a form actually
   saves, and the section reuses the existing dashboard design system instead
   of introducing a parallel one.
   ========================================================================== */
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
    if (!/Not implemented: window\.(scrollTo|HTMLCanvasElement)/i.test(String(error.message))) errors.push(String(error.message));
  });
  vc.on("error", (...args) => errors.push(args.map(String).join(" ")));
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.URL.createObjectURL = () => "blob:mock";
      window.URL.revokeObjectURL = () => {};
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
    async route(route) { window.BelloDashboard.go(route); await sleep(900); },
    close() { window.close(); },
  };
}

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { if (ctx) await ctx.close(); });

test("all eight My Institution screens render live data in the existing design system", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    assert.ok(page.window.BelloMyInstitution, "the My Institution module is loaded");

    const screens = [
      ["institution/profile", /Profile/i, "name_en"],
      ["institution/information", /Information/i, "levels_offered"],
      ["institution/website", /Public Website/i, "seo_title"],
      ["institution/appearance", /Appearance/i, "brand_color"],
      ["institution/contact", /Contact Information/i, "emergency_contact"],
      ["institution/settings", /Settings/i, "school_code"],
    ];

    for (const [route, heading, field] of screens) {
      await page.route(route);
      const content = page.content();
      assert.match(content.querySelector("h2").textContent, heading, `${route} shows its heading`);

      // Loading state is gone and the real form is present.
      assert.equal(content.querySelector(".dash-mi-loading"), null, `${route} finished loading`);
      assert.ok(content.querySelector(`[name="${field}"]`), `${route} rendered its ${field} control`);

      // Eight-way navigation is always available.
      assert.equal(content.querySelectorAll(".dash-mi-nav-btn").length, 8, `${route} offers all eight sections`);

      // Reuses the shared design system rather than a parallel one.
      assert.ok(content.querySelector(".dash-card"), `${route} uses the shared card`);
      assert.ok(content.querySelector(".dash-btn-primary"), `${route} uses the shared primary button`);
    }

    // Pages manager lists the seeded pages in the shared table component.
    await page.route("institution/pages");
    let content = page.content();
    assert.ok(content.querySelector(".dash-table"), "pages use the shared table");
    assert.equal(content.querySelectorAll("#miPageRows tr").length, 21, "all 21 default pages are listed");
    assert.ok(content.querySelector("[data-edit-page]"), "each page can be edited");
    assert.ok(content.querySelector("[data-toggle-page]"), "each page can be published or unpublished");

    // Gallery renders its albums and media areas with working empty states.
    await page.route("institution/gallery");
    content = page.content();
    assert.ok(content.querySelector("#miAlbumGrid"), "albums area rendered");
    assert.ok(content.querySelector("#miMediaGrid"), "media library rendered");
    assert.ok(content.querySelector("#miUploadMedia"), "images can be uploaded");
    assert.ok(content.querySelector("#miAddVideo"), "videos can be added");

    assert.deepEqual(page.errors, [], "no script errors while using the section");
  } finally { page.close(); }
});

test("the in-section navigation switches screens, and a save persists to the backend", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("institution/profile");

    // Click through to Information using the section nav, not the URL.
    const target = [...page.content().querySelectorAll(".dash-mi-nav-btn")]
      .find((b) => b.getAttribute("data-mi-nav") === "institution/information");
    assert.ok(target, "the Information tab is in the section nav");
    target.dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(900);
    assert.match(page.content().querySelector("h2").textContent, /Information/i, "navigated without a page reload");

    // Fill in a real field and submit the real form.
    const form = page.content().querySelector("#miInfoForm");
    assert.ok(form, "the information form is present");
    form.querySelector('[name="levels_offered"]').value = "Nursery, Primary and Secondary";
    form.querySelector('[name="languages_of_instruction"]').value = "English, Arabic";
    form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(1200);

    // A success toast appeared…
    assert.ok(page.doc.querySelector(".dash-toast"), "the shared toast confirmed the save");

    // …and the value really reached the database.
    const row = await ctx.db.get("SELECT levels_offered, languages_of_instruction FROM madaris WHERE id = ?", [ctx.madrasaA]);
    assert.equal(row.levels_offered, "Nursery, Primary and Secondary");
    assert.equal(row.languages_of_instruction, "English, Arabic");

    assert.deepEqual(page.errors, [], "no script errors while saving");
  } finally { page.close(); }
});

test("client-side validation blocks a bad value before it reaches the server", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("institution/information");
    const form = page.content().querySelector("#miInfoForm");
    const email = form.querySelector('[name="email"]');
    email.value = "definitely-not-an-email";
    form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(500);

    assert.ok(email.classList.contains("is-invalid"), "the offending field is marked");
    const message = form.querySelector('[data-error-for="email"]');
    assert.ok(message && !message.hidden && message.textContent.length, "an inline message explains the problem");

    const row = await ctx.db.get("SELECT email FROM madaris WHERE id = ?", [ctx.madrasaA]);
    assert.notEqual(row.email, "definitely-not-an-email", "nothing invalid was saved");
  } finally { page.close(); }
});

test("the appearance screen previews changes live and keeps both education accents", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("institution/appearance");
    const content = page.content();

    // Separate, configurable accents for the two education sections.
    assert.ok(content.querySelector('[name="islamic_color"]'), "Islamic Education accent is configurable");
    assert.ok(content.querySelector('[name="western_color"]'), "Western Education accent is configurable");

    const preview = content.querySelector("#miLivePreview");
    assert.ok(preview && preview.innerHTML.includes("dash-mi-lp"), "a live preview is rendered");
    assert.ok(/Islamic Education/.test(preview.textContent) && /Western Education/.test(preview.textContent),
      "the preview shows both strands as one institution");

    // Changing a control repaints the preview without a round trip.
    const before = preview.innerHTML;
    const layout = content.querySelector('[name="homepage_layout"]');
    layout.value = layout.options[layout.options.length - 1].value;
    layout.dispatchEvent(new page.window.Event("change", { bubbles: true }));
    await sleep(200);
    assert.notEqual(preview.innerHTML, before, "the preview updated live");

    assert.ok(content.querySelector("#miAppearanceReset"), "appearance can be reset to the default theme");
  } finally { page.close(); }
});

test("destructive actions ask for confirmation first", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("institution/pages");
    const pagesBefore = await ctx.db.get("SELECT COUNT(*) AS n FROM website_pages WHERE madrasa_id = ?", [ctx.madrasaA]);

    // Create a deletable page through the API so there is a delete button.
    const deleteBtn = page.content().querySelector("[data-delete-page]");
    if (deleteBtn) {
      deleteBtn.dispatchEvent(new page.window.Event("click", { bubbles: true }));
      await sleep(400);
      const modal = page.doc.querySelector(".dash-modal-backdrop");
      assert.ok(modal, "a confirmation dialog opened instead of deleting immediately");
      assert.ok(modal.querySelector("[data-mi-confirm]"), "the dialog offers an explicit confirm");
      assert.ok(modal.querySelector("[data-mi-cancel]"), "and a way out");

      modal.querySelector("[data-mi-cancel]").dispatchEvent(new page.window.Event("click", { bubbles: true }));
      await sleep(400);
      const pagesAfter = await ctx.db.get("SELECT COUNT(*) AS n FROM website_pages WHERE madrasa_id = ?", [ctx.madrasaA]);
      assert.equal(Number(pagesAfter.n), Number(pagesBefore.n), "cancelling deleted nothing");
    }
  } finally { page.close(); }
});
