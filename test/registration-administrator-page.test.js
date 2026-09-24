"use strict";
/* ============================================================================
   UI REGRESSION — "Continue to Administrator Account" opens a real page
   ----------------------------------------------------------------------------
   Both onboarding flows (Islamic madrasa and Western academy) build the
   Administrator Account stage as its OWN addressable page:

       /register-madrasa/administrator
       /register-academy/administrator

   Pressing the button must therefore change the URL and the document title,
   render the administrator form with the institution it belongs to, survive a
   reload / shared link, answer the browser's Back and Forward buttons, and
   refuse to open before the institution information is complete.

   Requires the jsdom devDependency; the suite skips cleanly without it.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup } = require("./helpers");
initEnv();

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  /* jsdom devDependency not installed (production install) — this file skips. */
}

const skip = !JSDOM ? "jsdom devDependency not installed" : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Boots the shipped SPA at `path` in a DOM and returns helpers. */
async function openPage(base, path, seedDraft) {
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String((e.detail && e.detail.message) || e.message || e);
    if (!/Not implemented/i.test(msg)) pageErrors.push("jsdomError: " + msg);
  });
  vc.on("error", (...a) => pageErrors.push("console.error: " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(base + path, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.addEventListener("error", (e) => pageErrors.push(String((e.error && (e.error.stack || e.error.message)) || e.message)));
      window.addEventListener("unhandledrejection", (e) => pageErrors.push("unhandledrejection: " + String((e.reason && e.reason.message) || e.reason)));
      // Reproduces what the browser already has in storage on a reload.
      if (seedDraft) {
        try { window.sessionStorage.setItem(seedDraft.key, seedDraft.value); } catch (err) { /* ignore */ }
      }
    },
  });

  const { window } = dom;
  for (let i = 0; i < 100 && !window.BelloRegister; i++) await sleep(50);
  await sleep(300);

  return {
    window,
    pageErrors,
    doc: window.document,
    $: (sel) => window.document.querySelector(sel),
    $$: (sel) => Array.from(window.document.querySelectorAll(sel)),
    path: () => window.location.pathname,
    /** Finds a button by its visible label. */
    button(label) {
      const btn = Array.from(window.document.querySelectorAll("button"))
        .find((b) => new RegExp(label, "i").test(b.textContent || ""));
      assert.ok(btn, `the "${label}" button is on the page`);
      return btn;
    },
    /** Clicks the button carrying the given label text. */
    click(label) {
      this.button(label).click();
      return sleep(300);
    },
    close() { try { window.close(); } catch (e) { /* ignore */ } },
  };
}

/* The two sections are the same journey with different identities, so the
   assertions below run twice — once per section. */
const SECTIONS = [
  {
    label: "Islamic madrasa",
    base: "/register-madrasa",
    module: "BelloRegister",
    form: "madrasa",
    draftKey: "bello.madrasa-registration.draft",
    errorSelector: ".field-error-text",
    contextSelector: ".admin-context-copy strong",
    noticeSelector: ".reg-notice",
    adminField: "f_admin_name",
    infoHeading: "Register Your Madrasa",
    extra: {},
  },
  {
    label: "Western academy",
    base: "/register-academy",
    module: "BelloAcademyRegister",
    form: "academy",
    draftKey: "bello.academy-registration.draft",
    errorSelector: ".wa-field-error",
    contextSelector: ".wa-admin-context-copy strong",
    noticeSelector: ".wa-reg-notice",
    adminField: "a_admin_name",
    infoHeading: "Register Your",
    extra: { educationLevels: ["Primary"] },
  },
];

const INSTITUTION = {
  name: "Test Institution",
  country: "Nigeria",
  state: "Ogun",
  city: "Ijebu-Ode",
  address: "12 Test Road",
  phone: "+2348012345678",
};

/** Fills the institution page through the same DOM events a visitor produces. */
function fillInstitution(page, section) {
  const mod = page.window[section.module];
  assert.ok(mod, `the ${section.label} registration module loaded`);

  const prefix = section.form === "madrasa" ? "f" : "a";
  const controls = {
    [`${prefix}_name`]: INSTITUTION.name,
    [`${prefix}_country`]: INSTITUTION.country,
    [`${prefix}_state`]: INSTITUTION.state,
    [`${prefix}_city`]: INSTITUTION.city,
    [`${prefix}_address`]: INSTITUTION.address,
    [`${prefix}_phone`]: INSTITUTION.phone,
  };
  for (const [id, value] of Object.entries(controls)) {
    const control = page.doc.getElementById(id);
    assert.ok(control, `${id} is present on the ${section.label} form`);
    control.value = value;
    const eventName = control.tagName === "SELECT" ? "change" : "input";
    control.dispatchEvent(new page.window.Event(eventName, { bubbles: true }));
  }

  // Structured selections are already represented by their checked controls;
  // this lets each section add any test-only prerequisite without bypassing
  // the visitor-driven text inputs above.
  Object.assign(mod.getState().formData[section.form], section.extra);
  return mod;
}

let ctx;
after(async () => { if (ctx) await ctx.close(); });
before(async () => { ctx = await setup(); });

for (const section of SECTIONS) {
  test(`${section.label}: "Continue to Administrator Account" opens its own page`, { skip }, async () => {
    const page = await openPage(ctx.base, section.base);
    try {
      assert.equal(page.path(), section.base, "the flow starts on the institution information page");

      /* Production sends `script-src-attr 'none'`, which means an `onclick`
         attribute is deliberately blocked by the browser. The regression that
         prompted this check looked fine in jsdom (which does not enforce CSP)
         but the button did nothing in a real browser. The control must now be
         declarative and receive its listener from the external module script. */
      const continueButton = page.button("Continue to Administrator Account");
      assert.equal(continueButton.getAttribute("onclick"), null,
        "the Continue button does not depend on a CSP-blocked inline handler");
      assert.ok(continueButton.dataset.regAction || continueButton.dataset.waAction,
        "the external registration module has an action to bind");
      assert.equal(page.$$("[onclick], [onsubmit]").length, 0,
        "the institution page contains no CSP-blocked event attributes");

      fillInstitution(page, section);
      await page.click("Continue to Administrator Account");

      assert.equal(page.path(), section.base + "/administrator",
        "the externally-bound button navigated to the Administrator Account page's own URL");
      assert.match(page.doc.title, /Administrator Account/,
        "the document title names the page, so bookmarks and history are readable");
      assert.ok(page.$("#administrator-account"), "the administrator page rendered");
      assert.match(page.$("h1").textContent, /Administrator/,
        "the page heading announces the Administrator Account stage");
      assert.ok(page.$("#" + section.adminField), "the administrator form fields are present");
      assert.equal(page.$(section.contextSelector).textContent.trim(), INSTITUTION.name,
        "the page states which institution the administrator account is being created for");
      assert.equal(page.$$("[onclick], [onsubmit]").length, 0,
        "the administrator page also contains no CSP-blocked event attributes");

      assert.deepEqual(page.pageErrors, [], "no client-side error was raised: " + page.pageErrors.join(" | "));
    } finally {
      page.close();
    }
  });

  test(`${section.label}: the administrator page refuses to open with incomplete details`, { skip }, async () => {
    const page = await openPage(ctx.base, section.base);
    try {
      // Nothing filled in: the button must keep the visitor on the information
      // page and say why, instead of opening an orphaned administrator form.
      await page.click("Continue to Administrator Account");

      assert.equal(page.path(), section.base, "the visitor stayed on the institution information page");
      assert.ok(page.$$(section.errorSelector).length > 0, "the missing required fields are reported");
      assert.ok(page.$(section.noticeSelector), "an explanation of what to complete first is shown");
      assert.equal(page.$("#administrator-account"), null, "the administrator form was not rendered");

      assert.deepEqual(page.pageErrors, [], "no client-side error was raised: " + page.pageErrors.join(" | "));
    } finally {
      page.close();
    }
  });

  test(`${section.label}: the administrator page answers Back and Forward`, { skip }, async () => {
    const page = await openPage(ctx.base, section.base);
    try {
      fillInstitution(page, section);
      await page.click("Continue to Administrator Account");
      assert.equal(page.path(), section.base + "/administrator");

      page.window.history.back();
      await sleep(500);
      assert.equal(page.path(), section.base, "Back returned to the institution information page");
      assert.match(page.$("h1").textContent, new RegExp(section.infoHeading, "i"),
        "the information page was re-rendered, not left blank");

      page.window.history.forward();
      await sleep(500);
      assert.equal(page.path(), section.base + "/administrator", "Forward returned to the administrator page");
      assert.ok(page.$("#administrator-account"), "the administrator form rendered again");

      assert.deepEqual(page.pageErrors, [], "no client-side error was raised: " + page.pageErrors.join(" | "));
    } finally {
      page.close();
    }
  });

  test(`${section.label}: the administrator page survives a reload and is shareable`, { skip }, async () => {
    // First visit: reach the page and capture what the browser stored.
    const first = await openPage(ctx.base, section.base);
    let draft;
    try {
      const mod = fillInstitution(first, section);
      // A password typed on the administrator page must not leak into storage
      // when the draft is saved again.
      mod.getState().formData.administrator.password = "SuperSecret123!";
      mod.getState().formData.administrator.confirmPassword = "SuperSecret123!";
      await first.click("Continue to Administrator Account");
      draft = first.window.sessionStorage.getItem(section.draftKey);
      assert.ok(!draft.includes("SuperSecret123!"), "a typed password never reaches storage");
      assert.ok(draft, "the institution details were kept for the next page load");
      assert.match(draft, new RegExp(INSTITUTION.name), "the draft carries the institution name");

      // Credentials and the (potentially huge) logo data URL must never be
      // written to storage — only the details needed to rebuild the page.
      const stored = JSON.parse(draft);
      assert.equal(stored.administrator.password, "", "the administrator password is never written to storage");
      assert.equal(stored.administrator.confirmPassword, "", "the confirmed password is never written to storage");
      assert.equal(stored[section.form].logo, "", "the logo data URL is never written to storage");
    } finally {
      first.close();
    }

    // Reload: a fresh page load straight at the administrator URL.
    const reloaded = await openPage(ctx.base, section.base + "/administrator", { key: section.draftKey, value: draft });
    try {
      assert.equal(reloaded.path(), section.base + "/administrator", "the URL still addresses the administrator page");
      assert.ok(reloaded.$("#administrator-account"), "the administrator page rendered straight from its URL");
      assert.equal(reloaded.$(section.contextSelector).textContent.trim(), INSTITUTION.name,
        "the institution it belongs to was restored");
      assert.deepEqual(reloaded.pageErrors, [], "no client-side error was raised: " + reloaded.pageErrors.join(" | "));
    } finally {
      reloaded.close();
    }
  });

  test(`${section.label}: a cold deep link is sent back to complete the details first`, { skip }, async () => {
    // Someone opens the administrator URL with no details entered at all.
    const page = await openPage(ctx.base, section.base + "/administrator");
    try {
      assert.equal(page.path(), section.base, "the visitor was redirected to the information page");
      assert.equal(page.$("#administrator-account"), null, "no orphaned administrator form was shown");
      assert.ok(page.$(section.noticeSelector), "the visitor is told to complete the institution details first");
      assert.deepEqual(page.pageErrors, [], "no client-side error was raised: " + page.pageErrors.join(" | "));
    } finally {
      page.close();
    }
  });

  test(`${section.label}: the administrator URL is served on a hard refresh`, { skip }, async () => {
    // The server must return the SPA shell (not a 404) for the stage URLs.
    for (const stage of ["administrator", "review", "submitted"]) {
      const res = await fetch(ctx.base + section.base + "/" + stage);
      assert.equal(res.status, 200, `${section.base}/${stage} is served on a hard refresh`);
      assert.match(res.headers.get("content-type") || "", /html/, "the SPA shell is returned");
      assert.match(res.headers.get("content-security-policy") || "", /script-src-attr 'none'/,
        "production security correctly blocks inline event handlers");
    }
  });
}
