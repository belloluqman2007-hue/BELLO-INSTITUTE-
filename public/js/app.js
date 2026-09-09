"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — SPA
   Mobile-first, bilingual (EN/AR), role-aware routing:
     super_admin → /platform/*
     madrasa_admin → /home /students /teachers /classes /subjects /sessions
                     /results /attendance /fees /announcements /grading /settings
     teacher → /home /teach /results /attendance /announcements
     student → /home /results /announcements
     parent → /home /child/:id /announcements
   ========================================================================== */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const t = (k) => window.I18N.t(k);

  /* ------------------------------ helpers ------------------------------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  let toastTimer = null;
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }
  function errMsg(e) {
    const m = (e && e.data && e.data.message) || (e && e.data && e.data.error) || (e && e.message) || t("activity.error");
    return typeof m === "string" ? m : t("activity.error");
  }
  function pill(status) {
    const map = {
      active: ["ok", t("common.active")], promoted: ["ok", t("students.st.promoted")],
      graduated: ["info", t("students.st.graduated")], withdrawn: ["muted", t("students.st.withdrawn")],
      suspended: ["bad", t("common.suspended")], repeating: ["warn", t("results.repeating")],
      pending: ["muted", t("results.pending")], present: ["ok", t("attendance.present")],
      absent: ["bad", t("attendance.absent")], excused: ["warn", t("attendance.excused")],
    };
    const [cls, lbl] = map[status] || ["muted", esc(status || t("common.none"))];
    return `<span class="pill ${cls}">${esc(status ? lbl : t("common.none"))}</span>`;
  }
  function openModal(html, onMount) {
    closeAllModals();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal">${html}</div>`;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    if (onMount) onMount(backdrop);
  }
  function closeAllModals() { $$(".modal-backdrop").forEach((m) => m.remove()); }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* ------------------------------ auth state ---------------------------- */
  let me = null;

  async function refreshMe() {
    me = await API.me();
    return me;
  }

  function requireLogin() {
    if (!me || !me.loggedIn) { location.hash = "#/login"; return false; }
    return true;
  }

  /* ------------------------------ layout -------------------------------- */
  const ROLE_HOME = {
    super_admin: "#/platform",
    madrasa_admin: "#/home",
    teacher: "#/home",
    student: "#/home",
    parent: "#/home",
  };

  function madrasaMeta() {
    return window.__madrasa || {};
  }

  async function loadMadrasaMeta() {
    if (me.role === "madrasa_admin" || me.role === "teacher" || me.role === "student" || me.role === "parent") {
      try {
        if (me.role === "madrasa_admin") {
          const d = await API.get("/madrasa/profile");
          window.__madrasa = d.madrasa;
        } else {
          const d = await API.get("/portal/me");
          window.__madrasa = d.madrasa || {};
        }
      } catch (e) { window.__madrasa = {}; }
    }
  }

  function navItems(role) {
    const L = (key, label, icon) => ({ key, label, icon });
    if (role === "super_admin") {
      return [
        L("platform", t("nav.dashboard"), "📊"),
        L("platform/madaris", t("nav.madaris"), "🏫"),
        L("platform/plans", t("nav.plans"), "💳"),
        L("platform/activity", t("nav.activity"), "🕘"),
      ];
    }
    if (role === "madrasa_admin") {
      return [
        L("home", t("nav.dashboard"), "📊"),
        L("students", t("nav.students"), "🎓"),
        L("teachers", t("nav.teachers"), "👨‍🏫"),
        L("classes", t("nav.classes"), "📚"),
        L("subjects", t("nav.subjects"), "📖"),
        L("sessions", t("nav.sessions"), "🗓️"),
        L("results", t("nav.results"), "📝"),
        L("attendance", t("nav.attendance"), "✅"),
        L("fees", t("nav.fees"), "💰"),
        L("announcements", t("nav.announcements"), "📢"),
        L("analytics", t("nav.analytics"), "📈"),
        L("grading", t("nav.grading"), "⚖️"),
        L("settings", t("nav.settings"), "⚙️"),
      ];
    }
    if (role === "teacher") {
      return [
        L("home", t("nav.dashboard"), "📊"),
        L("results", t("nav.results"), "📝"),
        L("attendance", t("nav.attendance"), "✅"),
        L("announcements", t("nav.announcements"), "📢"),
      ];
    }
    if (role === "student") {
      return [
        L("home", t("nav.profile"), "👤"),
        L("results", t("nav.results"), "📝"),
        L("announcements", t("nav.announcements"), "📢"),
      ];
    }
    // parent
    return [
      L("home", t("portal.children"), "👨‍👩‍👧"),
      L("announcements", t("nav.announcements"), "📢"),
    ];
  }

  function renderLayout(route) {
    const m = madrasaMeta();
    const name = me.user ? me.user.fullName || me.user.username : "";
    const items = navItems(me.role);
    const current = route || location.hash.replace(/^#\/?/, "");
    const navLinks = items
      .filter((i) => current.startsWith(i.key))
      .map((i) => `<a href="#/${i.key}" class="${current.startsWith(i.key) ? "active" : ""}">${i.icon} ${esc(i.label)}</a>`)
      .join("");
    const sidebar = items
      .map((i) => `<a href="#/${i.key}" class="${current.startsWith(i.key) ? "active" : ""}">${i.icon} ${esc(i.label)}</a>`)
      .join("");
    const madrasaName = m.name_ar && window.I18N.lang === "ar" ? m.name_ar : m.name_en;

    document.body.innerHTML = `
      <div class="layout">
        <header class="appbar">
          <div class="brand">
            ${m.logo_path ? `<img class="logo" src="${esc(m.logo_path)}" alt="">` : "🕌"}
            <span>${esc(madrasaName || t("app.name"))}</span>
          </div>
          <div class="spacer"></div>
          <button class="iconbtn" id="langBtn" title="Language">${window.I18N.lang === "ar" ? "EN" : "ع"}</button>
          <button class="iconbtn" id="logoutBtn" title="${esc(t("auth.logout"))}"></button>
        </header>
        <nav class="nav">${navLinks}</nav>
        <aside class="sidebar">${sidebar}</aside>
        <main class="main" id="view"><div class="empty">${esc(t("common.loading"))}</div></main>
      </div>`;
    $("#langBtn").addEventListener("click", () => {
      const next = window.I18N.lang === "ar" ? "en" : "ar";
      window.I18N.setLang(next);
      renderLayout(current);
      routeTo(current);
    });
    $("#logoutBtn").addEventListener("click", async () => {
      try { await API.logout(); } catch (e) { /* ignore */ }
      me = null;
      location.hash = "#/login";
    });
    window.scrollTo(0, 0);
  }

  function view() { return $("#view"); }
  function render(html) { const v = view(); if (v) v.innerHTML = html; window.I18N.applyStatic(v); }

  /* ------------------------------ router -------------------------------- */
  const routes = {};
  function route(path, handler) { routes[path] = handler; }

  async function routeTo(rawPath) {
    const path = (rawPath || "").replace(/^\/+/, "");
    let handler = routes[path];
    let params = {};
    if (!handler) {
      // parameterized match: "students/:id" etc.
      for (const [key, h] of Object.entries(routes)) {
        if (!key.includes(":")) continue;
        const kparts = key.split("/");
        const pparts = path.split("/");
        if (kparts.length !== pparts.length) continue;
        const p = {};
        let match = true;
        for (let i = 0; i < kparts.length; i++) {
          if (kparts[i].startsWith(":")) p[kparts[i].slice(1)] = decodeURIComponent(pparts[i] || "");
          else if (kparts[i] !== pparts[i]) { match = false; break; }
        }
        if (match) { handler = h; params = p; break; }
      }
    }
    if (!handler) {
      if (me && me.loggedIn) { renderLayout(path); render(`<div class="empty">${esc(t("activity.notFound"))}</div>`); }
      else location.hash = "#/login";
      return;
    }
    // The login screen is the app's PUBLIC entry point: it must render for
    // logged-out visitors too (otherwise a fresh visitor is stuck forever on
    // the boot "Loading…" element — every route was behind requireLogin).
    const isLoginRoute = path === "login";
    if (!isLoginRoute && !requireLogin()) return;
    if (!isLoginRoute) renderLayout(path);
    try {
      await handler(params);
    } catch (e) {
      console.error(e);
      if (e.status === 401) { me = null; location.hash = "#/login"; return; }
      toast(errMsg(e), "err");
    }
  }

  window.addEventListener("hashchange", () => routeTo(location.hash.replace(/^#\/?/, "")));

  /* ====================================================================== */
  /*  LOGIN                                                                  */
  /* ====================================================================== */
  route("login", async function () {
    if (me && me.loggedIn) { location.hash = ROLE_HOME[me.role]; return; }
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>🕌 ${esc(t("app.name"))}</h1>
          <div class="sub">${esc(t("app.tagline"))}</div>
          <div id="loginMsg"></div>
          <form id="loginForm">
            <label data-i18n="auth.username">${esc(t("auth.username"))}</label>
            <input id="loginUser" autocomplete="username" required>
            <label data-i18n="auth.password">${esc(t("auth.password"))}</label>
            <input id="loginPass" type="password" autocomplete="current-password" required>
            <div class="form-actions">
              <button class="btn" id="loginBtn" style="flex:1" type="submit">${esc(t("auth.loginBtn"))}</button>
              <button class="btn secondary" type="button" id="loginLang">${window.I18N.lang === "ar" ? "English" : "العربية"}</button>
            </div>
          </form>
        </div>
      </div>`;
    window.I18N.applyStatic(document.body);
    $("#loginLang").addEventListener("click", () => {
      window.I18N.setLang(window.I18N.lang === "ar" ? "en" : "ar");
      routeTo("login");
    });
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#loginBtn").disabled = true;
      $("#loginBtn").textContent = t("auth.loggingIn");
      try {
        const d = await API.login($("#loginUser").value.trim(), $("#loginPass").value);
        me = await refreshMe();
        await loadMadrasaMeta();
        location.hash = ROLE_HOME[d.role] || ROLE_HOME[me.role];
      } catch (err) {
        $("#loginMsg").innerHTML = `<div class="msg err">${esc(errMsg(err))}</div>`;
        $("#loginBtn").disabled = false;
        $("#loginBtn").textContent = t("auth.loginBtn");
      }
    });
  });

  /* ====================================================================== */
  /*  SUPER ADMIN                                                            */
  /* ====================================================================== */
  /* ====================================================================== */
  /*  ANALYTICS — shared chart/panel builders (js/charts.js does the drawing) */
  /* ====================================================================== */
  const C = () => window.Charts;

  /** Picks the Arabic or English name of a record, honouring the UI language. */
  function nm(rec) {
    const r = rec || {};
    const useAr = window.I18N.lang === "ar";
    const ar = r.labelAr || r.nameAr || r.name_ar || r.classAr || "";
    const en = r.label || r.nameEn || r.name_en || r.classEn || "";
    return (useAr && ar) ? ar : en;
  }

  function monthsLabel(n) { return t("an.months" + n) !== "an.months" + n ? t("an.months" + n) : n + "m"; }
  function daysLabel(n) { return t("an.days" + n) !== "an.days" + n ? t("an.days" + n) : n + "d"; }

  function kpi(value, label, sub, tone) {
    return `<div class="kpi ${tone || ""}"><div class="k-num">${esc(value)}</div>` +
      `<div class="k-lbl">${esc(label)}</div>` +
      (sub ? `<div class="k-sub">${esc(sub)}</div>` : "") + `</div>`;
  }

  function chartCard(title, note, body) {
    return `<div class="card chart-card"><div class="chart-head">` +
      `<span class="ch-title">${esc(title)}</span>` +
      (note ? `<span class="ch-note">${esc(note)}</span>` : "") +
      `</div>${body}</div>`;
  }

  function kpiRow(a) {
    const c = C();
    const feeTone = a.fees.collectionRate >= 80 ? "ok" : a.fees.collectionRate >= 50 ? "warn" : "danger";
    return `<div class="kpis">` +
      kpi(a.totals.students, t("an.students"), `${a.totals.classes} ${t("an.classes")} · ${a.totals.teachers} ${t("an.teachers")}`) +
      kpi(a.attendance.rate + "%", t("an.attendanceRate"), `${a.attendance.marked} ${t("an.marked")}`, "accent") +
      kpi(c.money(a.fees.collected), t("an.collected"), `${t("an.outstanding")} ${c.money(a.fees.outstanding)}`, feeTone) +
      kpi(a.results.average == null ? "—" : a.results.average + "%", t("an.average"),
        a.results.summaries ? `${a.results.passRate}% ${t("an.passRate")}` : t("an.noData"), "ok") +
      `</div>`;
  }

  function enrolmentPanels(a) {
    const c = C();
    const noData = t("an.noData");
    const classes = a.enrolment.byClass.map((x) => ({ label: nm(x), value: x.value }));
    return `<div class="grid cols-2">` +
      chartCard(t("an.enrolmentTrend"), monthsLabel(a.window.months),
        c.bar(a.enrolment.trend, { format: c.int, emptyText: noData })) +
      chartCard(t("an.byClass"), `${a.totals.students}`,
        c.hbar(classes, { format: c.int, emptyText: noData })) +
      `</div><div class="grid cols-2">` +
      chartCard(t("an.byGender"), "",
        c.donut(a.enrolment.byGender.map((x) => ({ label: t("an." + x.key), value: x.value })),
          { centerLabel: t("an.students"), emptyText: noData })) +
      chartCard(t("an.ageBands"), "",
        c.bar(a.enrolment.ageBands.map((x) => ({ label: t("an.age." + x.key), value: x.value })),
          { format: c.int, emptyText: noData })) +
      `</div>`;
  }

  function attendancePanels(a) {
    const c = C();
    const noData = t("an.noData");
    const at = a.attendance;
    return `<div class="grid cols-2">` +
      chartCard(t("an.attendanceTrend"), `${at.marked} ${t("an.marked")}`,
        c.line(at.daily, { max: 100, nice: false, format: (v) => v + "%", axisFormat: (v) => v + "%", emptyText: noData })) +
      chartCard(t("an.attendance"), daysLabel(a.window.attendanceDays),
        c.donut([
          { label: t("an.present"), value: at.present },
          { label: t("an.absent"), value: at.absent },
          { label: t("an.excused"), value: at.excused },
        ], { centerLabel: t("an.attendanceRate"), centerValue: at.rate + "%", emptyText: noData })) +
      `</div>`;
  }

  function feePanels(a) {
    const c = C();
    const noData = t("an.noData");
    return `<div class="grid cols-2">` +
      chartCard(t("an.collectionTrend"), monthsLabel(a.window.months),
        c.bar(a.fees.trend, { format: c.money, emptyText: noData })) +
      chartCard(t("an.byMethod"), `${t("an.collectionRate")} ${a.fees.collectionRate}%`,
        c.donut(a.fees.byMethod.map((x) => ({ label: x.key, value: x.value })),
          { format: c.money, centerLabel: t("an.collected"), centerValue: c.money(a.fees.collected), emptyText: noData })) +
      `</div>`;
  }

  function performancePanels(a) {
    const c = C();
    const noData = t("an.noData");
    const r = a.results;
    const termName = a.term ? nm({ label: a.term.nameEn, labelAr: a.term.nameAr }) : "";
    return `<div class="grid cols-2">` +
      chartCard(t("an.gradeDist"), termName,
        c.bar(r.gradeDistribution.map((g) => ({ label: g.grade, value: g.value })),
          { nice: false, format: c.int, emptyText: noData })) +
      chartCard(t("an.classRanking"), `${r.summaries} ${t("an.studentsGraded")}`,
        c.hbar(r.classRanking.map((x) => ({ label: nm(x), value: x.value, sub: `${x.students}` })),
          { max: 100, format: c.one, suffix: "%", emptyText: noData })) +
      `</div>` +
      chartCard(t("an.termTrend"), "",
        c.line(r.termTrend.map((x) => ({ label: nm(x), value: x.value })),
          { max: 100, nice: false, format: (v) => v + "%", axisFormat: (v) => v + "%", emptyText: noData }));
  }

  function watchPanel(a) {
    const rows = a.watchList.map((w) => {
      const name = window.I18N.lang === "ar" && w.nameAr ? w.nameAr : w.name;
      const tags = w.reasons.map((r) =>
        `<span class="tag ${r === "low_attendance" ? "warn" : ""}">${esc(t(r === "low_attendance" ? "an.lowAttendance" : "an.lowGrades"))}</span>`
      ).join(" ");
      return `<a class="watch-row" href="#/students/${w.id}">` +
        `<span class="who"><b>${esc(name)}</b> <span class="mono muted small">${esc(w.admissionNo)}</span>` +
        `<span class="muted small"> · ${esc(nm({ label: w.classEn, labelAr: w.classAr }))}</span></span>` +
        `<span class="metrics">` +
        (w.average != null ? `<span title="${esc(t("an.average"))}">${esc(w.average)}%</span>` : "") +
        (w.attendanceRate != null ? `<span title="${esc(t("an.attendanceRate"))}">✅ ${esc(w.attendanceRate)}%</span>` : "") +
        `</span>${tags}</a>`;
    }).join("");
    const note = a.term ? `${t("an.forTerm")} ${nm({ label: a.term.nameEn, labelAr: a.term.nameAr })}` : "";
    return chartCard("⚠️ " + t("an.watchList"), note,
      rows || `<div class="empty">${esc(t("an.watchEmpty"))}</div>`);
  }

  function rangeBar(state) {
    const seg = (group, items, current) =>
      `<span class="segs" data-group="${esc(group)}">` +
      items.map(([v, lbl]) =>
        `<button type="button" data-v="${v}" class="${Number(current) === v ? "on" : ""}">${esc(lbl)}</button>`).join("") +
      `</span>`;
    return `<div class="card chart-card"><div class="chart-head">` +
      `<span class="ch-title">${esc(t("an.title"))}</span>` +
      `<span class="ch-note">${esc(t("an.generated"))} ${esc(new Date().toLocaleString())}</span></div>` +
      `<div class="form-actions" style="gap:8px;flex-wrap:wrap">` +
      `<label class="muted small">${esc(t("an.range"))}</label>` +
      seg("months", [[6, t("an.months6")], [12, t("an.months12")], [24, t("an.months24")]], state.months) +
      `<label class="muted small">${esc(t("an.attWindow"))}</label>` +
      seg("days", [[14, t("an.days14")], [30, t("an.days30")], [60, t("an.days60")], [90, t("an.days90")]], state.days) +
      `</div></div>`;
  }

  const SA = (h) => async function () {
    if (!requireLogin()) return;
    if (me.role !== "super_admin") { render(`<div class="empty">403</div>`); return; }
    await h();
  };

  route("platform", SA(async function () {
    const [st, an] = await Promise.all([
      API.get("/platform/stats"),
      API.get("/platform/analytics?months=12").catch(() => null),
    ]);
    const c = C();
    const noData = t("an.noData");

    if (!an || !an.analytics) {
      // Analytics endpoint unavailable: keep the original counters-only view.
      render(`
        <h1>${esc(t("platform.title"))}</h1>
        <div class="kpis">
          ${kpi(st.madaris, t("pf.madaris"), `${st.activeMadaris} ${t("common.active")}`)}
          ${kpi(st.students, t("pf.students"))}
          ${kpi(st.teachers, t("an.teachers"), "", "accent")}
          ${kpi(st.parents, t("an.parents"))}
        </div>`);
      return;
    }

    const a = an.analytics;
    render(`
      <h1>${esc(t("platform.title"))}</h1>
      <div class="kpis">
        ${kpi(a.totals.madaris, t("pf.madaris"), `${a.totals.activeMadaris} ${t("common.active")}`)}
        ${kpi(a.totals.students, t("pf.students"), `+${a.totals.newStudents30d} · ${t("pf.newStudents30d")}`, "accent")}
        ${kpi(a.totals.users, t("pf.users"), `${a.totals.teachers} ${t("an.teachers")} · ${a.totals.parents} ${t("an.parents")}`)}
        ${kpi(c.money(a.totals.feesCollected), t("pf.feesCollected"), "", "ok")}
      </div>
      <div class="grid cols-2">
        ${chartCard(t("pf.madrasaTrend"), monthsLabel(12), c.bar(a.madrasaTrend, { format: c.int, emptyText: noData }))}
        ${chartCard(t("pf.studentTrend"), monthsLabel(12), c.bar(a.studentTrend, { format: c.int, tone: "accent", emptyText: noData }))}
      </div>
      <div class="grid cols-2">
        ${chartCard(t("pf.feeTrend"), monthsLabel(12), c.bar(a.feeTrend, { format: c.money, emptyText: noData }))}
        ${chartCard(t("pf.activityTrend"), "", c.line(a.activity.daily, { format: c.int, emptyText: noData }))}
      </div>
      <div class="grid cols-2">
        ${chartCard(t("pf.byPlan"), "", c.donut(a.byPlan.map((x) => ({ label: x.label, value: x.madaris })), { format: c.int, centerLabel: t("pf.madaris"), emptyText: noData }))}
        ${chartCard(t("pf.topMadaris"), "", c.hbar(a.topMadaris.map((m) => ({ label: nm(m), value: m.students, sub: m.slug })), { format: c.int, emptyText: noData }))}
      </div>
      <h2>${esc(t("platform.plans"))}</h2>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>${esc(t("platform.plan"))}</th><th>${esc(t("pf.madaris"))}</th><th>${esc(t("pf.students"))}</th></tr>
        ${a.byPlan.map((x) => `<tr><td><b>${esc(x.label)}</b> <span class="mono muted small">${esc(x.code)}</span></td><td>${x.madaris}</td><td>${x.students}</td></tr>`).join("")}
      </table></div></div>
      <h2>${esc(t("pf.topActions"))}</h2>
      <div class="card">${c.hbar(a.activity.topActions, { format: c.int, emptyText: noData })}</div>
      <h2>${esc(t("pf.recentMadaris"))}</h2>
      <div class="card">
        ${a.recentMadaris.map((m) => `<a class="reportlink" href="#/platform/madaris/${m.id}"><div><b>${esc(nm(m))}</b> <span class="mono muted small">${esc(m.slug)}</span><div class="muted small">${esc(m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "")}</div></div><span class="pill ${m.status === "active" ? "ok" : "bad"}">${esc(m.status)}</span></a>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
      </div>
      <h2>${esc(t("dash.recentActivity"))}</h2>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>Time</th><th>Madrasa</th><th>User</th><th>Action</th></tr>
        ${st.recentActivity.map((x) => `<tr>
          <td class="muted">${esc(new Date(x.created_at).toLocaleString())}</td>
          <td>${esc(x.madrasa_slug || "—")}</td>
          <td>${esc(x.username || "—")}</td>
          <td>${esc(x.action)}</td>
        </tr>`).join("") || `<tr><td colspan="4" class="empty">${esc(t("common.noData"))}</td></tr>`}
      </table></div></div>`);
  }));

  route("platform/madaris", SA(async function () {
    const d = await API.get("/platform/madaris");
    render(`
      <h1>${esc(t("nav.madaris"))}</h1>
      <button class="btn" id="addBtn">+ ${esc(t("platform.add"))}</button>
      <div class="card mt0">
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("platform.plan"))}</th><th>${esc(t("platform.students"))}</th><th>${esc(t("common.status"))}</th><th></th></tr>
          ${d.madaris.map((m) => `<tr>
            <td><a href="#/platform/madaris/${m.id}"><b>${esc(m.name_en)}</b></a><div class="muted small">${esc(m.name_ar)}</div></td>
            <td><span class="pill gold">${esc(m.plan_code)}</span></td>
            <td>${m.student_count}</td>
            <td>${m.status === "active" ? pill("active") : pill("suspended")}</td>
            <td><a class="btn small secondary" href="#/platform/madaris/${m.id}">${esc(t("common.edit"))}</a></td>
          </tr>`).join("")}
        </table></div>
      </div>`);
    $("#addBtn").addEventListener("click", () => madrasaForm());
  }));

  function madrasaForm(existing) {
    const m = existing || {};
    let plans = window.__plans || [];
    // The plans list is only cached by the Plans page (platform/plans). If the
    // super admin lands here first, the dropdown would be EMPTY and the save
    // would fail with "Unknown plan." — so load the plans on demand.
    if (!plans.length) {
      API.get("/platform/plans").then((d) => {
        window.__plans = d.plans || [];
        madrasaForm(existing);
      }).catch((e) => toast(errMsg(e), "err"));
      return;
    }
    if (existing) {
      // Keep the madrasa's current plan selectable even when deactivated.
      plans = plans.filter((p) => p.is_active || Number(p.id) === Number(existing.plan_id));
    } else {
      plans = plans.filter((p) => p.is_active);
    }
    openModal(`
      <h2>${esc(existing ? t("common.edit") : t("platform.add"))}</h2>
      <label data-i18n="platform.slug">${esc(t("platform.slug"))} *</label>
      <input id="fSlug" value="${esc(m.slug || "")}" ${existing ? "disabled" : ""} required>
      <label data-i18n="common.nameEn">${esc(t("common.nameEn"))} *</label>
      <input id="fNameEn" value="${esc(m.name_en || "")}" required>
      <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label>
      <input id="fNameAr" dir="rtl" value="${esc(m.name_ar || "")}">
      <div class="row">
        <div><label>${esc(t("common.city"))}</label><input id="fCity" value="${esc(m.city || "")}"></div>
        <div><label>${esc(t("settings.state"))}</label><input id="fState" value="${esc(m.state_name || "")}"></div>
      </div>
      <label data-i18n="common.phone">${esc(t("common.phone"))}</label>
      <input id="fPhone" value="${esc(m.phone || "")}">
      <label data-i18n="platform.plan">${esc(t("platform.plan"))} *</label>
      <select id="fPlan">${plans.map((p) => `<option value="${p.id}" ${Number(m.plan_id) === p.id ? "selected" : ""}>${esc(p.name)} (${esc(p.code)})</option>`).join("")}</select>
      ${existing ? "" : `
      <hr class="divider">
      <h3>${esc(t("platform.adminAccount"))} *</h3>
      <label data-i18n="teachers.username">${esc(t("teachers.username"))} *</label>
      <input id="fAdminUser" required>
      <label data-i18n="auth.password">${esc(t("auth.password"))} * <span class="muted small">(min 8)</span></label>
      <input id="fAdminPass" type="password" minlength="8" required>
      <label>${esc(t("common.name"))}</label>
      <input id="fAdminName">`
      }
      <div class="form-actions">
        <button class="btn" id="fSave">${esc(t("common.save"))}</button>
        <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
      </div>`,
      async (modal) => {
        $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
        $("#fSave", modal).addEventListener("click", async () => {
          const slug = $("#fSlug", modal).value.trim();
          const nameEn = $("#fNameEn", modal).value.trim();
          const planId = Number($("#fPlan", modal).value) || 0;
          if (!slug || !nameEn) { toast(`${t("platform.slug")} / ${t("common.nameEn")} — ${t("common.required")}`, "err"); return; }
          if (!planId) { toast(`${t("platform.plan")} — ${t("common.required")}`, "err"); return; }
          const body = {
            slug,
            name_en: nameEn,
            name_ar: $("#fNameAr", modal).value.trim(),
            city: $("#fCity", modal).value.trim(),
            state_name: $("#fState", modal).value.trim(),
            phone: $("#fPhone", modal).value.trim(),
            plan_id: planId,
          };
          try {
            if (existing) {
              await API.patch(`/platform/madaris/${existing.id}`, body);
              toast(t("common.save") + " ✓", "ok");
            } else {
              const adminUser = $("#fAdminUser", modal).value.trim();
              const adminPass = $("#fAdminPass", modal).value;
              if (!adminUser || adminPass.length < 8) { toast(t("platform.adminRequired"), "err"); return; }
              body.admin_username = adminUser;
              body.admin_password = adminPass;
              body.admin_full_name = $("#fAdminName", modal).value.trim();
              const d = await API.post("/platform/madaris", body);
              // Tell the user plainly when the madrasa was saved but the admin
              // account was not, instead of a silent success.
              if (d.adminCreated) toast(t("platform.created"), "ok");
              else toast(`${t("platform.created")} — ${t("platform.adminMissing")}`, "warn");
              closeAllModals();
              routeTo(d.id ? "platform/madaris/" + d.id : "platform/madaris");
              return;
            }
            closeAllModals();
            routeTo("platform/madaris");
          } catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  route("platform/madaris/:id", SA(async function (params) {
    const d = await API.get(`/platform/madaris/${params.id}`);
    const m = d.madrasa;
    render(`
      <h1>${esc(m.name_en)}</h1>
      <div class="muted">${esc(m.name_ar)}</div>
      <div class="grid cols-2">
        <div class="stat"><div class="num">${m.student_count || 0}</div><div class="lbl">${esc(t("nav.students"))}</div></div>
        <div class="stat"><div class="num">${m.teacher_count || 0}</div><div class="lbl">${esc(t("nav.teachers"))}</div></div>
      </div>
      <div class="card">
        <div class="card-title">🏫 ${esc(t("nav.madaris"))} <span class="pill ${m.status === "active" ? "ok" : "bad"}">${esc(m.status)}</span> <span class="pill gold">${esc((d.plan && d.plan.code) || "")}</span></div>
        <div class="muted small">${esc(m.address || "")} ${esc(m.city || "")}, ${esc(m.state_name || "")} • ${esc(m.email || "")} • ${esc(m.phone || "")}</div>
        <div class="form-actions">
          <button class="btn secondary" id="editBtn">${esc(t("common.edit"))}</button>
          <button class="btn ${m.status === "active" ? "danger" : ""}" id="toggleBtn">${esc(m.status === "active" ? t("platform.suspend") : t("platform.activate"))}</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">👤 ${esc(t("platform.adminAccount"))}</div>
        ${d.admin ? `<div class="small"><b>${esc(d.admin.username)}</b> — ${esc(d.admin.full_name)} <span class="muted">${esc(d.admin.email || "")}</span></div>` : `<div class="empty">${esc(t("common.noData"))}</div>`}
        <button class="btn small secondary" id="adminBtn" style="margin-top:10px">✏️ ${esc(t("common.edit"))}</button>
      </div>`);
    $("#editBtn").addEventListener("click", () => madrasaForm(m));
    $("#toggleBtn").addEventListener("click", async () => {
      const status = m.status === "active" ? "suspended" : "active";
      try { await API.patch(`/platform/madaris/${m.id}`, { status }); toast("✓", "ok"); routeTo("platform/madaris/" + params.id); }
      catch (e) { toast(errMsg(e), "err"); }
    });
    $("#adminBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("platform.adminAccount"))}</h2>
        <label data-i18n="teachers.username">${esc(t("teachers.username"))}</label>
        <input id="aUser" value="${esc(d.admin ? d.admin.username : "")}">
        <label data-i18n="auth.password">${esc(t("auth.password"))} <span class="muted small">(min 8)</span></label>
        <input id="aPass" type="password">
        <label data-i18n="common.name">${esc(t("common.name"))}</label>
        <input id="aName" value="${esc(d.admin ? d.admin.full_name : "")}">
        <div class="form-actions">
          <button class="btn" id="aSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#aSave", modal).addEventListener("click", async () => {
            try {
              await API.post(`/platform/madaris/${m.id}/admin`, {
                username: $("#aUser", modal).value.trim(),
                password: $("#aPass", modal).value,
                full_name: $("#aName", modal).value.trim(),
              });
              toast("✓", "ok"); closeAllModals(); routeTo("platform/madaris/" + params.id);
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
  }));

  route("platform/plans", SA(async function () {
    const d = await API.get("/platform/plans");
    window.__plans = d.plans;
    render(`
      <h1>${esc(t("platform.plans"))}</h1>
      <button class="btn" id="addBtn">+ ${esc(t("common.add"))}</button>
      ${d.plans.map((p) => `
        <div class="card">
          <div class="card-title"><b>${esc(p.name)}</b> <span class="pill gold">${esc(p.code)}</span> <span class="muted small">${p.madaris_count} ${esc(t("nav.madaris")).toLowerCase()}</span></div>
          <div class="small">${esc(t("platform.price"))}: <b>${Number(p.price_ngn).toLocaleString()} ₦</b> • ${esc(t("platform.studentLimit"))}: <b>${p.student_limit < 0 ? "∞" : p.student_limit}</b> • ${esc(t("platform.teacherLimit"))}: <b>${p.teacher_limit < 0 ? "∞" : p.teacher_limit}</b></div>
          <div class="form-actions"><button class="btn small secondary" data-plan="${p.id}">${esc(t("common.edit"))}</button></div>
        </div>`).join("")}`);
    const editPlan = (p) => {
      openModal(`
        <h2>${esc(t("common.edit"))} — ${esc(p.name)}</h2>
        <label data-i18n="common.name">${esc(t("common.name"))}</label><input id="pName" value="${esc(p.name)}">
        <div class="row">
          <div><label>${esc(t("platform.price"))}</label><input id="pPrice" type="number" value="${p.price_ngn}"></div>
          <div><label>${esc(t("platform.studentLimit"))}</label><input id="pSLimit" type="number" value="${p.student_limit}"></div>
          <div><label>${esc(t("platform.teacherLimit"))}</label><input id="pTLimit" type="number" value="${p.teacher_limit}"></div>
        </div>
        <label class="checkbox"><input id="pActive" type="checkbox" ${p.is_active ? "checked" : ""}> ${esc(t("common.active"))}</label>
        <div class="form-actions">
          <button class="btn" id="pSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#pSave", modal).addEventListener("click", async () => {
            try {
              await API.patch(`/platform/plans/${p.id}`, {
                name: $("#pName", modal).value.trim(),
                price_ngn: Number($("#pPrice", modal).value),
                student_limit: Number($("#pSLimit", modal).value),
                teacher_limit: Number($("#pTLimit", modal).value),
                is_active: $("#pActive", modal).checked,
              });
              toast(t("platform.planUpdated"), "ok"); closeAllModals(); routeTo("platform/plans");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    };
    $$("#view [data-plan]").forEach((b) => b.addEventListener("click", () => editPlan(d.plans.find((x) => x.id === Number(b.dataset.plan)))));
    $("#addBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("common.add"))}</h2>
        <label>Code</label><input id="nCode">
        <label>${esc(t("common.name"))}</label><input id="nName">
        <label>${esc(t("platform.price"))}</label><input id="nPrice" type="number" value="0">
        <div class="row">
          <div><label>${esc(t("platform.studentLimit"))}</label><input id="nS" type="number" value="100"></div>
          <div><label>${esc(t("platform.teacherLimit"))}</label><input id="nT" type="number" value="10"></div>
        </div>
        <div class="form-actions">
          <button class="btn" id="nSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#nSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/platform/plans", {
                code: $("#nCode", modal).value.trim(), name: $("#nName", modal).value.trim(),
                price_ngn: Number($("#nPrice", modal).value), student_limit: Number($("#nS", modal).value),
                teacher_limit: Number($("#nT", modal).value),
              });
              toast("✓", "ok"); closeAllModals(); routeTo("platform/plans");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
  }));

  route("platform/activity", SA(async function () {
    const d = await API.get("/platform/activity?limit=200");
    render(`
      <h1>${esc(t("platform.activity"))}</h1>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>Time</th><th>Madrasa</th><th>User</th><th>Action</th><th>Entity</th></tr>
        ${d.activity.map((a) => `<tr>
          <td class="muted">${esc(new Date(a.created_at).toLocaleString())}</td>
          <td>${esc(a.madrasa_id || "—")}</td>
          <td>${esc(a.user_id || "—")}</td>
          <td>${esc(a.action)}</td>
          <td>${esc(a.entity)} ${esc(a.entity_id)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">${esc(t("common.noData"))}</td></tr>`}
      </table></div></div>`);
  }));

  /* ====================================================================== */
  /*  MADRASA ADMIN — DASHBOARD                                              */
  /* ====================================================================== */
  route("home", async function () {
    if (!requireLogin()) return;
    if (me.role === "student") return studentHome();
    if (me.role === "parent") return parentHome();
    if (me.role === "teacher") return teacherHome();
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }

    const [an, sessions, ann] = await Promise.all([
      API.get("/madrasa/analytics?months=6&attendanceDays=30").catch(() => null),
      API.get("/sessions").catch(() => ({ sessions: [] })),
      API.get("/announcements?limit=5").catch(() => ({ announcements: [] })),
    ]);
    const c = C();
    const noData = t("an.noData");

    // Analytics is the centrepiece, but the dashboard must still render if the
    // aggregate query fails — fall back to the plain counters.
    if (!an || !an.analytics) {
      const [students, classes, subjects] = await Promise.all([
        API.get("/students?perPage=1"), API.get("/classes"), API.get("/subjects"),
      ]);
      const teachers = await API.get("/teachers").catch(() => ({ teachers: [] }));
      render(`
        <h1>${esc(t("dash.overview"))}</h1>
        <div class="kpis">
          ${kpi(students.total, t("an.students"))}
          ${kpi(teachers.teachers.length, t("an.teachers"), "", "accent")}
          ${kpi(classes.classes.length, t("an.classes"))}
          ${kpi(subjects.subjects.length, t("an.subjects"))}
        </div>`);
      return;
    }

    const a = an.analytics;
    const termName = a.term ? nm({ label: a.term.nameEn, labelAr: a.term.nameAr }) : "";
    render(`
      <h1>${esc(t("dash.overview"))}</h1>
      ${kpiRow(a)}
      <div class="card">
        <div class="card-title">⚡ ${esc(t("dash.quickActions"))}</div>
        <div class="form-actions">
          <a class="btn" href="#/students">🎓 ${esc(t("students.add"))}</a>
          <a class="btn secondary" href="#/results">📝 ${esc(t("nav.results"))}</a>
          <a class="btn secondary" href="#/attendance">✅ ${esc(t("nav.attendance"))}</a>
          <a class="btn secondary" href="#/analytics">📈 ${esc(t("nav.analytics"))}</a>
        </div>
      </div>
      <div class="grid cols-2">
        ${chartCard(t("an.enrolmentTrend"), monthsLabel(6), c.bar(a.enrolment.trend, { format: c.int, emptyText: noData }))}
        ${chartCard(t("an.attendanceTrend"), daysLabel(30), c.line(a.attendance.daily, { max: 100, nice: false, format: (v) => v + "%", axisFormat: (v) => v + "%", emptyText: noData }))}
      </div>
      <div class="grid cols-2">
        ${chartCard(t("an.collectionTrend"), `${t("an.outstanding")} ${esc(c.money(a.fees.outstanding))}`, c.bar(a.fees.trend, { format: c.money, emptyText: noData }))}
        ${chartCard(t("an.gradeDist"), termName, c.bar(a.results.gradeDistribution.map((g) => ({ label: g.grade, value: g.value })), { nice: false, format: c.int, emptyText: noData }))}
      </div>
      ${watchPanel(a)}
      <div class="grid cols-2">
        <div class="card">
          <div class="card-title">🗓️ ${esc(t("sessions.title"))}</div>
          ${sessions.sessions.slice(0, 3).map((s) => `
            <div class="reportlink"><div><b>${esc(s.label)}</b> ${s.is_current ? `<span class="pill ok">${esc(t("sessions.current"))}</span>` : ""}<div class="muted small">${(s.terms || []).map((x) => esc(x.name_en)).join(" • ")}</div></div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
        </div>
        <div class="card">
          <div class="card-title">📢 ${esc(t("dash.announcements"))}</div>
          ${ann.announcements.slice(0, 3).map((x) => `<div class="reportlink"><div><b>${esc(x.title)}</b><div class="muted small">${esc(new Date(x.created_at).toLocaleDateString())}</div></div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
        </div>
      </div>`);
  });

  /* ====================================================================== */
  /*  ANALYTICS (full dashboard, madrasa admin)                              */
  /* ====================================================================== */
  route("analytics", async function () {
    if (!requireLogin()) return;
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }

    const state = { months: 12, days: 30 };

    async function draw() {
      const d = await API.get(`/madrasa/analytics?months=${state.months}&attendanceDays=${state.days}`);
      const a = d.analytics;
      render(`
        <h1>${esc(t("an.title"))}</h1>
        <p class="muted" style="margin-top:-6px">${esc(t("an.subtitle"))}</p>
        ${rangeBar(state)}
        ${kpiRow(a)}
        <h2>${esc(t("an.enrolment"))}</h2>
        ${enrolmentPanels(a)}
        <h2>${esc(t("an.attendance"))}</h2>
        ${attendancePanels(a)}
        <h2>${esc(t("an.fees"))}</h2>
        ${feePanels(a)}
        <h2>${esc(t("an.performance"))}</h2>
        ${performancePanels(a)}
        ${watchPanel(a)}`);
      $$(".segs button").forEach((b) => b.addEventListener("click", () => {
        const group = b.parentElement.getAttribute("data-group");
        const v = Number(b.getAttribute("data-v"));
        if (group === "months") state.months = v; else state.days = v;
        draw();
      }));
    }

    await draw();
  });

  /* ====================================================================== */
  /*  STUDENTS                                                               */
  /* ====================================================================== */
  route("students", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const classes = await API.get("/classes").catch(() => ({ classes: [] }));
    let search = "";
    let classFilter = "0";
    let rows = [];
    async function load() {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (classFilter !== "0") q.set("classId", classFilter);
      q.set("perPage", "200");
      const d = await API.get("/students?" + q.toString());
      rows = d.students;
      const tbody = $("#stuRows");
      if (tbody) {
        tbody.innerHTML = rows.map((s) => `
          <tr>
            <td><a href="#/students/${s.id}">${s.photo_path ? `<img class="avatar sm" src="${esc(s.photo_path)}">` : ""} <b>${esc(s.first_name)} ${esc(s.last_name)}</b></a></td>
            <td class="mono">${esc(s.admission_no)}</td>
            <td>${esc(s.class_en || t("common.none"))}</td>
            <td>${pill(s.status)}</td>
            <td class="muted small">${esc(s.parent_phone || "")}</td>
          </tr>`).join("") || `<tr><td colspan="5" class="empty">${esc(t("common.noData"))}</td></tr>`;
      }
    }
    render(`
      <h1>${esc(t("students.title"))}</h1>
      <div class="card">
        <div class="row">
          <div class="searchbar"><span class="ico">🔍</span><input id="stuSearch" data-i18n-ph="students.searchPlaceholder" placeholder="${esc(t("students.searchPlaceholder"))}"></div>
          <select id="stuClass" style="max-width:220px">
            <option value="0">${esc(t("common.all"))} — ${esc(t("students.class"))}</option>
            ${classes.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}
          </select>
        </div>
        <div class="form-actions">
          <button class="btn" id="addBtn">+ ${esc(t("students.add"))}</button>
          <button class="btn secondary" id="importBtn">📥 ${esc(t("students.import"))}</button>
        </div>
      </div>
      <div class="card">
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("students.admissionNo"))}</th><th>${esc(t("students.class"))}</th><th>${esc(t("students.status"))}</th><th>${esc(t("students.parentPhone"))}</th></tr>
          <tbody id="stuRows"></tbody>
        </table></div>
      </div>`);
    let deb;
    $("#stuSearch").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => { search = e.target.value.trim(); load(); }, 350); });
    $("#stuClass").addEventListener("change", (e) => { classFilter = e.target.value; load(); });
    $("#addBtn").addEventListener("click", () => studentForm(classes.classes));
    $("#importBtn").addEventListener("click", () => importModal(classes.classes));
    load();
  });

  function studentForm(classes, existing) {
    const s = existing || {};
    openModal(`
      <h2>${esc(existing ? t("common.edit") : t("students.add"))}</h2>
      <div class="row">
        <div><label>First name *</label><input id="sFirst" value="${esc(s.first_name || "")}"></div>
        <div><label>Last name</label><input id="sLast" value="${esc(s.last_name || "")}"></div>
      </div>
      <label data-i18n="students.nameArFull">${esc(t("common.nameAr"))}</label>
      <input id="sNameAr" dir="rtl" value="${esc(s.name_ar || "")}">
      <div class="row">
        <div><label data-i18n="students.gender">${esc(t("students.gender"))}</label>
          <select id="sGender"><option value="M">${esc(t("students.male"))}</option><option value="F">${esc(t("students.female"))}</option></select></div>
        <div><label data-i18n="students.dob">${esc(t("students.dob"))}</label><input id="sDob" type="date" value="${esc(s.date_of_birth || "")}"></div>
      </div>
      <label data-i18n="students.class">${esc(t("students.class"))}</label>
      <select id="sClass">
        <option value="">—</option>
        ${classes.map((c) => `<option value="${c.id}" ${Number(s.class_id) === c.id ? "selected" : ""}>${esc(c.name_en)}</option>`).join("")}
      </select>
      <div class="row">
        <div><label data-i18n="students.parentName">${esc(t("students.parentName"))}</label><input id="sParent" value="${esc(s.parent_name || "")}"></div>
        <div><label data-i18n="students.parentPhone">${esc(t("students.parentPhone"))}</label><input id="sPhone" value="${esc(s.parent_phone || "")}"></div>
      </div>
      <label data-i18n="common.address">${esc(t("common.address"))}</label>
      <input id="sAddr" value="${esc(s.address || "")}">
      <div class="form-actions">
        <button class="btn" id="sSave">${esc(t("common.save"))}</button>
        <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
      </div>`,
      async (modal) => {
        $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
        $("#sSave", modal).addEventListener("click", async () => {
          const body = {
            first_name: $("#sFirst", modal).value.trim(),
            last_name: $("#sLast", modal).value.trim(),
            name_ar: $("#sNameAr", modal).value.trim(),
            gender: $("#sGender", modal).value,
            date_of_birth: $("#sDob", modal).value || null,
            class_id: $("#sClass", modal).value ? Number($("#sClass", modal).value) : null,
            parent_name: $("#sParent", modal).value.trim(),
            parent_phone: $("#sPhone", modal).value.trim(),
            address: $("#sAddr", modal).value.trim(),
          };
          try {
            if (existing) {
              await API.patch(`/students/${existing.id}`, body);
              toast("✓", "ok"); closeAllModals(); routeTo("students/" + existing.id);
            } else {
              const d = await API.post("/students", body);
              toast(`${t("students.created")}: ${d.admissionNo}`, "ok");
              closeAllModals();
              if (d.id) location.hash = "#/students/" + d.id;
            }
          } catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  function importModal(classes) {
    openModal(`
      <h2>${esc(t("students.import"))}</h2>
      <p class="small muted">CSV: first_name,last_name,name_ar,gender,date_of_birth,class,parent_name,parent_phone,address</p>
      <textarea id="csvText" style="min-height:180px; font-family:monospace; font-size:.8rem"></textarea>
      <div class="form-actions">
        <button class="btn" id="csvGo">${esc(t("common.save"))}</button>
        <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
      </div>`,
      async (modal) => {
        $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
        $("#csvGo", modal).addEventListener("click", async () => {
          try {
            const d = await API.post("/students/import", { csv: $("#csvText", modal).value });
            toast(`${d.inserted} imported, ${d.errors.length} errors`, d.errors.length ? "err" : "ok");
            if (d.errors.length) console.warn(d.errors);
            closeAllModals(); routeTo("students");
          } catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  route("students/:id", async function (params) {
    if (me.role !== "madrasa_admin" && me.role !== "teacher") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get(`/students/${params.id}`);
    const s = d.student;
    const classes = me.role === "madrasa_admin" ? (await API.get("/classes").catch(() => ({ classes: [] }))).classes : [];
    const isAr = window.I18N.lang === "ar";
    render(`
      <div class="card">
        <div class="row" style="align-items:center">
          ${s.photo_path ? `<img class="avatar" style="width:84px;height:84px;border-radius:14px" src="${esc(s.photo_path)}" id="stuPhoto">` : `<div class="avatar" style="width:84px;height:84px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem">👤</div>`}
          <div style="flex:1">
            <h1 style="margin:0">${esc(isAr && s.name_ar ? s.name_ar : `${s.first_name} ${s.last_name}`)}</h1>
            <div class="muted mono">${esc(s.admission_no)}</div>
            <div style="margin-top:6px">${pill(s.status)}</div>
          </div>
        </div>
        <hr class="divider">
        <div class="grid cols-2">
          <div><b>${esc(t("students.class"))}:</b> ${esc(s.class_en || t("common.none"))}</div>
          <div><b>${esc(t("students.gender"))}:</b> ${esc(s.gender || "—")}</div>
          <div><b>${esc(t("students.dob"))}:</b> ${esc(s.date_of_birth || "—")}</div>
          <div><b>${esc(t("students.parentName"))}:</b> ${esc(s.parent_name || "—")}</div>
          <div><b>${esc(t("students.parentPhone"))}:</b> ${esc(s.parent_phone || "—")}</div>
          <div><b>${esc(t("common.address"))}:</b> ${esc(s.address || "—")}</div>
        </div>
        ${me.role === "madrasa_admin" ? `
        <div class="form-actions">
          <button class="btn" id="editBtn">${esc(t("common.edit"))}</button>
          <button class="btn secondary" id="photoBtn">📷 ${esc(t("students.changePhoto"))}</button>
          <button class="btn secondary" id="portalBtn">🔑 ${esc(t("students.portalAccount"))}</button>
          <button class="btn secondary" id="parentBtn">👪 ${esc(t("students.parentAccount"))}</button>
          <button class="btn ${s.status === "active" || s.status === "promoted" ? "danger" : ""}" id="statusBtn">${esc(s.status === "withdrawn" || s.status === "suspended" ? t("students.activate") : t("students.deactivate"))}</button>
        </div>` : ""}
      </div>
      <div class="card">
        <div class="card-title">📝 ${esc(t("students.results"))}</div>
        ${d.terms.length ? d.terms.map((x) => `
          <div class="reportlink">
            <div style="flex:1">
              <b>${esc(isAr && x.term_name_ar ? x.term_name_ar : x.term_name)}</b> <span class="muted small">${esc(x.term_name || "")}</span>
              <div class="small muted">${esc(t("results.average"))}: <b>${x.average}%</b> • ${esc(t("results.grade"))}: <b>${esc(x.overall_grade)}</b> • ${esc(t("results.position"))}: ${x.position || "—"} • ${pill(x.promotion_status)}</div>
            </div>
            <a class="btn small" target="_blank" href="${API.reportCardUrl(s.id, x.term_id)}">🖨 ${esc(t("results.reportCard"))}</a>
          </div>`).join("") : `<div class="empty">${esc(t("common.noData"))}</div>`}
      </div>`);

    if (me.role === "madrasa_admin") {
      $("#editBtn").addEventListener("click", () => studentForm(classes, s));
      $("#photoBtn").addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/jpeg,image/png,image/webp";
        input.addEventListener("change", async () => {
          if (!input.files[0]) return;
          const fd = new FormData(); fd.append("photo", input.files[0]);
          try {
            const r = await fetch(`/api/students/${s.id}/photo`, { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRF-Token": await (await (async () => { if (window.__csrf) return window.__csrf; const r2 = await API.get("/csrf-token"); window.__csrf = r2.csrfToken; return r2.csrfToken; })()) } });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Upload failed"); }
            toast("✓", "ok"); routeTo("students/" + s.id);
          } catch (e) { toast(errMsg(e), "err"); }
        });
        input.click();
      });
      $("#portalBtn").addEventListener("click", () => accountModal(`/students/${s.id}/portal-account`, t("students.portalAccount")));
      $("#parentBtn").addEventListener("click", () => accountModal(`/students/${s.id}/parent-account`, t("students.parentAccount")));
      $("#statusBtn").addEventListener("click", async () => {
        const next = s.status === "withdrawn" || s.status === "suspended" ? "active" : "suspended";
        try { await API.patch(`/students/${s.id}/status`, { status: next }); toast("✓", "ok"); routeTo("students/" + s.id); }
        catch (e) { toast(errMsg(e), "err"); }
      });
    }
  });

  function accountModal(endpoint, title) {
    openModal(`
      <h2>${esc(title)}</h2>
      <label data-i18n="teachers.username">${esc(t("teachers.username"))}</label><input id="accUser">
      <label data-i18n="auth.password">${esc(t("auth.password"))}</label><input id="accPass" type="password">
      <div class="form-actions">
        <button class="btn" id="accSave">${esc(t("common.create"))}</button>
        <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
      </div>`,
      async (modal) => {
        $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
        $("#accSave", modal).addEventListener("click", async () => {
          try {
            await API.post(endpoint, { username: $("#accUser", modal).value.trim(), password: $("#accPass", modal).value });
            toast("✓", "ok"); closeAllModals();
          } catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  /* ====================================================================== */
  /*  TEACHERS                                                               */
  /* ====================================================================== */
  route("teachers", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/teachers");
    render(`
      <h1>${esc(t("teachers.title"))}</h1>
      <button class="btn" id="addBtn">+ ${esc(t("teachers.add"))}</button>
      <div class="card">
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("teachers.username"))}</th><th>${esc(t("common.phone"))}</th><th>${esc(t("common.status"))}</th><th>${esc(t("teachers.assignments"))}</th><th></th></tr>
          ${d.teachers.map((tc) => `<tr>
            <td><b>${esc(tc.full_name)}</b></td>
            <td class="mono">${esc(tc.username)}</td>
            <td class="muted">${esc(tc.phone || "")}</td>
            <td>${tc.is_active ? pill("active") : pill("suspended")}</td>
            <td class="small">${tc.assignments.map((a) => `${a.class ? esc(a.class.name_en) : ""}${a.subject ? " • " + esc(a.subject.name_en) : ""}`).join("; ") || "—"}</td>
            <td><button class="btn small secondary" data-id="${tc.id}">${tc.is_active ? esc(t("teachers.deactivate")) : esc(t("teachers.activate"))}</button></td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
      </div>`);
    $("#addBtn").addEventListener("click", () => teacherForm(d.classes, d.subjects));
    $$("#view [data-id]").forEach((b) => b.addEventListener("click", async () => {
      const tc = d.teachers.find((x) => x.id === Number(b.dataset.id));
      try { await API.patch(`/teachers/${tc.id}`, { is_active: !tc.is_active }); toast("✓", "ok"); routeTo("teachers"); }
      catch (e) { toast(errMsg(e), "err"); }
    }));
  });

  function teacherForm(classes, subjects) {
    openModal(`
      <h2>${esc(t("teachers.add"))}</h2>
      <label data-i18n="common.name">${esc(t("common.name"))} *</label><input id="tName">
      <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="tNameAr" dir="rtl">
      <div class="row">
        <div><label data-i18n="teachers.username">${esc(t("teachers.username"))} *</label><input id="tUser"></div>
        <div><label data-i18n="auth.password">${esc(t("auth.password"))} *</label><input id="tPass" type="password"></div>
      </div>
      <label data-i18n="common.phone">${esc(t("common.phone"))}</label><input id="tPhone">
      <label>${esc(t("teachers.assignments"))} <span class="muted small">(class + optional subject)</span></label>
      <div id="assignList"></div>
      <button class="btn small secondary" id="addAssign" style="margin-top:8px">+ ${esc(t("common.add"))}</button>
      <div class="form-actions">
        <button class="btn" id="tSave">${esc(t("common.create"))}</button>
        <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
      </div>`,
      async (modal) => {
        $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
        const list = $("#assignList", modal);
        function addAssignRow(classId, subjectId) {
          const row = document.createElement("div");
          row.className = "row"; row.style.marginBottom = "8px";
          row.innerHTML = `
            <select class="aClass"><option value="">— ${esc(t("students.class"))} —</option>${classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(classId) ? "selected" : ""}>${esc(c.name_en)}</option>`).join("")}</select>
            <select class="aSubj"><option value="">— ${esc(t("results.subject"))} / ${esc(t("teachers.wholeClass"))} —</option>${subjects.map((s) => `<option value="${s.id}" ${String(s.id) === String(subjectId) ? "selected" : ""}>${esc(s.name_en)}</option>`).join("")}</select>
            <button class="btn small danger aRm" style="flex:0 0 auto">✕</button>`;
          row.querySelector(".aRm").addEventListener("click", () => row.remove());
          list.appendChild(row);
        }
        $("#addAssign", modal).addEventListener("click", () => addAssignRow());
        $("#tSave", modal).addEventListener("click", async () => {
          const assignments = $$(".aClass", modal).map((sel) => {
            const cid = Number(sel.value) || null;
            const sid = Number(sel.parentElement.querySelector(".aSubj").value) || null;
            return cid ? { class_id: cid, subject_id: sid } : null;
          }).filter(Boolean);
          try {
            await API.post("/teachers", {
              full_name: $("#tName", modal).value.trim(),
              full_name_ar: $("#tNameAr", modal).value.trim(),
              username: $("#tUser", modal).value.trim(),
              password: $("#tPass", modal).value,
              phone: $("#tPhone", modal).value.trim(),
              assignments,
            });
            toast("✓", "ok"); closeAllModals(); routeTo("teachers");
          } catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  /* ====================================================================== */
  /*  CLASSES / SUBJECTS / SESSIONS                                          */
  /* ====================================================================== */
  route("classes", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/classes");
    render(`
      <h1>${esc(t("classes.title"))}</h1>
      <button class="btn" id="addBtn">+ ${esc(t("classes.add"))}</button>
      ${d.classes.map((c) => `
        <div class="card">
          <div class="card-title">📚 <b>${esc(c.name_en)}</b> <span class="muted">${esc(c.name_ar)}</span> <span class="pill info">${c.student_count} ${esc(t("classes.students")).toLowerCase()}</span></div>
          <div class="small"><b>${esc(t("classes.subjectsOf"))}:</b> ${(c.subjects || []).map((s) => `<span class="pill muted" style="margin-inline-end:4px">${esc(window.I18N.lang === "ar" && s.name_ar ? s.name_ar : s.name_en)}</span>`).join("") || "—"}</div>
          <div class="form-actions">
            <button class="btn small secondary" data-subj="${c.id}">${esc(t("classes.addSubjects"))}</button>
          </div>
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
    $("#addBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("classes.add"))}</h2>
        <label data-i18n="common.nameEn">${esc(t("common.nameEn"))}</label><input id="cEn">
        <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="cAr" dir="rtl">
        <div class="form-actions">
          <button class="btn" id="cSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#cSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/classes", { name_en: $("#cEn", modal).value.trim(), name_ar: $("#cAr", modal).value.trim() });
              toast("✓", "ok"); closeAllModals(); routeTo("classes");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
    $$("#view [data-subj]").forEach((b) => b.addEventListener("click", async () => {
      const cls = d.classes.find((x) => x.id === Number(b.dataset.subj));
      const subjects = await API.get("/subjects");
      const currentIds = (cls.subjects || []).map((s) => s.id);
      openModal(`
        <h2>${esc(t("classes.addSubjects"))} — ${esc(cls.name_en)}</h2>
        ${subjects.subjects.map((s) => `
          <label class="checkbox"><input type="checkbox" class="subChk" value="${s.id}" ${currentIds.includes(s.id) ? "checked" : ""}> ${esc(s.name_en)} ${esc(s.name_ar)}</label>`).join("")}
        <div class="form-actions">
          <button class="btn" id="subSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((x) => x.addEventListener("click", closeAllModals));
          $("#subSave", modal).addEventListener("click", async () => {
            try {
              await API.put(`/classes/${cls.id}/subjects`, { subject_ids: $$(".subChk", modal).filter((c) => c.checked).map((c) => Number(c.value)) });
              toast("✓", "ok"); closeAllModals(); routeTo("classes");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    }));
  });

  route("subjects", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/subjects");
    render(`
      <h1>${esc(t("subjects.title"))}</h1>
      <p class="muted small">${esc(t("subjects.custom"))}</p>
      <button class="btn" id="addBtn">+ ${esc(t("subjects.add"))}</button>
      <div class="card">
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.nameEn"))}</th><th>${esc(t("common.nameAr"))}</th><th>${esc(t("common.status"))}</th></tr>
          ${d.subjects.map((s) => `<tr>
            <td><b>${esc(s.name_en)}</b></td>
            <td dir="rtl">${esc(s.name_ar || "—")}</td>
            <td>${s.is_active ? pill("active") : pill("suspended")}</td>
          </tr>`).join("") || `<tr><td colspan="3" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
      </div>`);
    $("#addBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("subjects.add"))}</h2>
        <label data-i18n="common.nameEn">${esc(t("common.nameEn"))}</label><input id="sEn">
        <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="sAr" dir="rtl">
        <div class="form-actions">
          <button class="btn" id="sSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#sSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/subjects", { name_en: $("#sEn", modal).value.trim(), name_ar: $("#sAr", modal).value.trim() });
              toast("✓", "ok"); closeAllModals(); routeTo("subjects");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
  });

  route("sessions", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/sessions");
    render(`
      <h1>${esc(t("sessions.title"))}</h1>
      <button class="btn" id="addBtn">+ ${esc(t("sessions.add"))}</button>
      ${d.sessions.map((s) => `
        <div class="card">
          <div class="card-title">🗓️ <b>${esc(s.label)}</b> ${s.is_current ? `<span class="pill ok">${esc(t("sessions.current"))}</span>` : `<button class="btn small secondary" data-cur="${s.id}">★ ${esc(t("sessions.current"))}</button>`}</div>
          <div class="small muted">${esc(s.start_date || "—")} → ${esc(s.end_date || "—")}</div>
          <h3>${esc(t("sessions.terms"))}</h3>
          ${s.terms.map((x) => `<div class="reportlink"><b>${esc(x.position)}. ${esc(window.I18N.lang === "ar" && x.name_ar ? x.name_ar : x.name_en)}</b> <span class="muted small">${esc(x.start_date || "")} → ${esc(x.end_date || "")}</span></div>`).join("")}
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
    $("#addBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("sessions.add"))}</h2>
        <label data-i18n="sessions.label">${esc(t("sessions.label"))}</label><input id="sessLabel" placeholder="2026/2027">
        <div class="row">
          <div><label>Start</label><input id="sessStart" type="date"></div>
          <div><label>End</label><input id="sessEnd" type="date"></div>
        </div>
        <div class="form-actions">
          <button class="btn" id="sessSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#sessSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/sessions", {
                label: $("#sessLabel", modal).value.trim(),
                start_date: $("#sessStart", modal).value || null,
                end_date: $("#sessEnd", modal).value || null,
              });
              toast("✓", "ok"); closeAllModals(); routeTo("sessions");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
    $$("#view [data-cur]").forEach((b) => b.addEventListener("click", async () => {
      try { await API.patch(`/sessions/${b.dataset.cur}`, { is_current: true }); toast("✓", "ok"); routeTo("sessions"); }
      catch (e) { toast(errMsg(e), "err"); }
    }));
  });

  /* ====================================================================== */
  /*  RESULTS                                                                */
  /* ====================================================================== */
  async function loadResultsContext() {
    const [classes, sessions] = await Promise.all([API.get("/classes"), API.get("/sessions")]);
    const current = sessions.sessions.find((s) => s.is_current) || sessions.sessions[0];
    return { classes: classes.classes, current };
  }

  async function adminResultsUI() {
    if (me.role !== "madrasa_admin" && me.role !== "teacher") { render(`<div class="empty">403</div>`); return; }
    const ctx = await loadResultsContext();
    if (me.role === "teacher") {
      const mine = await API.get("/teachers/me/assignments");
      ctx.classes = mine.classes;
      window.__teacherSubjects = mine.subjects;
    }
    if (!ctx.classes.length) { render(`<h1>${esc(t("results.title"))}</h1><div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`); return; }
    if (!ctx.current) { render(`<h1>${esc(t("results.title"))}</h1><div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`); return; }
    const terms = ctx.current.terms || [];
    const state = { classId: ctx.classes[0].id, termId: terms[0] ? terms[0].id : 0, subjectId: 0, mode: "entry" };

    async function subjectsForClass(classId) {
      const cd = await API.get("/classes");
      const c = cd.classes.find((x) => x.id === classId);
      return c ? c.subjects : [];
    }

    function shell() {
      render(`
        <h1>${esc(t("results.title"))}</h1>
        <div class="card">
          <div class="row">
            <div><label data-i18n="results.class">${esc(t("results.class"))}</label>
              <select id="rClass">${ctx.classes.map((c) => `<option value="${c.id}" ${c.id === state.classId ? "selected" : ""}>${esc(c.name_en)}</option>`).join("")}</select></div>
            <div><label data-i18n="results.term">${esc(t("results.term"))}</label>
              <select id="rTerm">${terms.map((x) => `<option value="${x.id}" ${x.id === state.termId ? "selected" : ""}>${esc(x.name_en)}</option>`).join("")}</select></div>
          </div>
          <div class="row" id="subjRow" style="margin-top:4px">
            <div><label data-i18n="results.subject">${esc(t("results.subject"))}</label>
              <select id="rSubject"><option value="0">—</option></select></div>
          </div>
          <div class="form-actions">
            <button class="btn" id="modeEntry">✏️ ${esc(t("results.save"))}</button>
            <button class="btn secondary" id="modeSummary">📊 ${esc(t("nav.dashboard"))}</button>
            <button class="btn gold" id="computeBtn">⚖️ ${esc(t("results.compute"))}</button>
          </div>
        </div>
        <div id="resultsArea"><div class="empty">${esc(t("common.loading"))}</div></div>`);
      $("#rClass").addEventListener("change", async (e) => {
        state.classId = Number(e.target.value); state.subjectId = 0;
        const subs = await subjectsForClass(state.classId);
        if (me.role === "teacher") {
          const allowed = new Set(window.__teacherSubjects.filter((x) => x.classId === state.classId).map((x) => x.subject.id));
          state._subs = subs.filter((s) => allowed.has(s.id));
        } else state._subs = subs;
        fillSubjects();
        loadArea();
      });
      $("#rTerm").addEventListener("change", (e) => { state.termId = Number(e.target.value); loadArea(); });
      $("#rSubject").addEventListener("change", (e) => { state.subjectId = Number(e.target.value); loadArea(); });
      $("#modeEntry").addEventListener("click", () => { state.mode = "entry"; loadArea(); });
      $("#modeSummary").addEventListener("click", () => { state.mode = "summary"; loadArea(); });
      $("#computeBtn").addEventListener("click", async () => {
        try {
          await API.post("/results/compute", { classId: state.classId, termId: state.termId });
          toast(t("results.computed"), "ok");
          state.mode = "summary"; loadArea();
        } catch (e) { toast(errMsg(e), "err"); }
      });
    }
    function fillSubjects() {
      const sel = $("#rSubject");
      const subs = state._subs || [];
      sel.innerHTML = `<option value="0">—</option>` + subs.map((s) => `<option value="${s.id}">${esc(window.I18N.lang === "ar" && s.name_ar ? s.name_ar : s.name_en)}</option>`).join("");
    }

    async function loadArea() {
      const area = $("#resultsArea");
      if (state.mode === "entry") {
        if (!state.subjectId) { area.innerHTML = `<div class="empty">${esc(t("results.subject"))}</div>`; return; }
        const [students, results] = await Promise.all([
          API.get("/students?classId=" + state.classId + "&perPage=200"),
          API.get(`/results/class?classId=${state.classId}&termId=${state.termId}&subjectId=${state.subjectId}`),
        ]);
        const scoreMap = new Map(results.students.map((r) => [r.student_id, r]));
        const cfg = results.config;
        area.innerHTML = `
          <div class="card">
            <div class="card-title">✏️ ${esc(t("results.title"))} — ${esc(t("results.ca"))} (max ${cfg.caMax}) + ${esc(t("results.exam"))} (max ${cfg.examMax})</div>
            <div class="score-grid">
              ${students.students.map((s) => {
                const sc = scoreMap.get(s.id);
                return `<div class="score-row" data-sid="${s.id}">
                  <div class="who" title="${esc(s.admission_no)}">${esc(s.first_name)} ${esc(s.last_name)}</div>
                  <input type="number" min="0" max="${cfg.caMax}" step="0.5" class="caIn" value="${sc ? esc(sc.ca) : ""}">
                  <input type="number" min="0" max="${cfg.examMax}" step="0.5" class="exIn" value="${sc ? esc(sc.exam) : ""}">
                  <div class="muted small" style="text-align:center">${sc ? esc(sc.grade) : ""}</div>
                </div>`;
              }).join("")}
            </div>
            <div class="form-actions"><button class="btn" id="saveScores">${esc(t("results.save"))}</button></div>
          </div>`;
        $("#saveScores").addEventListener("click", async () => {
          const entries = $$(".score-row").map((row) => ({
            studentId: Number(row.dataset.sid),
            ca: Number(row.querySelector(".caIn").value || 0),
            exam: Number(row.querySelector(".exIn").value || 0),
          })).filter((e) => e.ca > 0 || e.exam > 0);
          try {
            const d = await API.put("/results", { classId: state.classId, termId: state.termId, subjectId: state.subjectId, entries });
            toast(`${d.updated} saved`, "ok"); loadArea();
          } catch (e) { toast(errMsg(e), "err"); }
        });
      } else {
        const d = await API.get(`/results/summary?classId=${state.classId}&termId=${state.termId}`);
        const isAr = window.I18N.lang === "ar";
        area.innerHTML = `
          <div class="card">
            <div class="tablewrap"><table>
              <tr><th>#</th><th>${esc(t("students.admissionNo"))}</th><th>${esc(t("common.name"))}</th><th>${esc(t("results.average"))}</th><th>${esc(t("results.grade"))}</th><th>${esc(t("results.position"))}</th><th>${esc(t("results.promotion"))}</th><th></th></tr>
              ${d.students.map((s) => `<tr>
                <td>${s.position || "—"}</td>
                <td class="mono">${esc(s.admission_no)}</td>
                <td><b>${esc(isAr && s.name_ar ? s.name_ar : s.first_name + " " + s.last_name)}</b></td>
                <td>${s.average}%</td>
                <td><b>${esc(s.overall_grade)}</b></td>
                <td>${s.position || "—"}</td>
                <td>${pill(s.promotion_status)}</td>
                <td><a class="btn small" target="_blank" href="${API.reportCardUrl(s.student_id, state.termId)}">🖨</a></td>
              </tr>`).join("") || `<tr><td colspan="8" class="empty">${esc(t("results.noResults"))}</td></tr>`}
            </table></div>
          </div>`;
      }
    }
    shell();
    await subjectsForClass(state.classId).then((subs) => {
      if (me.role === "teacher") {
        const allowed = new Set(window.__teacherSubjects.filter((x) => x.classId === state.classId).map((x) => x.subject.id));
        state._subs = subs.filter((s) => allowed.has(s.id));
      } else state._subs = subs;
    });
    fillSubjects();
    loadArea();
  }

  /* ====================================================================== */
  /*  ATTENDANCE                                                             */
  /* ====================================================================== */
  route("attendance", async function () {
    if (me.role !== "madrasa_admin" && me.role !== "teacher") { render(`<div class="empty">403</div>`); return; }
    const ctx = await loadResultsContext();
    if (me.role === "teacher") {
      const mine = await API.get("/teachers/me/assignments");
      ctx.classes = mine.classes;
    }
    if (!ctx.classes.length || !ctx.current) { render(`<h1>${esc(t("attendance.title"))}</h1><div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`); return; }
    const terms = ctx.current.terms || [];
    const state = { classId: ctx.classes[0].id, date: today(), termId: terms[0] ? terms[0].id : null };
    render(`
      <h1>${esc(t("attendance.title"))}</h1>
      <div class="card">
        <div class="row">
          <div><label data-i18n="results.class">${esc(t("results.class"))}</label>
            <select id="aClass">${ctx.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}</select></div>
          <div><label data-i18n="attendance.date">${esc(t("attendance.date"))}</label>
            <input id="aDate" type="date" value="${state.date}"></div>
        </div>
        <div class="form-actions"><button class="btn secondary" id="allPresent">${esc(t("attendance.markAll"))}</button></div>
      </div>
      <div class="card" id="attArea"><div class="empty">${esc(t("common.loading"))}</div></div>`);
    async function loadAtt() {
      state.classId = Number($("#aClass").value);
      state.date = $("#aDate").value;
      const d = await API.get(`/attendance?classId=${state.classId}&date=${state.date}`);
      state.termId = d.termId;
      const area = $("#attArea");
      area.innerHTML = `
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("attendance.present"))}</th><th>${esc(t("attendance.absent"))}</th><th>${esc(t("attendance.excused"))}</th></tr>
          ${d.students.map((s) => `
            <tr data-sid="${s.id}">
              <td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td>
              <td><input type="radio" name="att${s.id}" value="present" ${s.status === "present" ? "checked" : ""}></td>
              <td><input type="radio" name="att${s.id}" value="absent" ${s.status === "absent" ? "checked" : ""}></td>
              <td><input type="radio" name="att${s.id}" value="excused" ${s.status === "excused" ? "checked" : ""}></td>
            </tr>`).join("")}
        </table></div>
        <div class="form-actions"><button class="btn" id="attSave">${esc(t("attendance.save"))}</button></div>`;
      $("#allPresent").onclick = () => { $$("#attArea input[value=present]").forEach((r) => (r.checked = true)); };
      $("#attSave").addEventListener("click", async () => {
        const statuses = {};
        $$("#attArea tr[data-sid]").forEach((tr) => {
          const sel = tr.querySelector("input:checked");
          if (sel) statuses[tr.dataset.sid] = sel.value;
        });
        try {
          await API.post("/attendance/mark", { classId: state.classId, date: state.date, termId: state.termId, statuses });
          toast(t("attendance.saved"), "ok");
        } catch (e) { toast(errMsg(e), "err"); }
      });
    }
    $("#aClass").addEventListener("change", loadAtt);
    $("#aDate").addEventListener("change", loadAtt);
    loadAtt();
  });

  /* ====================================================================== */
  /*  FEES                                                                   */
  /* ====================================================================== */
  route("fees", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const [items, payments, sessions] = await Promise.all([API.get("/fees/items"), API.get("/fees/payments"), API.get("/sessions")]);
    const current = sessions.sessions.find((s) => s.is_current) || sessions.sessions[0];
    const terms = current ? current.terms : [];
    const termId = terms[0] ? terms[0].id : 0;
    const [balances, students] = termId ? await Promise.all([API.get(`/fees/balance?termId=${termId}`).catch(() => ({ students: [] })), API.get("/students?perPage=200")]) : [{ students: [] }, { students: [] }];
    render(`
      <h1>${esc(t("fees.title"))}</h1>
      <div class="card">
        <div class="card-title">💰 ${esc(t("fees.items"))}</div>
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("fees.amount"))}</th><th>${esc(t("results.term"))}</th></tr>
          ${items.items.map((i) => `<tr><td><b>${esc(i.name_en)}</b> ${esc(i.name_ar)}</td><td>${Number(i.amount_ngn).toLocaleString()} ₦</td><td>${esc((terms.find((x) => x.id === i.term_id) || {}).name_en || "—")}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
        <button class="btn small secondary" id="addItem" style="margin-top:10px">+ ${esc(t("fees.add"))}</button>
      </div>
      <div class="card">
        <div class="card-title"> ${esc(t("fees.balance"))} — ${esc((terms.find((x) => x.id === termId) || {}).name_en || "")}</div>
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("fees.billed"))}</th><th>${esc(t("fees.paid"))}</th><th>${esc(t("fees.balanceDue"))}</th></tr>
          ${balances.students.map((s) => `<tr>
            <td><b>${esc(s.first_name)} ${esc(s.last_name)}</b> <span class="mono muted">${esc(s.admission_no)}</span></td>
            <td>${Number(s.billed).toLocaleString()}</td>
            <td>${Number(s.paid).toLocaleString()}</td>
            <td>${s.settled ? `<span class="pill ok">OK</span>` : `<b>${Number(s.balance).toLocaleString()}</b>`}</td>
          </tr>`).join("") || `<tr><td colspan="4" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">🧾 ${esc(t("fees.payments"))}</div>
        <button class="btn small secondary" id="payBtn">+ ${esc(t("fees.record"))}</button>
        <div class="tablewrap" style="margin-top:10px"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("fees.amount"))}</th><th>${esc("Date")}</th><th>${esc(t("fees.method"))}</th></tr>
          ${payments.payments.slice(0, 30).map((p) => `<tr>
            <td>${esc(p.first_name)} ${esc(p.last_name)}</td>
            <td>${Number(p.amount_ngn).toLocaleString()} ₦</td>
            <td>${esc(p.payment_date)}</td>
            <td>${esc(p.method)}</td>
          </tr>`).join("") || `<tr><td colspan="4" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
      </div>`);
    $("#addItem").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("fees.add"))}</h2>
        <label data-i18n="common.nameEn">${esc(t("common.nameEn"))}</label><input id="fiEn">
        <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="fiAr" dir="rtl">
        <label data-i18n="fees.amount">${esc(t("fees.amount"))}</label><input id="fiAmt" type="number">
        <div class="form-actions">
          <button class="btn" id="fiSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#fiSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/fees/items", {
                name_en: $("#fiEn", modal).value.trim(), name_ar: $("#fiAr", modal).value.trim(),
                amount_ngn: Number($("#fiAmt", modal).value || 0), term_id: termId || null,
              });
              toast("✓", "ok"); closeAllModals(); routeTo("fees");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
    $("#payBtn").addEventListener("click", () => {
      openModal(`
        <h2>${esc(t("fees.record"))}</h2>
        <label>${esc(t("nav.students"))}</label>
        <select id="fpStu">${students.students.map((s) => `<option value="${s.id}">${esc(s.first_name)} ${esc(s.last_name)} (${esc(s.admission_no)})</option>`).join("")}</select>
        <label data-i18n="fees.amount">${esc(t("fees.amount"))}</label><input id="fpAmt" type="number">
        <label>${esc("Date")}</label><input id="fpDate" type="date" value="${today()}">
        <label data-i18n="fees.method">${esc(t("fees.method"))}</label>
        <select id="fpMethod"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select>
        <div class="form-actions">
          <button class="btn" id="fpSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
        </div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#fpSave", modal).addEventListener("click", async () => {
            try {
              await API.post("/fees/payments", {
                student_id: Number($("#fpStu", modal).value),
                amount_ngn: Number($("#fpAmt", modal).value || 0),
                payment_date: $("#fpDate", modal).value,
                method: $("#fpMethod", modal).value,
              });
              toast("✓", "ok"); closeAllModals(); routeTo("fees");
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
  });

  /* ====================================================================== */
  /*  ANNOUNCEMENTS                                                          */
  /* ====================================================================== */
  route("announcements", async function () {
    const isAdmin = me.role === "madrasa_admin";
    const d = await API.get("/announcements?limit=100");
    render(`
      <h1>${esc(t("ann.title"))}</h1>
      ${isAdmin ? `<button class="btn" id="annAdd">+ ${esc(t("ann.add"))}</button>` : ""}
      ${d.announcements.map((a) => `
        <div class="card">
          <div class="card-title">📢 <b>${esc(a.title)}</b> <span class="pill ${a.audience === "all" ? "info" : a.audience === "students" ? "ok" : "gold"}">${esc({ all: t("ann.all"), students: t("ann.students"), parents: t("ann.parents") }[a.audience])}</span></div>
          <div class="wrap" style="white-space:pre-wrap">${esc(a.body)}</div>
          <div class="muted small" style="margin-top:8px">${esc(new Date(a.created_at).toLocaleString())}</div>
          ${isAdmin ? `<div class="form-actions"><button class="btn small secondary" data-del="${a.id}">${a.is_active ? esc(t("common.delete")) : "Hide"}</button></div>` : ""}
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
    if (isAdmin) {
      $("#annAdd").addEventListener("click", () => {
        openModal(`
          <h2>${esc(t("ann.add"))}</h2>
          <label data-i18n="ann.titlePh">${esc(t("ann.titlePh"))}</label><input id="anTitle">
          <label>${esc(t("ann.bodyPh"))}</label><textarea id="anBody"></textarea>
          <label data-i18n="ann.audience">${esc(t("ann.audience"))}</label>
          <select id="anAud"><option value="all">${esc(t("ann.all"))}</option><option value="students">${esc(t("ann.students"))}</option><option value="parents">${esc(t("ann.parents"))}</option></select>
          <div class="form-actions">
            <button class="btn" id="anSave">${esc(t("common.save"))}</button>
            <button class="btn secondary" data-close>${esc(t("common.cancel"))}</button>
          </div>`,
          async (modal) => {
            $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
            $("#anSave", modal).addEventListener("click", async () => {
              try {
                await API.post("/announcements", {
                  title: $("#anTitle", modal).value.trim(),
                  body: $("#anBody", modal).value.trim(),
                  audience: $("#anAud", modal).value,
                });
                toast("✓", "ok"); closeAllModals(); routeTo("announcements");
              } catch (e) { toast(errMsg(e), "err"); }
            });
          });
      });
      $$("#view [data-del]").forEach((b) => b.addEventListener("click", async () => {
        try { await API.del(`/announcements/${b.dataset.del}`); toast("✓", "ok"); routeTo("announcements"); }
        catch (e) { toast(errMsg(e), "err"); }
      }));
    }
  });

  /* ====================================================================== */
  /*  GRADING CONFIG                                                         */
  /* ====================================================================== */
  route("grading", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/grading");
    render(`
      <h1>${esc(t("grading.title"))}</h1>
      <div class="card">
        <div class="row">
          <div><label data-i18n="grading.caMax">${esc(t("grading.caMax"))}</label><input id="gCa" type="number" value="${d.caMax}"></div>
          <div><label data-i18n="grading.examMax">${esc(t("grading.examMax"))}</label><input id="gEx" type="number" value="${d.examMax}"></div>
          <div><label data-i18n="grading.passMark">${esc(t("grading.passMark"))}</label><input id="gPass" type="number" value="${d.passMark}"></div>
        </div>
        <label data-i18n="grading.promotionAvg">${esc(t("grading.promotionAvg"))}</label><input id="gProm" type="number" value="${d.promotionMinAverage == null ? "" : d.promotionMinAverage}">
        <label class="checkbox"><input id="gReq" type="checkbox" ${d.promotionRequirePass ? "checked" : ""}> ${esc(t("grading.requirePass"))}</label>
      </div>
      <div class="card">
        <div class="card-title">⚖️ ${esc(t("grading.bands"))}</div>
        <div class="tablewrap"><table>
          <tr><th>${esc(t("grading.min"))}</th><th>${esc(t("grading.grade"))}</th><th>${esc(t("grading.remark"))}</th><th>${esc(t("grading.remarkAr"))}</th></tr>
          ${d.bands.map((b, i) => `<tr>
            <td><input type="number" class="bMin" value="${b.min}" style="width:90px"></td>
            <td><input class="bGrade" value="${esc(b.grade)}" style="width:70px"></td>
            <td><input class="bRemark" value="${esc(b.remark)}"></td>
            <td><input class="bRemarkAr" dir="rtl" value="${esc(b.remark_ar)}"></td>
          </tr>`).join("")}
        </table></div>
      </div>
      <div class="form-actions"><button class="btn" id="gSave">${esc(t("common.save"))}</button></div>`);
    $("#gSave").addEventListener("click", async () => {
      const bands = $$("#view .bMin").map((el, i) => ({
        min: Number(el.value),
        grade: $$("#view .bGrade")[i].value,
        remark: $$("#view .bRemark")[i].value,
        remark_ar: $$("#view .bRemarkAr")[i].value,
      }));
      try {
        await API.put("/grading", {
          ca_max: Number($("#gCa").value),
          exam_max: Number($("#gEx").value),
          pass_mark: Number($("#gPass").value),
          promotion_min_average: $("#gProm").value === "" ? null : Number($("#gProm").value),
          promotion_require_pass: $("#gReq").checked,
          bands,
        });
        toast("✓", "ok");
      } catch (e) { toast(errMsg(e), "err"); }
    });
  });

  /* ====================================================================== */
  /*  SETTINGS (madrasa profile)                                             */
  /* ====================================================================== */
  route("settings", async function () {
    if (me.role !== "madrasa_admin") { render(`<div class="empty">403</div>`); return; }
    const d = await API.get("/madrasa/profile");
    const m = d.madrasa;
    render(`
      <h1>${esc(t("settings.title"))}</h1>
      <div class="card">
        <div class="card-title">🏫 ${esc(t("settings.profile"))}</div>
        <label data-i18n="common.nameEn">${esc(t("common.nameEn"))}</label><input id="mEn" value="${esc(m.name_en)}">
        <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="mAr" dir="rtl" value="${esc(m.name_ar)}">
        <div class="row">
          <div><label data-i18n="settings.mottoEn">${esc(t("settings.mottoEn"))}</label><input id="mMottoEn" value="${esc(m.motto_en)}"></div>
          <div><label data-i18n="settings.mottoAr">${esc(t("settings.mottoAr"))}</label><input id="mMottoAr" dir="rtl" value="${esc(m.motto_ar)}"></div>
        </div>
        <label data-i18n="common.address">${esc(t("common.address"))}</label><input id="mAddr" value="${esc(m.address)}">
        <div class="row">
          <div><label data-i18n="settings.city">${esc(t("settings.city"))}</label><input id="mCity" value="${esc(m.city)}"></div>
          <div><label data-i18n="settings.state">${esc(t("settings.state"))}</label><input id="mState" value="${esc(m.state_name)}"></div>
        </div>
        <div class="row">
          <div><label data-i18n="common.phone">${esc(t("common.phone"))}</label><input id="mPhone" value="${esc(m.phone)}"></div>
          <div><label data-i18n="common.email">${esc(t("common.email"))}</label><input id="mEmail" value="${esc(m.email)}"></div>
        </div>
        <label data-i18n="settings.logo">${esc(t("settings.logo"))}</label>
        <input id="mLogo" type="file" accept="image/jpeg,image/png,image/webp">
        <label data-i18n="settings.admissionPrefix">${esc(t("settings.admissionPrefix"))}</label><input id="mPrefix" value="${esc(d.settings.admission_prefix || "")}">
        <div class="form-actions">
          <button class="btn" id="mSave">${esc(t("common.save"))}</button>
          <button class="btn secondary" id="logoSave">📷 ${esc(t("common.save"))}</button>
        </div>
      </div>`);
    $("#mSave").addEventListener("click", async () => {
      try {
        await API.put("/madrasa/profile", {
          name_en: $("#mEn").value.trim(), name_ar: $("#mAr").value.trim(),
          motto_en: $("#mMottoEn").value.trim(), motto_ar: $("#mMottoAr").value.trim(),
          address: $("#mAddr").value.trim(), city: $("#mCity").value.trim(),
          state_name: $("#mState").value.trim(), phone: $("#mPhone").value.trim(),
          email: $("#mEmail").value.trim(),
        });
        await API.put("/madrasa/settings", { admission_prefix: $("#mPrefix").value.trim() });
        toast(t("settings.profileSaved"), "ok");
        await loadMadrasaMeta();
      } catch (e) { toast(errMsg(e), "err"); }
    });
    $("#logoSave").addEventListener("click", async () => {
      const f = $("#mLogo").files[0];
      if (!f) return;
      const fd = new FormData(); fd.append("logo", f);
      try {
        const r = await fetch("/api/madrasa/profile/logo", {
          method: "POST", body: fd, credentials: "same-origin",
          headers: { "X-CSRF-Token": await (async () => { if (window.__csrf) return window.__csrf; const r2 = await API.get("/csrf-token"); window.__csrf = r2.csrfToken; return r2.csrfToken; })() },
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Upload failed"); }
        toast("✓", "ok"); await loadMadrasaMeta();
      } catch (e) { toast(errMsg(e), "err"); }
    });
  });

  /* ====================================================================== */
  /*  TEACHER HOME                                                           */
  /* ====================================================================== */
  async function teacherHome() {
    const [mine] = await Promise.all([API.get("/teachers/me/assignments")]);
    const ann = await API.get("/announcements?limit=5").catch(() => ({ announcements: [] }));
    render(`
      <h1>${esc(t("auth.welcome"))}, ${esc(me.user.fullName)} 👋</h1>
      <div class="card">
        <div class="card-title">📚 ${esc(t("classes.title"))}</div>
        ${mine.classes.map((c) => `<div class="reportlink"><b>${esc(c.name_en)}</b> <span class="muted">${esc(c.name_ar)}</span></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
      </div>
      <div class="card">
        <div class="card-title">📢 ${esc(t("ann.title"))}</div>
        ${ann.announcements.map((a) => `<div class="reportlink"><b>${esc(a.title)}</b><div class="muted small">${esc(new Date(a.created_at).toLocaleDateString())}</div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
      </div>`);
  }

  /* ====================================================================== */
  /*  STUDENT PORTAL                                                         */
  /* ====================================================================== */
  async function studentHome() {
    const d = await API.get("/portal/me");
    const s = d.self || d.children[0] || {};
    const isAr = window.I18N.lang === "ar";
    render(`
      <div class="card">
        <div class="row" style="align-items:center">
          ${s.photo_path ? `<img class="avatar" style="width:84px;height:84px;border-radius:14px" src="${esc(s.photo_path)}">` : `<div class="avatar" style="width:84px;height:84px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem">🎓</div>`}
          <div>
            <h1 style="margin:0">${esc(isAr && s.name_ar ? s.name_ar : s.name)}</h1>
            <div class="muted mono">${esc(s.admission_no || "")}</div>
            <div class="muted">${esc(isAr && s.classAr ? s.classAr : s.classEn || "")}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="form-actions">
          <a class="btn" href="#/results">📝 ${esc(t("portal.myResults"))}</a>
          <a class="btn secondary" href="#/announcements">📢 ${esc(t("nav.announcements"))}</a>
        </div>
      </div>`);
  }

  route("results", async function () {
    if (me.role === "student") return studentResults();
    if (me.role === "parent") return parentResults();
    // admin/teacher entry UI
    return adminResultsUI();
  });

  async function studentResults() {
    const d = await API.get("/portal/results");
    const isAr = window.I18N.lang === "ar";
    render(`
      <h1>${esc(t("portal.myResults"))}</h1>
      ${d.terms.map((x) => `
        <div class="card">
          <div class="card-title">📝 <b>${esc(isAr && x.term_name_ar ? x.term_name_ar : x.term_name)}</b> <span class="muted small">${esc(x.session_label || "")}</span></div>
          <div class="grid cols-4">
            <div class="stat"><div class="num">${x.average}%</div><div class="lbl">${esc(t("results.average"))}</div></div>
            <div class="stat accent"><div class="num">${esc(x.overall_grade)}</div><div class="lbl">${esc(t("results.grade"))}</div></div>
            <div class="stat"><div class="num">${x.position || "—"}</div><div class="lbl">${esc(t("results.position"))}</div></div>
            <div class="stat"><div class="num">${pill(x.promotion_status)}</div><div class="lbl">${esc(t("results.promotion"))}</div></div>
          </div>
          <div class="form-actions">
            <button class="btn small secondary" data-subj="${x.term_id}">📖 ${esc(t("results.subject"))}</button>
            <a class="btn small" target="_blank" href="${API.portalReportUrl(x.term_id)}">🖨 ${esc(t("results.reportCard"))}</a>
          </div>
          <div class="hidden" id="subj-${x.term_id}"></div>
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
    $$("#view [data-subj]").forEach((b) => b.addEventListener("click", async () => {
      const area = $("#subj-" + b.dataset.subj);
      area.classList.toggle("hidden");
      if (area.children.length) return;
      try {
        const sd = await API.get(`/portal/results/${b.dataset.subj}`);
        const isAr2 = window.I18N.lang === "ar";
        area.innerHTML = `
          <div class="tablewrap" style="margin-top:10px"><table>
            <tr><th>${esc(t("results.subject"))}</th><th>${esc(t("results.ca"))}</th><th>${esc(t("results.exam"))}</th><th>${esc(t("results.total"))}</th><th>${esc(t("results.grade"))}</th><th>${esc(t("results.remark"))}</th></tr>
            ${sd.subjects.map((s) => `<tr>
              <td><b>${esc(isAr2 && s.nameAr ? s.nameAr : s.nameEn)}</b></td>
              <td>${s.ca}</td><td>${s.exam}</td><td>${s.total}</td>
              <td><b>${esc(s.grade)}</b></td>
              <td>${esc(isAr2 && s.remarkAr ? s.remarkAr : s.remark)}</td>
            </tr>`).join("")}
          </table></div>`;
      } catch (e) { toast(errMsg(e), "err"); }
    }));
  }

  /* ====================================================================== */
  /*  PARENT PORTAL                                                          */
  /* ====================================================================== */
  async function parentHome() {
    const d = await API.get("/portal/me");
    const isAr = window.I18N.lang === "ar";
    render(`
      <h1>${esc(t("portal.children"))}</h1>
      ${d.children.map((c) => `
        <div class="card">
          <div class="row" style="align-items:center">
            ${c.photo_path ? `<img class="avatar" style="width:64px;height:64px;border-radius:12px" src="${esc(c.photo_path)}">` : ""}
            <div style="flex:1">
              <a href="#/child/${c.id}"><b style="font-size:1.05rem">${esc(isAr && c.name_ar ? c.name_ar : c.first_name + " " + c.last_name)}</b></a>
              <div class="muted small mono">${esc(c.admission_no)} • ${esc(isAr && c.classAr ? c.classAr : c.classEn)}</div>
            </div>
            <a class="btn small secondary" href="#/child/${c.id}">${esc(t("common.edit")) === "" ? "" : "→"}</a>
          </div>
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
  }

  async function parentResults() {
    const d = await API.get("/portal/me");
    if (!d.children.length) { render(`<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`); return; }
    render(`
      <h1>${esc(t("portal.myResults"))}</h1>
      <select id="childSel">${d.children.map((c) => `<option value="${c.id}">${esc(c.first_name + " " + c.last_name)}</option>`).join("")}</select>
      <div id="parentTerms" style="margin-top:12px"></div>`);
    async function loadChild() {
      const cid = Number($("#childSel").value);
      const rd = await API.get("/portal/results?studentId=" + cid);
      const isAr = window.I18N.lang === "ar";
      $("#parentTerms").innerHTML = rd.terms.map((x) => `
        <div class="card">
          <div class="card-title">📝 <b>${esc(isAr && x.term_name_ar ? x.term_name_ar : x.term_name)}</b> <span class="muted small">${esc(x.session_label || "")}</span></div>
          <div class="grid cols-4">
            <div class="stat"><div class="num">${x.average}%</div><div class="lbl">${esc(t("results.average"))}</div></div>
            <div class="stat accent"><div class="num">${esc(x.overall_grade)}</div><div class="lbl">${esc(t("results.grade"))}</div></div>
            <div class="stat"><div class="num">${x.position || "—"}</div><div class="lbl">${esc(t("results.position"))}</div></div>
            <div class="stat"><div class="num">${pill(x.promotion_status)}</div><div class="lbl">${esc(t("results.promotion"))}</div></div>
          </div>
          <a class="btn small" target="_blank" href="${API.portalReportUrl(x.term_id, cid)}">🖨 ${esc(t("results.reportCard"))}</a>
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`;
    }
    $("#childSel").addEventListener("change", loadChild);
    loadChild();
  }

  route("child/:id", async function (params) {
    if (me.role !== "parent") { render(`<div class="empty">403</div>`); return; }
    const rd = await API.get("/portal/results?studentId=" + params.id);
    const isAr = window.I18N.lang === "ar";
    render(`
      <h1>${esc(rd.student.name)}</h1>
      <div class="muted mono">${esc(rd.student.admissionNo)}</div>
      ${rd.terms.map((x) => `
        <div class="card">
          <div class="card-title">📝 <b>${esc(isAr && x.term_name_ar ? x.term_name_ar : x.term_name)}</b></div>
          <div class="grid cols-4">
            <div class="stat"><div class="num">${x.average}%</div><div class="lbl">${esc(t("results.average"))}</div></div>
            <div class="stat accent"><div class="num">${esc(x.overall_grade)}</div><div class="lbl">${esc(t("results.grade"))}</div></div>
            <div class="stat"><div class="num">${x.position || "—"}</div><div class="lbl">${esc(t("results.position"))}</div></div>
            <div class="stat"><div class="num">${pill(x.promotion_status)}</div><div class="lbl">${esc(t("results.promotion"))}</div></div>
          </div>
          <a class="btn small" target="_blank" href="${API.portalReportUrl(x.term_id, rd.student.id)}">🖨 ${esc(t("results.reportCard"))}</a>
        </div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
  });

  /* ====================================================================== */
  /*  BOOT                                                                   */
  /* ====================================================================== */
  (async function boot() {
    try {
      me = await refreshMe();
      if (me && me.loggedIn) {
        await loadMadrasaMeta();
        if (!location.hash || location.hash === "#") location.hash = ROLE_HOME[me.role] || "#/login";
        else routeTo(location.hash.replace(/^#\/?/, ""));
      } else {
        if (!location.hash || !location.hash.startsWith("#/login")) location.hash = "#/login";
        else routeTo("login");
      }
    } catch (err) {
      // Never strand a visitor on the boot spinner: if /auth/me itself fails
      // (API restarting, DB hiccup, etc.) fall back to the public login page,
      // which surfaces real errors once they try to sign in.
      console.error("Boot failed:", err);
      me = null;
      if (!location.hash || !location.hash.startsWith("#/login")) location.hash = "#/login";
      else routeTo("login");
    }
  })();
})();
