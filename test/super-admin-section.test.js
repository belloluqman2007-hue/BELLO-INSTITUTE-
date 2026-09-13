"use strict";
/* ============================================================================
   SUPER ADMIN SECTION — regressions for the reported faults
   ----------------------------------------------------------------------------
   Reported: "some colour is not well and some can't be seen" and "I can't see
   madrasa and academy that registered and submit".

   Root causes covered here:
     1. A failing INSERT into madrasa_registrations was caught and ignored, so
        the applicant received a 200 + reference number while the row was never
        stored. The registration therefore never appeared in the super admin's
        Registrations screen and could never be approved.
     2. The dashboard colour palette was declared on `.dash-root`, but modals
        and toasts are appended to <body>, i.e. OUTSIDE that element. Every
        var() in them resolved to nothing, rendering transparent surfaces and
        unreadable text.
     3. The super admin silently inherited the Islamic School theme.
     4. Pill/state colours failed WCAG AA against their own tinted backgrounds.
     5. statCard() escaped its value, so markup passed in printed as literal
        "&lt;small&gt;" text on the Platform Overview.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { initEnv, setup, Client, SA_PASSWORD } = require("./helpers");
initEnv();

const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "public", "css", "dashboard.css"), "utf8");
const DASH_JS = fs.readFileSync(path.join(ROOT, "public", "js", "dashboard.js"), "utf8");
const REG_JS = fs.readFileSync(path.join(ROOT, "public", "js", "register.js"), "utf8");
const ACADEMY_JS = fs.readFileSync(path.join(ROOT, "public", "js", "register-academy.js"), "utf8");

let ctx;
let sa;
before(async () => {
  ctx = await setup();
  sa = new Client(ctx.base);
  const r = await sa.login("testadmin", SA_PASSWORD);
  assert.equal(r.status, 200, "super admin login");
});
after(async () => { await ctx.close(); });

/* ------------------------------------------------------------------ */
/* 1. Registrations actually reach the super admin                     */
/* ------------------------------------------------------------------ */

test("a submitted madrasa AND academy both appear in the super admin's registrations list", async () => {
  const anon = new Client(ctx.base);

  const madrasa = await anon.req("POST", "/api/public/register-madrasa", {
    category: "islamic",
    madrasa: {
      name: "Visible Madrasa", institutionType: "Madrasa",
      state: "Ogun", city: "Ijebu-Ode", address: "1 Visible Rd", phone: "+2348010000001",
    },
    administrator: {
      fullName: "Madrasa Head", position: "Proprietor", email: "m@visible.example",
      phone: "+2348010000002", password: "VisiblePass123!",
    },
    termsAccepted: true,
  });
  assert.equal(madrasa.status, 200);

  const academy = await anon.req("POST", "/api/public/register-academy", {
    category: "western",
    academy: {
      name: "Visible Academy", institutionType: "Nursery & Primary School",
      state: "Lagos", city: "Ikeja", address: "2 Visible Ave", phone: "+2348020000001",
    },
    administrator: {
      fullName: "Academy Head", position: "Principal", email: "a@visible.example",
      phone: "+2348020000002", password: "VisiblePass123!",
    },
    termsAccepted: true,
  });
  assert.equal(academy.status, 200);

  // Both must be visible to the super admin, tagged with the right category.
  const all = await sa.api("GET", "/api/platform/registrations");
  assert.equal(all.status, 200);
  const names = all.data.registrations.map((r) => r.name);
  assert.ok(names.includes("Visible Madrasa"), "the madrasa registration is listed");
  assert.ok(names.includes("Visible Academy"), "the academy registration is listed");

  const m = all.data.registrations.find((r) => r.name === "Visible Madrasa");
  const a = all.data.registrations.find((r) => r.name === "Visible Academy");
  assert.equal(m.category, "islamic");
  assert.equal(a.category, "western");
  assert.equal(m.status, "Pending");
  assert.equal(a.status, "Pending");

  // ...and under the Pending filter the Overview badge counts.
  const pending = await sa.api("GET", "/api/platform/registrations?status=Pending");
  assert.equal(pending.status, 200);
  const pendingNames = pending.data.registrations.map((r) => r.name);
  assert.ok(pendingNames.includes("Visible Madrasa"));
  assert.ok(pendingNames.includes("Visible Academy"));

  // The detail endpoint the Review modal calls must resolve for both.
  for (const row of [m, a]) {
    const detail = await sa.api("GET", `/api/platform/registrations/${row.id}`);
    assert.equal(detail.status, 200, `detail for ${row.name}`);
    assert.equal(detail.data.registration.name, row.name);
    assert.equal(detail.data.registration.admin_password_hash, undefined,
      "the stored password hash is never sent to the browser");
  }
});

test("a registration that cannot be stored returns an error instead of a phantom reference", async () => {
  const db = require("../server/db");
  const anon = new Client(ctx.base);

  const before = await db.get("SELECT COUNT(*) AS n FROM madrasa_registrations");

  const realRun = db.run.bind(db);
  db.run = async (sql, params) => {
    if (/INSERT INTO madrasa_registrations/i.test(sql)) throw new Error("simulated storage failure");
    return realRun(sql, params);
  };
  let res;
  try {
    res = await anon.req("POST", "/api/public/register-madrasa", {
      madrasa: {
        name: "Doomed Madrasa", state: "Ogun", city: "Ijebu-Ode",
        address: "3 Nowhere St", phone: "+2348030000001",
      },
      administrator: {
        fullName: "Nobody", position: "Head", email: "n@doomed.example",
        phone: "+2348030000002", password: "DoomedPass123!",
      },
      termsAccepted: true,
    });
  } finally {
    db.run = realRun;
  }

  assert.equal(res.status, 500, "the failure is reported to the applicant");
  assert.ok(!(res.data && res.data.ok), "no success payload is returned");
  assert.ok(!(res.data && res.data.registration), "no reference number is minted for a row that does not exist");

  const after = await db.get("SELECT COUNT(*) AS n FROM madrasa_registrations");
  assert.equal(Number(after.n), Number(before.n), "nothing was written");
});

test("neither registration form fabricates a reference number when the API fails", () => {
  // The old code generated `"REG-" + year + random` in the catch block and
  // jumped to the success screen, which is what made a submission look
  // accepted while the platform had no record of it.
  for (const [name, src] of [["register.js", REG_JS], ["register-academy.js", ACADEMY_JS]]) {
    const catches = src.split(/\bcatch\b/).slice(1).join("\ncatch");
    assert.ok(!/"REG-"\s*\+\s*new Date\(\)\.getFullYear\(\)/.test(catches),
      `${name} must not mint a fake registration id in a catch block`);
    assert.ok(/state\.errors\.submit\s*=/.test(src),
      `${name} surfaces a submission error to the user`);
  }
});

/* ------------------------------------------------------------------ */
/* 2-3. Theme tokens reach detached overlays; super admin has a theme  */
/* ------------------------------------------------------------------ */

test("the colour palette is declared on <body>, so modals and toasts inherit it", () => {
  // Modals/toasts are appended to document.body, outside .dash-root. If the
  // custom properties are scoped to .dash-root they resolve to nothing there.
  assert.ok(/document\.body\.appendChild\(wrap\)/.test(DASH_JS),
    "modals/toasts are still mounted on <body> (the condition this guards)");

  assert.ok(/^body\.dash-islamic\s*\{/m.test(CSS), "the islamic palette is declared on body");
  assert.ok(/^body\.dash-western\s*\{/m.test(CSS), "the western palette is declared on body");
  assert.ok(!/body\.dash-islamic\s+\.dash-root\s*\{/.test(CSS),
    "the islamic palette must NOT be scoped to .dash-root");
  assert.ok(!/body\.dash-western\s+\.dash-root\s*\{/.test(CSS),
    "the western palette must NOT be scoped to .dash-root");

  // A neutral fallback keeps the theme-less login screen legible.
  assert.ok(/:root\s*\{[^}]*--d-surface:/.test(CSS), "a :root fallback palette exists");
});

test("the super admin has its own theme instead of borrowing the Islamic School identity", () => {
  assert.ok(/^body\.dash-super\s*\{/m.test(CSS), "a dash-super palette exists");
  for (const token of ["--d-bg", "--d-surface", "--d-text", "--d-muted", "--d-line", "--d-accent", "--d-sidebar-bg"]) {
    const block = CSS.split("body.dash-super {")[1].split("}")[0];
    assert.ok(block.includes(token + ":"), `dash-super defines ${token}`);
  }
  assert.ok(/applyTheme\(\s*state\.superAdmin\s*\?\s*"super"/.test(DASH_JS),
    "the dashboard applies the super theme for super admins");
  assert.ok(/classList\.remove\("dash-islamic", "dash-western", "dash-super"\)/.test(DASH_JS),
    "themes are mutually exclusive");
});

/* ------------------------------------------------------------------ */
/* 4. Contrast                                                         */
/* ------------------------------------------------------------------ */

function srgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** Flattens `fg` at `alpha` over `bg` — how the tinted pills actually paint. */
function composite(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}
function tokensOf(selector) {
  const block = CSS.split(selector + " {")[1].split("}")[0];
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

test("state colours meet WCAG AA (4.5:1) on the tinted pill backgrounds they are painted on", () => {
  const WHITE = srgb("#ffffff");
  // Tint alphas come from the .dash-pill.* rules in dashboard.css.
  const cases = [["--d-ok", 0.12], ["--d-warn", 0.14], ["--d-info", 0.12]];

  for (const theme of ["body.dash-islamic", "body.dash-western", "body.dash-super"]) {
    const tokens = tokensOf(theme);
    for (const [token, alpha] of cases) {
      const fg = srgb(tokens[token]);
      const ratio = contrast(fg, composite(fg, alpha, WHITE));
      assert.ok(ratio >= 4.5,
        `${theme} ${token} (${tokens[token]}) is ${ratio.toFixed(2)}:1 on its own tint — needs >= 4.5:1`);
    }
    // Danger pills use a solid #fdecea background.
    const danger = srgb(tokens["--d-danger"]);
    const dRatio = contrast(danger, srgb("#fdecea"));
    assert.ok(dRatio >= 4.5,
      `${theme} --d-danger is ${dRatio.toFixed(2)}:1 on #fdecea — needs >= 4.5:1`);
    // Muted body text (hints, crumbs, chart labels, table meta) must hold up
    // on every surface it is painted on, not just white.
    for (const surface of ["--d-bg", "--d-surface", "--d-surface-2"]) {
      const muted = contrast(srgb(tokens["--d-muted"]), srgb(tokens[surface]));
      assert.ok(muted >= 4.5,
        `${theme} --d-muted is ${muted.toFixed(2)}:1 on ${surface} — needs >= 4.5:1`);
    }
    // Primary body text.
    const text = contrast(srgb(tokens["--d-text"]), srgb(tokens["--d-bg"]));
    assert.ok(text >= 7,
      `${theme} --d-text is ${text.toFixed(2)}:1 on --d-bg — needs >= 7:1 (AAA body copy)`);
  }
});

/* ------------------------------------------------------------------ */
/* 5. Markup escaping                                                  */
/* ------------------------------------------------------------------ */

test("statCard renders a numeric suffix as markup, not as escaped text", () => {
  assert.ok(/function statCard\(icon, value, label, accent, sub\)/.test(DASH_JS),
    "statCard takes a dedicated `sub` argument");
  assert.ok(/dash-stat-sub/.test(CSS), "the suffix has a style");
  // The Overview must not shove raw HTML through the escaped `value` argument.
  assert.ok(!/statCard\("building",\s*`\$\{Number\(data\.activeMadaris\)\}<small/.test(DASH_JS),
    "the Active/Total card no longer passes markup through the escaped value");
});

test("the registrations status filter survives a re-render", () => {
  // It used to be stashed on #dashContent, which every hashchange rebuilt.
  assert.ok(!/content\.setAttribute\("data-sa-reg-status"/.test(DASH_JS),
    "the filter is not stored on a rebuilt DOM node");
  assert.ok(/state\.regStatusFilter/.test(DASH_JS), "the filter lives in app state");
});

test("platform stats failing does not zero the pending-registrations badge", async () => {
  // Both requests are settled independently, so one failing cannot blank the
  // other. Verify the endpoints the Overview depends on answer separately.
  const stats = await sa.api("GET", "/api/platform/stats");
  assert.equal(stats.status, 200);
  const regs = await sa.api("GET", "/api/platform/registrations?status=Pending");
  assert.equal(regs.status, 200);
  assert.ok(Array.isArray(regs.data.registrations));
  assert.ok(!/\[data, regs\] = await Promise\.all\(\[\s*window\.API\.get\("\/platform\/stats"\),/.test(
    DASH_JS.replace(/\.catch\(\(\) => null\)/g, "")
  ) || /catch\(\(\) => null\)/.test(DASH_JS), "the stats call has its own catch");
});
