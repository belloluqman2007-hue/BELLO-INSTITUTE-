"use strict";
/* ============================================================================
   DELIVERY PROVIDERS UI — browser-level regression
   ----------------------------------------------------------------------------
   Drives the real admin SPA in jsdom to prove the additive delivery screens are
   wired to the API rather than merely present:
     • Settings → Notifications keeps its existing preferences form AND gains a
       "Delivery providers" table with a per-channel status and test button
     • no API key, password or token ever reaches the browser
     • Communication → Parent Communication keeps its directory and gains the
       Bulk send and Delivery log tabs, both rendering live API data
     • everything reuses the shared dash-* design system
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
  const vc = new VirtualConsole();
  const dom = await JSDOM.fromURL(base + "/admin", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.prompt = () => "08031234567";
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
  window.document.querySelector("#dlUser").value = username;
  window.document.querySelector("#dlPass").value = PASSWORD;
  window.document.querySelector("#dashLoginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 100 && !window.document.querySelector("#dashContent"); i++) await sleep(50);
  assert.ok(window.document.querySelector("#dashContent"), "authenticated dashboard shell rendered");
  await sleep(900);
  return {
    window, content: () => window.document.querySelector("#dashContent"),
    async route(route) { window.BelloDashboard.go(route); await sleep(1000); },
    close() { window.close(); },
  };
}

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { if (ctx) await ctx.close(); });

test("Settings → Notifications keeps its preferences and adds a delivery providers section", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("settings/notifications");
    const content = page.content();

    // Existing functionality is untouched.
    assert.ok(content.querySelector("#notificationSettings"), "the existing preferences form still renders");
    assert.ok(content.querySelector("[name=notification_email]"), "the notification contact field survives");

    // New, additive section.
    const host = content.querySelector("#deliveryProviders");
    assert.ok(host, "the delivery providers section rendered");
    assert.match(host.textContent, /Delivery providers/i);
    for (const label of ["Email", "SMS", "WhatsApp"]) assert.match(host.textContent, new RegExp(label));

    // Providers are all "none" in tests, so each shows the grey dash and a
    // disabled test button — never a false "configured" tick.
    const buttons = host.querySelectorAll("[data-test-channel]");
    assert.equal(buttons.length, 3, "one test button per channel");
    for (const b of buttons) assert.equal(b.disabled, true, "test is disabled while the provider is off");
    assert.equal(host.querySelectorAll(".dash-pill.ok").length, 0, "nothing is ticked green");

    // Shared design system, not a parallel one.
    assert.ok(host.querySelector(".dash-card") && host.querySelector(".dash-table"));

    // No credential of any kind is present in the rendered HTML.
    for (const secret of ["apiKey", "api_key", "authToken", "auth_token", "SMTP_PASS", "password"]) {
      assert.ok(!host.innerHTML.includes(secret), `${secret} leaked into the UI`);
    }
  } finally { page.close(); }
});

test("Parent Communication keeps the directory and adds bulk send + delivery log tabs", { skip }, async () => {
  const page = await openAdmin(ctx.base, "admin-a");
  try {
    await page.route("communication/parents");
    const content = page.content();

    // Existing screen intact.
    assert.ok(content.querySelector("#messageParents"), "the existing Contact parents action survives");
    assert.ok(content.querySelector(".dash-table"), "the parent directory table still renders");

    const tabs = content.querySelectorAll("[data-comm-tab]");
    assert.equal(tabs.length, 3, "directory, bulk send and delivery log tabs");

    // Bulk send tab renders a live audience list from /api/classes.
    [...tabs].find((t) => t.dataset.commTab === "bulk").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(900);
    const form = content.querySelector("#bulkSendForm");
    assert.ok(form, "the bulk send form rendered");
    const targets = [...form.elements.target.options].map((o) => o.value);
    assert.ok(targets.includes("all_parents") && targets.includes("outstanding_fees"));
    assert.ok(targets.some((v) => /^class:\d+$/.test(v)), "real classes are offered as an audience");
    assert.deepEqual([...form.elements.channel.options].map((o) => o.value), ["sms", "email", "whatsapp"]);

    // Delivery log tab renders the API columns.
    [...tabs].find((t) => t.dataset.commTab === "log").dispatchEvent(new page.window.Event("click", { bubbles: true }));
    await sleep(900);
    const panel = content.querySelector("#commTabPanel");
    assert.match(panel.textContent, /Delivery log/i);
    const headers = [...panel.querySelectorAll("th")].map((th) => th.textContent.trim().toLowerCase());
    assert.deepEqual(headers, ["channel", "recipient", "status", "sent at", "error"]);
    assert.ok(panel.querySelector(".dash-card"), "reuses the shared card component");
  } finally { page.close(); }
});
