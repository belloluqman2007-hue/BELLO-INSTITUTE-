/* Full-app contrast audit: public pages + authenticated dashboard routes,
   at desktop (1280) and mobile (390). */
const fs = require("fs");
const { open, auditDoc, sleep, BASE } = require("./audit");

const PUBLIC_PAGES = [
  ["home", "/"],
  ["islamic-schools", "/islamic-schools"],
  ["western-schools", "/western-schools"],
  ["register-madrasa", "/register-madrasa"],
  ["register-academy", "/register-academy"],
  ["login", "/login"],
];

const ADMIN_ROUTES = [
  "dashboard",
  "institution/profile", "institution/information", "institution/website",
  "institution/appearance", "institution/pages", "institution/gallery",
  "institution/contact", "institution/settings",
  "students/all", "students/add", "students/applications", "students/groups",
  "students/profiles", "students/id-cards",
  "documents/templates", "documents/issue",
  "teachers/all", "teachers/add", "teachers/applications", "teachers/profiles",
  "classes/all", "classes/add", "classes/timetable", "classes/students", "classes/teachers",
  "attendance/students", "attendance/teachers", "attendance/reports",
  "academic/lessons", "academic/assignments", "academic/examinations",
  "academic/results", "academic/report-cards", "academic/sessions", "academic/terms",
  "admissions/applications", "admissions/status", "admissions/requirements", "admissions/settings",
  "library/catalogue", "library/issue", "library/loans", "library/overdue", "library/reports",
  "communication/announcements", "communication/messages", "communication/notifications", "communication/parents",
  "finance/fees", "finance/payments", "finance/outstanding", "finance/records", "finance/reports",
  "finance/expenses/categories", "finance/expenses/record", "finance/expenses",
  "finance/expenses/budget", "finance/expenses/reports",
  "payroll/structures", "payroll/periods", "payroll/payslips", "payroll/advances",
  "hr/requests", "hr/calendar", "hr/balances", "hr/types", "hr/my-leave",
  "quran/progress", "quran/memorization", "quran/revision", "quran/tajweed", "quran/reports",
  "settings/institution", "settings/account", "settings/staff", "settings/roles",
  "settings/security", "settings/notifications",
];

const SUPER_ROUTES = [
  "platform", "platform/madaris", "platform/registrations", "platform/plans",
  "platform/analytics", "platform/activity", "platform/backups", "platform/settings",
];

async function loginCookie(username, password) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${await r.text()}`);
  const sc = r.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : "";
}

async function auditDashboard(label, cookie, routes, width) {
  const page = await open("/#/app/dashboard", { cookie, width });
  await sleep(2500);
  const out = [];
  for (const route of routes) {
    try {
      page.win.location.hash = "#/app/" + encodeURIComponent(route);
      page.win.dispatchEvent(new page.win.Event("hashchange"));
      await sleep(900);
      // open every collapsed sidebar group so nav labels are audited too
      page.doc.querySelectorAll("[data-nav-toggle]").forEach((b) => {
        try { if (b.getAttribute("aria-expanded") !== "true") b.click(); } catch (e) {}
      });
      await sleep(120);
      const r = auditDoc(page.doc, page.win, `${label}:${route}`, width);
      out.push(...r);
    } catch (e) {
      console.error(`  [${label}:${route}] ${e.message}`);
    }
  }
  page.close();
  return out;
}

(async () => {
  const widths = [1280, 390];
  const all = [];

  for (const width of widths) {
    console.error(`\n########## VIEWPORT ${width}px ##########`);
    for (const [name, path] of PUBLIC_PAGES) {
      const page = await open(path, { width });
      const r = auditDoc(page.doc, page.win, name, width);
      page.close();
      console.error(`  ${name} @${width}: ${r.length}`);
      all.push(...r);
    }
  }

  let adminCookie, superCookie;
  try { adminCookie = await loginCookie("demo-quraniyya-admin", "Demo1234!"); } catch (e) { console.error("admin login:", e.message); }
  const devCreds = (() => { try { return fs.readFileSync("/home/user/BELLO-INSTITUTE-/.dev-credentials.txt", "utf8"); } catch (e) { return ""; } })();
  const m = devCreds.match(/password:\s*(\S+)/);
  try { superCookie = await loginCookie("admin", m ? m[1] : ""); } catch (e) { console.error("super login:", e.message); }

  for (const width of widths) {
    if (adminCookie) {
      const r = await auditDashboard("admin", adminCookie, ADMIN_ROUTES, width);
      console.error(`  admin dashboard @${width}: ${r.length}`);
      all.push(...r);
    }
    if (superCookie) {
      const r = await auditDashboard("super", superCookie, SUPER_ROUTES, width);
      console.error(`  super dashboard @${width}: ${r.length}`);
      all.push(...r);
    }
  }

  fs.writeFileSync("/tmp/audit/results.json", JSON.stringify(all, null, 2));

  /* ---- grouped report ---- */
  const groups = new Map();
  for (const x of all) {
    const key = `${x.sel}|${x.fg}|${x.bg}`;
    if (!groups.has(key)) groups.set(key, { ...x, pages: new Set(), widths: new Set(), count: 0 });
    const g = groups.get(key);
    g.pages.add(x.page); g.widths.add(x.width); g.count++;
    if (x.ratio < g.ratio) g.ratio = x.ratio;
  }
  const sorted = [...groups.values()].sort((a, b) => a.ratio - b.ratio);
  console.log(`\n================ ${all.length} failing instances / ${sorted.length} distinct issues ================\n`);
  for (const g of sorted) {
    console.log(`${String(g.ratio).padStart(6)} (need ${g.need})  ${g.fg}${g.fgAlpha < 1 ? ` a=${g.fgAlpha}` : ""} on ${g.bg}  ${g.fontPx}px/${g.weight}`);
    console.log(`        el: ${g.sel}`);
    console.log(`        in: ${g.parent}`);
    console.log(`      text: ${JSON.stringify(g.text)}`);
    console.log(`     where: ${[...g.pages].slice(0, 6).join(", ")}${g.pages.size > 6 ? ` +${g.pages.size - 6} more` : ""}  [${[...g.widths].join("/")}px]`);
    console.log("");
  }
})();
