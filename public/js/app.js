"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — SPA (Redesigned)
   Mobile-first, bilingual (EN/AR), role-aware routing:
     super_admin → /platform/*
     madrasa_admin → /home /students /teachers /classes /subjects /sessions
                     /results /attendance /fees /announcements /grading /settings
     teacher → /home /results /attendance /announcements
     student → /home /results /announcements
     parent → /home /child/:id /announcements
   Design spec: tokens, header/sidebar drawer, login split, zone dashboards,
   summary strips, striped tables, modal header ×, toasts bottom-center, etc.
   DO NOT change: API calls, routing engine, i18n, navItems return values,
   auth/session, RTL logic.
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
  // bottom-center toast with manual dismiss
  function ensureToastBox(){
    let b = document.getElementById("toastBox");
    if(!b){ b=document.createElement("div"); b.id="toastBox"; document.body.appendChild(b); }
    return b;
  }
  function toast(msg, type) {
    const box = ensureToastBox();
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.innerHTML = `<span>${esc(msg)}</span><button class="toast-x" aria-label="Close">✕</button>`;
    const btn = el.querySelector(".toast-x");
    btn.addEventListener("click", () => { el.style.animation="toastout .18s forwards"; setTimeout(()=>el.remove(),180); });
    box.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.animation="toastout .18s forwards";
      setTimeout(()=>el.remove(),180);
    }, 3000);
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
  function emptyState(icon, title, desc, ctaHtml){
    return `<div class="empty"><div class="empty-illust">${icon}</div><div style="font-weight:700;margin-bottom:4px">${esc(title)}</div><div class="small muted" style="margin-bottom:12px">${esc(desc||"")}</div>${ctaHtml||""}</div>`;
  }
  function openModal(html, onMount) {
    closeAllModals();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    // Detect if html already contains modal-head; if not, auto-wrap first h2 into header
    let inner = html.trim();
    const hasHead = /class=["']modal-head["']/.test(inner);
    if(!hasHead){
      // extract first <h2>...</h2> as title
      const m = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if(m){
        const title = m[1];
        inner = inner.replace(m[0], "");
        inner = `<div class="modal-head"><h2>${title}</h2><button class="modal-close" aria-label="Close" data-close-x>✕</button></div><div class="modal-body">${inner}</div>`;
      } else {
        inner = `<div class="modal-head"><h2>${esc(t("common.actions"))}</h2><button class="modal-close" aria-label="Close" data-close-x>✕</button></div><div class="modal-body">${inner}</div>`;
      }
    } else {
      // ensure close button exists
      if(!/data-close-x/.test(inner)){
        inner = inner.replace(/(<div class="modal-head"[^>]*>)/, `$1<button class="modal-close" aria-label="Close" data-close-x>✕</button>`);
      }
      // if body not wrapped, ensure
      if(!/modal-body/.test(inner)){
        inner = inner.replace(/<\/div>\s*$/, `</div>`);
      }
    }
    backdrop.innerHTML = `<div class="modal">${inner}</div>`;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    const closeX = backdrop.querySelector("[data-close-x]");
    if(closeX) closeX.addEventListener("click", ()=>backdrop.remove());
    if (onMount) onMount(backdrop);
  }
  function closeAllModals() { $$(".modal-backdrop").forEach((m) => m.remove()); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function greeting(){
    const h = new Date().getHours();
    if(h < 12) return "Good morning";
    if(h < 18) return "Good afternoon";
    return "Good evening";
  }

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
        L("platform/backups", t("nav.backups"), "🛟"),
        L("platform/settings", t("nav.publicSite"), "🌐"),
      ];
    }
    if (role === "madrasa_admin") {
      return [
        L("home", t("nav.dashboard"), "📊"),
        L("students", t("nav.students"), "🎓"),
        L("teachers", t("nav.teachers"), "👨‍🏫"),
        L("admissions", t("nav.admissions"), "📥"),
        L("classes", t("nav.classes"), "📚"),
        L("subjects", t("nav.subjects"), "📖"),
        L("sessions", t("nav.sessions"), "🗓️"),
        L("timetable", t("nav.timetable"), "🗓"),
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
        L("timetable", t("nav.timetable"), "🗓"),
        L("announcements", t("nav.announcements"), "📢"),
      ];
    }
    if (role === "student") {
      return [
        L("home", t("nav.profile"), "👤"),
        L("results", t("nav.results"), "📝"),
        L("timetable", t("nav.timetable"), "🗓"),
        L("announcements", t("nav.announcements"), "📢"),
      ];
    }
    // parent
    return [
      L("home", t("portal.children"), "👨‍👩‍👧"),
      L("timetable", t("nav.timetable"), "🗓"),
      L("announcements", t("nav.announcements"), "📢"),
    ];
  }

  function roleBadge(role){
    const map={ super_admin:"Super Admin", madrasa_admin:"Admin", teacher:"Teacher", student:"Student", parent:"Parent" };
    return map[role] || role;
  }

  function sidebarGroupedHtml(role, items, current){
    // Build grouped sidebar for madrasa_admin & super_admin, flat for others
    const link = (i)=> `<a href="#/${i.key}" class="${current===i.key || current.startsWith(i.key+'/') || (i.key==='platform' && current==='platform' ? 'active' : current.startsWith(i.key) ? 'active':'')}">${i.icon} ${esc(i.label)}</a>`;
    // helper to check active precisely
    const isActive = (k)=> current===k || current.startsWith(k+"/") || (k==="platform" && current==="platform");
    const aTag = (i)=> `<a href="#/${i.key}" class="${isActive(i.key)?"active":""}">${i.icon} ${esc(i.label)}</a>`;
    if(role==="super_admin"){
      const dash = items.find(x=>x.key==="platform");
      const madaris = items.find(x=>x.key==="platform/madaris");
      const plans = items.find(x=>x.key==="platform/plans");
      const act = items.find(x=>x.key==="platform/activity");
      const bk = items.find(x=>x.key==="platform/backups");
      const ps = items.find(x=>x.key==="platform/settings");
      return `
        ${dash ? aTag(dash) : ""}
        <div class="sidebar-label">Management</div>
        ${madaris ? aTag(madaris):""}
        ${plans ? aTag(plans):""}
        <div class="sidebar-label">Monitoring</div>
        ${act ? aTag(act):""}
        ${bk ? aTag(bk):""}
        <div class="sidebar-label">Platform</div>
        ${ps ? aTag(ps):""}
      `;
    }
    if(role==="madrasa_admin"){
      const byKey = Object.fromEntries(items.map(x=>[x.key,x]));
      return `
        ${byKey["home"]?aTag(byKey["home"]):""}
        <div class="sidebar-label">People</div>
        ${byKey["students"]?aTag(byKey["students"]):""}
        ${byKey["teachers"]?aTag(byKey["teachers"]):""}
        ${byKey["admissions"]?aTag(byKey["admissions"]):""}
        <div class="sidebar-label">Academics</div>
        ${byKey["classes"]?aTag(byKey["classes"]):""}
        ${byKey["subjects"]?aTag(byKey["subjects"]):""}
        ${byKey["sessions"]?aTag(byKey["sessions"]):""}
        ${byKey["timetable"]?aTag(byKey["timetable"]):""}
        ${byKey["results"]?aTag(byKey["results"]):""}
        ${byKey["attendance"]?aTag(byKey["attendance"]):""}
        <div class="sidebar-label">Finance</div>
        ${byKey["fees"]?aTag(byKey["fees"]):""}
        <div class="sidebar-label">Communication</div>
        ${byKey["announcements"]?aTag(byKey["announcements"]):""}
        <div class="sidebar-label">Reports</div>
        ${byKey["analytics"]?aTag(byKey["analytics"]):""}
        <div class="sidebar-label">Configuration</div>
        ${byKey["grading"]?aTag(byKey["grading"]):""}
        ${byKey["settings"]?aTag(byKey["settings"]):""}
      `;
    }
    // teacher, student, parent flat
    return items.map(aTag).join("");
  }

  function renderLayout(route) {
    const m = madrasaMeta();
    const name = me.user ? me.user.fullName || me.user.username : "";
    const items = navItems(me.role);
    const current = route || location.hash.replace(/^#\/?/, "");
    const sidebarHtml = sidebarGroupedHtml(me.role, items, current);
    const madrasaName = m.name_ar && window.I18N.lang === "ar" ? m.name_ar : m.name_en;
    const displayName = madrasaName || t("app.name");
    const roleLbl = roleBadge(me.role);

    document.body.innerHTML = `
      <div class="layout">
        <header class="appbar">
          <button class="iconbtn hamburger" id="hamburger" aria-label="Menu">☰</button>
          <div class="brand">
            ${m.logo_path ? `<img class="logo" src="${esc(m.logo_path)}" alt="">` : `<span class="logo-fallback">🕌</span>`}
            <span>${esc(displayName)}</span>
          </div>
          <div class="spacer"></div>
          <span class="role-badge">${esc(roleLbl)}</span>
          <span class="user-name">${esc(name)}</span>
          <button class="iconbtn" id="themeBtn" title="${esc(t("common.appearance"))}">${window.Theme && window.Theme.get() === "dark" ? "☀" : "🌙"}</button>
          <button class="iconbtn" id="langBtn" title="Language">${window.I18N.lang === "ar" ? "EN" : "ع"}</button>
          <button class="iconbtn" id="logoutBtn" title="${esc(t("auth.logout"))}">⎋</button>
        </header>
        <div class="drawer-backdrop" id="drawerBackdrop"></div>
        <aside class="sidebar" id="sidebar">
          <button class="drawer-close" id="drawerClose" aria-label="Close">✕</button>
          ${sidebarHtml}
        </aside>
        <main class="main">
          ${me.role === "super_admin" ? `<div id="storageNotice"></div>` : ""}
          <div id="view"><div class="empty">${esc(t("common.loading"))}</div></div>
        </main>
      </div>`;
    // drawer logic
    const sidebarEl = document.getElementById("sidebar");
    const backdrop = document.getElementById("drawerBackdrop");
    const ham = document.getElementById("hamburger");
    const closeBtn = document.getElementById("drawerClose");
    function openDrawer(){ sidebarEl.classList.add("open"); backdrop.classList.add("open"); document.body.style.overflow="hidden"; }
    function closeDrawer(){ sidebarEl.classList.remove("open"); backdrop.classList.remove("open"); document.body.style.overflow=""; }
    ham.addEventListener("click", openDrawer);
    closeBtn.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    // close drawer on nav click (mobile)
    sidebarEl.querySelectorAll("a").forEach(a=>a.addEventListener("click", closeDrawer));
    // language & logout
    $("#themeBtn").addEventListener("click", () => {
      window.Theme.toggle();
      routeTo(current);
    });
    if (me.role === "super_admin") loadStorageNotice();
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
    const full = (rawPath || "").replace(/^\/+/, "");
    const qi = full.indexOf("?");
    const path = qi >= 0 ? full.slice(0, qi) : full;
    window.__query = new URLSearchParams(qi >= 0 ? full.slice(qi + 1) : "");
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
    const isPublic = window.Public.isPublicPath(path);
    if (!handler) {
      if (me && me.loggedIn) { renderLayout(path); render(`<div class="empty">${esc(t("activity.notFound"))}</div>`); }
      else if (isPublic) { location.hash = "#/"; }
      else location.hash = "#/login";
      return;
    }
    // The login screen is the app's PUBLIC entry point: it must render for
    // logged-out visitors too (otherwise a fresh visitor is stuck forever on
    // the boot "Loading…" element — every route was behind requireLogin).
    const isLoginRoute = path === "login";
    // Public pages render for logged-out visitors; a logged-in visitor may
    // still browse them (that is how admins preview their own public page).
    if (!isLoginRoute && !isPublic && !requireLogin()) return;
    if (!isLoginRoute && !isPublic) renderLayout(path);
    try {
      await handler(params);
    } catch (e) {
      console.error(e);
      if (e.status === 401) { me = null; location.hash = "#/login"; return; }
      toast(errMsg(e), "err");
    }
  }

  window.addEventListener("hashchange", () => routeTo(location.hash.replace(/^#\/?/, "")));

  // Bridge for public/js/public.js (it renders before/without the app shell).
  window.__mmToast = toast;
  window.App = { routeTo, refreshMe, get me() { return me; } };

  /* ====================================================================== */
  /*  LOGIN                                                                  */
  /* ====================================================================== */
  route("login", async function () {
    if (me && me.loggedIn) { location.hash = ROLE_HOME[me.role]; return; }
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-split">
          <div class="login-left">
            <div class="login-left-inner">
              <span class="mosque">🕌</span>
              <h1>Bello Institute</h1>
              <p class="tagline">Nurturing knowledge, faith and excellence across all your madaris — one platform.</p>
              <div class="pattern-note">منصة إدارة المدارس • Multi-Madrasa SaaS</div>
            </div>
          </div>
          <div class="login-right">
            <div class="login-card">
              <h1>${esc(t("auth.login"))} • Welcome back</h1>
              <div class="sub">Sign in to your account</div>
              <div id="loginMsg"></div>
              <form id="loginForm">
                <label for="loginUser">${esc(t("auth.username"))}</label>
                <input id="loginUser" autocomplete="username" required placeholder="username">
                <label for="loginPass">${esc(t("auth.password"))}</label>
                <div class="password-wrap">
                  <input id="loginPass" type="password" autocomplete="current-password" required placeholder="••••••••">
                  <button type="button" class="eye-btn" id="eyeBtn" aria-label="Show password">👁</button>
                </div>
                <div class="form-actions">
                  <button class="btn" id="loginBtn" style="flex:1" type="submit">${esc(t("auth.loginBtn"))}</button>
                </div>
                <a href="#" class="lang-link" id="loginLang">${window.I18N.lang === "ar" ? "English" : "العربية"}</a>
                <div class="login-foot"><a href="#/">← ${esc(t("pub.backHome"))}</a> · <a href="#/results-check">${esc(t("pub.nav.results"))}</a> · <a href="#/apply">${esc(t("pub.nav.apply"))}</a></div>
              </form>
            </div>
          </div>
        </div>
      </div>`;
    window.I18N.applyStatic(document.body);
    $("#loginLang").addEventListener("click", (e) => {
      e.preventDefault();
      window.I18N.setLang(window.I18N.lang === "ar" ? "en" : "ar");
      routeTo("login");
    });
    const eye = $("#eyeBtn");
    const passInput = $("#loginPass");
    eye.addEventListener("click", ()=>{
      const isText = passInput.type==="text";
      passInput.type = isText ? "password" : "text";
      eye.textContent = isText ? "👁" : "🙈";
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
  /*  STORAGE NOTICE (super admin) — why a madrasa can "disappear"           */
  /* ====================================================================== */
  async function loadStorageNotice() {
    const box = document.getElementById("storageNotice");
    if (!box || box.dataset.loaded === "1") return;
    box.dataset.loaded = "1";
    try {
      const d = await API.get("/platform/backups/diagnostics");
      const p = d.persistence || {};
      if (p.level === "ok" && !(d.backups && !d.backups.newest)) {
        box.innerHTML = "";
        return;
      }
      const lost = (p.warnings || []).some((w) => w.code === "DATA_LOSS_DETECTED");
      const cls = p.level === "critical" ? "err" : p.level === "warn" ? "warn" : "ok";
      box.innerHTML = `
        <div class="storage-note ${cls}">
          <div class="sn-head"><b>${esc(p.level === "critical" ? t("storage.critical") : p.level === "warn" ? t("storage.warn") : t("storage.ok"))}</b>
            <button class="toast-x" id="snClose" aria-label="Close">✕</button></div>
          ${(p.warnings || []).slice(0, 3).map((w) => `<div class="small">${esc(w.message)}</div>`).join("")}
          ${lost ? `<div class="small"><b>${esc(t("storage.emptyButKnown"))}</b></div>` : ""}
          <div class="sn-actions">
            <a class="btn small" href="#/platform/backups">${esc(t("nav.backups"))} →</a>
            <span class="muted small">${esc(t("storage.rows"))}: ${Object.entries(p.counts || {}).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(", ") || "—"} • ${esc(t("bk.last"))}: ${d.backups && d.backups.newest ? esc(new Date(d.backups.newest.createdAt).toLocaleString()) : esc(t("bk.never"))}</span>
          </div>
        </div>`;
      const close = document.getElementById("snClose");
      if (close) close.addEventListener("click", () => { box.innerHTML = ""; });
    } catch (e) { box.dataset.loaded = "0"; }
  }

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

  function kpi(value, label, sub, tone, icon, trend) {
    const iconHtml = icon ? `<div class="k-icon">${icon}</div>` : "";
    const trendHtml = trend ? `<span class="k-trend ${trend.startsWith("↑")?"trend-up":trend.startsWith("↓")?"trend-down":""}">${esc(trend)}</span>` : "";
    return `<div class="kpi ${tone || ""}"><div class="k-icon" style="${icon?'':'display:none'}">${icon||""}</div>` +
      `<div class="k-body"><div class="k-num">${esc(value)}</div>` +
      `<div class="k-lbl">${esc(label)}</div>` +
      (sub ? `<div class="k-sub">${esc(sub)}</div>` : "") + `</div>${trendHtml}</div>`;
  }
  function heroKpi(value, label, sub, tone, icon, trend){
    // hero row: larger icon left
    const tr = trend ? `<span class="k-trend ${trend.includes("↑")?"trend-up":"trend-down"}">${esc(trend)}</span>` : "";
    return `<div class="kpi hero ${tone||""}"><div class="k-icon">${icon||"📊"}</div><div class="k-body"><div class="k-num">${esc(value)} ${tr}</div><div class="k-lbl">${esc(label)}</div>${sub?`<div class="k-sub">${esc(sub)}</div>`:""}</div></div>`;
  }

  function chartCard(title, note, body, accentTop) {
    return `<div class="card chart-card ${accentTop?"accent-top":""}"><div class="chart-head">` +
      `<span class="ch-title">${esc(title)}</span>` +
      (note ? `<span class="ch-note">${esc(note)}</span>` : "") +
      `</div>${body}</div>`;
  }

  function kpiRow(a) {
    const c = C();
    const feeTone = a.fees.collectionRate >= 80 ? "ok" : a.fees.collectionRate >= 50 ? "warn" : "danger";
    return `<div class="kpis">` +
      kpi(a.totals.students, t("an.students"), `${a.totals.classes} ${t("an.classes")} · ${a.totals.teachers} ${t("an.teachers")}`, "", "🎓") +
      kpi(a.attendance.rate + "%", t("an.attendanceRate"), `${a.attendance.marked} ${t("an.marked")}`, "accent", "✅") +
      kpi(c.money(a.fees.collected), t("an.collected"), `${t("an.outstanding")} ${c.money(a.fees.outstanding)}`, feeTone, "💰") +
      kpi(a.results.average == null ? "—" : a.results.average + "%", t("an.average"),
        a.results.summaries ? `${a.results.passRate}% ${t("an.passRate")}` : t("an.noData"), "ok", "📈") +
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
          ${heroKpi(st.madaris, t("pf.madaris"), `${st.activeMadaris} ${t("common.active")}`, "", "🏫")}
          ${heroKpi(st.students, t("pf.students"), "", "accent", "🎓")}
          ${heroKpi(st.teachers, t("an.teachers"), "", "", "👨‍🏫")}
          ${heroKpi(st.parents, t("an.parents"), "", "", "👨‍👩‍👧")}
        </div>`);
      return;
    }

    const a = an.analytics;
    // hero KPIs with trends if available
    const trendM = a.madrasaTrend && a.madrasaTrend.length>=2 ? (()=>{ const v=a.madrasaTrend; const last=v[v.length-1].value, prev=v[v.length-2].value; if(last>prev) return "↑ "+Math.round(((last-prev)/Math.max(1,prev))*100)+"%"; if(last<prev) return "↓ "+Math.round(((prev-last)/Math.max(1,prev))*100)+"%"; return ""; })() : "";
    const trendS = a.studentTrend && a.studentTrend.length>=2 ? (()=>{ const v=a.studentTrend; const last=v[v.length-1].value, prev=v[v.length-2].value; if(last>prev) return "↑ "+Math.round(((last-prev)/Math.max(1,prev))*100)+"%"; if(last<prev) return "↓ "; return ""; })() : "";
    render(`
      <h1>${esc(t("platform.title"))}</h1>
      <div class="kpis">
        ${heroKpi(a.totals.madaris, "Total Madaris", `${a.totals.activeMadaris} ${t("common.active")}`, "", "🏫", trendM)}
        ${heroKpi(a.totals.activeMadaris, "Active Madaris", "", "ok", "✅")}
        ${heroKpi(a.totals.students, "Total Students", `+${a.totals.newStudents30d} ${t("pf.newStudents30d")}`, "accent", "🎓", trendS)}
        ${heroKpi(c.money(a.totals.feesCollected), t("pf.feesCollected"), "", "ok", "💰")}
      </div>
      <div class="grid cols-2">
        ${chartCard("🏫 Growth by Month", monthsLabel(12), c.bar(a.madrasaTrend, { format: c.int, emptyText: noData }), true)}
        ${chartCard("🎓 Students by Month", monthsLabel(12), c.bar(a.studentTrend, { format: c.int, tone: "accent", emptyText: noData }), true)}
      </div>
      <div class="triple-row">
        <div class="card">
          <div class="card-title">📋 Recent Madaris</div>
          ${a.recentMadaris.slice(0,5).map((m) => `<a class="reportlink" href="#/platform/madaris/${m.id}"><div style="flex:1"><b>${esc(nm(m))}</b> <span class="mono muted small">${esc(m.slug)}</span><div class="muted small">${esc(m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "")}</div></div><span class="pill ${m.status === "active" ? "ok" : "bad"}">${esc(m.status)}</span> <span class="pill gold" style="margin-inline-start:6px">${esc((m.plan_code||m.plan||""))}</span></a>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
        </div>
        <div class="card">
          <div class="card-title">⚡ Top Actions</div>
          ${c.hbar(a.activity.topActions, { format: c.int, emptyText: noData })}
        </div>
        <div class="card">
          <div class="card-title">🕘 Recent Activity</div>
          ${st.recentActivity.slice(0,5).map((x) => `<div class="reportlink" style="padding:8px 10px"><div style="flex:1;min-width:0"><div class="small"><b>${esc(x.username||"—")}</b> <span class="muted">· ${esc(x.action)}</span></div><div class="muted small">${esc(x.madrasa_slug||"—")} · ${esc(new Date(x.created_at).toLocaleString())}</div></div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
        </div>
      </div>
      <h2>${esc(t("platform.plans"))}</h2>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>${esc(t("platform.plan"))}</th><th>${esc(t("pf.madaris"))}</th><th>${esc(t("pf.students"))}</th></tr>
        ${a.byPlan.map((x) => `<tr><td><b>${esc(x.label)}</b> <span class="mono muted small">${esc(x.code)}</span></td><td>${x.madaris}</td><td>${x.students}</td></tr>`).join("")}
      </table></div></div>`);
  }));

  route("platform/madaris", SA(async function () {
    const d = await API.get("/platform/madaris");
    const all = d.madaris || [];
    const total = all.length;
    const active = all.filter(m=>m.status==="active").length;
    const suspended = total - active;
    const plans = [...new Set(all.map(m=>m.plan_code).filter(Boolean))];
    function filteredRows(list){ return list; } // placeholder for initial render
    render(`
      <div class="page-head"><h1>${esc(t("nav.madaris"))}</h1><div class="actions"><button class="btn" id="addBtn">+ ${esc(t("platform.add"))}</button></div></div>
      <div class="summary-strip">
        <div class="sum"><b>${total}</b><span>Total</span></div>
        <div class="sum"><b>${active}</b><span>Active</span></div>
        <div class="sum"><b>${suspended}</b><span>Suspended</span></div>
      </div>
      <div class="filter-bar">
        <div class="fb-field"><label>Search</label><div class="searchbar"><span class="ico">🔍</span><input id="madSearch" placeholder="Search by name or slug…"></div></div>
        <div class="fb-field" style="max-width:180px"><label>Status</label><select id="madStatus"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div class="fb-field" style="max-width:180px"><label>Plan</label><select id="madPlan"><option value="">All</option>${plans.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select></div>
      </div>
      <div class="card">
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("platform.plan"))}</th><th>${esc(t("platform.students"))}</th><th>${esc(t("common.status"))}</th><th></th></tr>
          <tbody id="madRows">
          ${all.map((m) => `<tr data-name="${esc(m.name_en.toLowerCase())} ${esc(m.slug.toLowerCase())}" data-status="${esc(m.status)}" data-plan="${esc(m.plan_code)}">
            <td><a href="#/platform/madaris/${m.id}"><b>${esc(m.name_en)}</b></a><div class="muted small">${esc(m.name_ar)} <span class="mono">${esc(m.slug)}</span></div></td>
            <td><span class="pill gold">${esc(m.plan_code)}</span></td>
            <td>${m.student_count}</td>
            <td>${m.status === "active" ? pill("active") : pill("suspended")}</td>
            <td><a class="btn small secondary" href="#/platform/madaris/${m.id}">${esc(t("common.edit"))}</a></td>
          </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="row-count" id="madCount">Showing ${total} records</div>
      </div>`);
    $("#addBtn").addEventListener("click", () => madrasaForm());
    const searchEl = $("#madSearch"), statusEl=$("#madStatus"), planEl=$("#madPlan"), tbody=$("#madRows"), countEl=$("#madCount");
    function applyFilter(){
      const q = searchEl.value.trim().toLowerCase();
      const st = statusEl.value;
      const pl = planEl.value;
      let visible=0;
      $$("tr",tbody).forEach(tr=>{
        const name = tr.getAttribute("data-name")||"";
        const s = tr.getAttribute("data-status")||"";
        const p = tr.getAttribute("data-plan")||"";
        const ok = (!q || name.includes(q)) && (!st || s===st) && (!pl || p===pl);
        tr.style.display = ok ? "" : "none";
        if(ok) visible++;
      });
      countEl.textContent = `Showing ${visible} records`;
    }
    searchEl.addEventListener("input", applyFilter);
    statusEl.addEventListener("change", applyFilter);
    planEl.addEventListener("change", applyFilter);
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
      <div class="grid cols-2" style="margin-top:12px">
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
    // fetch stats for human-readable names (already has recentActivity with slug/username)
    const stats = await API.get("/platform/stats").catch(()=>({recentActivity:[]}));
    // map id→name from stats recentActivity
    const madrasaMap={}, userMap={};
    (stats.recentActivity||[]).forEach(x=>{
      if(x.madrasa_id && x.madrasa_slug) madrasaMap[x.madrasa_id]=x.madrasa_slug;
      if(x.user_id && x.username) userMap[x.user_id]=x.username;
    });
    let range="all";
    let since=null;
    let allRows=[];
    async function fetchRows(){
      let url="/platform/activity?limit=200";
      if(since) url+=`&since=${encodeURIComponent(since)}`;
      // also try ?since param on platform/activity (if backend supports it, else ignore)
      // We'll also handle client filtering if needed
      const d = await API.get(url).catch(async()=>{
        // fallback without since if backend rejects
        return await API.get("/platform/activity?limit=200");
      });
      allRows = (d.activity||[]).map(a=>{
        // enrich with human readable if available
        const slug = a.madrasa_slug || madrasaMap[a.madrasa_id] || a.madrasa_slug || "";
        const uname = a.username || userMap[a.user_id] || "";
        return Object.assign({},a,{_slug: slug || (a.madrasa_id||"—"), _user: uname || (a.user_id||"—")});
      });
      // if backend didn't filter by since, do client-side
      if(since){
        const cutoff = new Date(since).getTime();
        allRows = allRows.filter(r=> new Date(r.created_at).getTime() >= cutoff);
      }
      renderTable();
    }
    function renderTable(){
      const q = ($("#actSearch") && $("#actSearch").value.trim().toLowerCase()) || "";
      let rows = allRows;
      if(q){
        rows = rows.filter(r=> String(r._user).toLowerCase().includes(q) || String(r.action).toLowerCase().includes(q) || String(r._slug).toLowerCase().includes(q));
      }
      const tbody = $("#actRows");
      if(!tbody) return;
      tbody.innerHTML = rows.map((a) => `<tr>
          <td class="muted">${esc(new Date(a.created_at).toLocaleString())}</td>
          <td>${esc(a._slug || a.madrasa_slug || a.madrasa_id || "—")}</td>
          <td>${esc(a._user || a.username || a.user_id || "—")}</td>
          <td>${esc(a.action)}</td>
          <td>${esc(a.entity)} ${esc(a.entity_id)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">${esc(t("common.noData"))}</td></tr>`;
      const cnt = $("#actCount");
      if(cnt) cnt.textContent = `Showing ${rows.length} records`;
    }
    render(`
      <h1>${esc(t("platform.activity"))}</h1>
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div class="segs" id="rangeSeg">
          <button data-range="1" class="${range==="1"?"on":""}">Last 24h</button>
          <button data-range="7" class="${range==="7"?"on":""}">7d</button>
          <button data-range="30" class="${range==="30"?"on":""}">30d</button>
          <button data-range="all" class="${range==="all"?"on":""}">All</button>
        </div>
        <div class="searchbar" style="flex:1 1 220px"><span class="ico">🔍</span><input id="actSearch" placeholder="Search by user or action…"></div>
      </div>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>Time</th><th>Madrasa</th><th>User</th><th>Action</th><th>Entity</th></tr>
        <tbody id="actRows"><tr><td colspan="5" class="empty">${esc(t("common.loading"))}</td></tr></tbody>
      </table></div><div class="row-count" id="actCount"></div></div>`);
    // events
    $$("#rangeSeg button").forEach(b=>b.addEventListener("click", ()=>{
      $$("#rangeSeg button").forEach(x=>x.classList.remove("on"));
      b.classList.add("on");
      range=b.dataset.range;
      if(range==="all") since=null;
      else {
        const d=new Date(); d.setDate(d.getDate()-Number(range));
        // for 1 day, use 24h
        if(range==="1"){ const d2=new Date(); d2.setHours(d2.getHours()-24); since=d2.toISOString(); }
        else since=d.toISOString();
      }
      fetchRows();
    }));
    // search
    $("#actSearch").addEventListener("input", renderTable);
    await fetchRows();
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
        <div class="greeting-banner"><div class="greet">${esc(greeting())}, ${esc(me.user.fullName||me.user.username)} 👋</div><div class="sub">${esc(madrasaMeta().name_en||"")}</div></div>
        <div class="kpis">
          ${kpi(students.total, t("an.students"), "", "", "🎓")}
          ${kpi(teachers.teachers.length, t("an.teachers"), "", "accent", "👨‍🏫")}
          ${kpi(classes.classes.length, t("an.classes"), "", "", "📚")}
          ${kpi(subjects.subjects.length, t("an.subjects"), "", "", "📖")}
        </div>`);
      return;
    }

    const a = an.analytics;
    const termName = a.term ? nm({ label: a.term.nameEn, labelAr: a.term.nameAr }) : "";
    const m = madrasaMeta();
    const schoolName = m.name_en || m.name_ar || "";
    const termLabel = a.term ? (a.term.nameEn || a.term.nameAr || termName) : "";
    render(`
      <div class="greeting-banner">
        <div class="greet">${esc(greeting())}, ${esc(me.user.fullName||me.user.username)} 👋</div>
        <div class="sub">${esc(schoolName)}${termLabel?` • ${esc(termLabel)}`:""}</div>
      </div>
      <div class="kpis">
        ${kpi(a.totals.students, "Students", `${a.totals.classes} classes`, "", "🎓")}
        ${kpi(a.totals.teachers, "Teachers", "", "accent", "👨‍🏫")}
        ${kpi(a.totals.classes, "Classes", "", "", "📚")}
        ${kpi(C().money(a.fees.outstanding), "Fees Outstanding", "", "warn", "💰")}
      </div>
      <div class="card">
        <div class="card-title">⚡ ${esc(t("dash.quickActions"))}</div>
        <div class="quick-actions">
          <a class="btn ghost" href="#/students">+ Add Student</a>
          <a class="btn ghost" href="#/results">Enter Results</a>
          <a class="btn ghost" href="#/attendance">Mark Attendance</a>
          <a class="btn ghost" href="#/analytics">View Analytics</a>
        </div>
      </div>
      <div class="grid cols-2">
        <div style="display:grid;gap:12px">
          ${chartCard("📊 Enrolment vs Attendance", monthsLabel(6), c.bar(a.enrolment.trend, { format: c.int, emptyText: noData }))}
          ${chartCard("", daysLabel(30), c.line(a.attendance.daily, { max: 100, nice: false, format: (v) => v + "%", axisFormat: (v) => v + "%", emptyText: noData }))}
        </div>
        <div style="display:grid;gap:12px">
          <div class="card">
            <div class="card-title">🗓️ Current Sessions</div>
            ${sessions.sessions.slice(0, 3).map((s) => `
              <div class="reportlink"><div><b>${esc(s.label)}</b> ${s.is_current ? `<span class="pill ok">${esc(t("sessions.current"))}</span>` : ""}<div class="muted small">${(s.terms || []).map((x) => esc(x.name_en)).join(" • ")}</div></div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
          </div>
          <div class="card">
            <div class="card-title">📢 Latest Announcements</div>
            ${ann.announcements.slice(0, 3).map((x) => `<div class="reportlink"><div><b>${esc(x.title)}</b><div class="muted small">${esc(new Date(x.created_at).toLocaleDateString())}</div></div></div>`).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}
          </div>
        </div>
      </div>
      ${watchPanel(a)}
    `);
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
    let statusFilter = "all";
    let rows = [];
    async function load() {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (classFilter !== "0") q.set("classId", classFilter);
      q.set("perPage", "200");
      const d = await API.get("/students?" + q.toString());
      rows = d.students;
      renderRows();
    }
    function renderRows(){
      // compute summary counts from loaded rows
      const counts = { all: rows.length, active:0, suspended:0, promoted:0 };
      rows.forEach(s=>{ if(s.status==="active") counts.active++; else if(s.status==="suspended") counts.suspended++; else if(s.status==="promoted") counts.promoted++; });
      const summaryEl = $("#statusSummary");
      if(summaryEl){
        summaryEl.innerHTML = `
          <button class="status-chip ${statusFilter==="all"?"active":""}" data-st="all">All <small>${counts.all}</small></button>
          <button class="status-chip ${statusFilter==="active"?"active":""}" data-st="active">Active <small>${counts.active}</small></button>
          <button class="status-chip ${statusFilter==="suspended"?"active":""}" data-st="suspended">Suspended <small>${counts.suspended}</small></button>
          <button class="status-chip ${statusFilter==="promoted"?"active":""}" data-st="promoted">Promoted <small>${counts.promoted}</small></button>
        `;
        $$("[data-st]", summaryEl).forEach(b=>b.addEventListener("click", ()=>{ statusFilter=b.dataset.st; renderRows(); }));
      }
      let display = rows;
      if(statusFilter!=="all") display = display.filter(s=>s.status===statusFilter);
      const tbody = $("#stuRows");
      if (tbody) {
        if(!display.length){
          if(rows.length===0){
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-illust">🎓</div><div style="font-weight:700;margin-bottom:4px">No students yet</div><div class="small muted" style="margin-bottom:12px">Add your first student to get started.</div><button class="btn" id="emptyAddBtn">+ Add First Student</button></div></td></tr>`;
            const eb = $("#emptyAddBtn", tbody); if(eb) eb.addEventListener("click", ()=>studentForm(classes.classes));
          } else {
            tbody.innerHTML = `<tr><td colspan="6" class="empty">${esc(t("common.noData"))}</td></tr>`;
          }
        } else {
          tbody.innerHTML = display.map((s) => `
          <tr>
            <td>${s.photo_path ? `<img class="thumb" src="${esc(s.photo_path)}" alt="">` : `<span class="thumb-fallback">👤</span>`}</td>
            <td><a href="#/students/${s.id}"><b>${esc(s.first_name)} ${esc(s.last_name)}</b></a></td>
            <td class="mono">${esc(s.admission_no)}</td>
            <td>${esc(s.class_en || t("common.none"))}</td>
            <td>${pill(s.status)}</td>
            <td><a class="btn small secondary icon-only" href="#/students/${s.id}" title="View">👁</a></td>
          </tr>`).join("");
        }
        const rc = $("#rowCount");
        if(rc) rc.textContent = `Showing ${display.length} records`;
      }
    }
    render(`
      <div class="page-head"><h1>${esc(t("students.title"))}</h1>
        <div class="actions">
          <button class="btn" id="addBtn">+ ${esc(t("students.add"))}</button>
          <button class="btn secondary" id="importBtn">📥 ${esc(t("students.import"))}</button>
          <button class="btn ghost" id="exportBtn" title="CSV">⬇ ${esc(t("common.export"))}</button>
        </div>
      </div>
      <div class="card" style="padding:12px">
        <div class="status-chips" id="statusSummary"></div>
      </div>
      <div class="card">
        <div class="row">
          <div class="searchbar"><span class="ico">🔍</span><input id="stuSearch" data-i18n-ph="students.searchPlaceholder" placeholder="${esc(t("students.searchPlaceholder"))}"></div>
          <select id="stuClass" style="max-width:220px">
            <option value="0">${esc(t("common.all"))} — ${esc(t("students.class"))}</option>
            ${classes.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="card">
        <div class="tablewrap"><table>
          <tr><th></th><th>${esc(t("common.name"))}</th><th>${esc(t("students.admissionNo"))}</th><th>${esc(t("students.class"))}</th><th>${esc(t("students.status"))}</th><th></th></tr>
          <tbody id="stuRows"></tbody>
        </table></div>
        <div class="row-count" id="rowCount"></div>
      </div>`);
    let deb;
    $("#stuSearch").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => { search = e.target.value.trim(); load(); }, 350); });
    $("#stuClass").addEventListener("change", (e) => { classFilter = e.target.value; load(); });
    $("#addBtn").addEventListener("click", () => studentForm(classes.classes));
    $("#exportBtn").addEventListener("click", () => {
      const q = new URLSearchParams();
      if (classFilter !== "0") q.set("classId", classFilter);
      if (statusFilter !== "all") q.set("status", statusFilter);
      location.href = API.url("/exports/students.csv?" + q.toString());
    });
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
            const r = await fetch(`/api/students/${s.id}/photo`, { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRF-Token": await (async () => { if (window.__csrf) return window.__csrf; const r2 = await API.get("/csrf-token"); window.__csrf = r2.csrfToken; return r2.csrfToken; })() } });
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
        <div class="row-count">Showing ${d.teachers.length} records</div>
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
        <div class="row-count">Showing ${d.subjects.length} records</div>
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
            <button class="btn ghost" id="sumExport">⬇ ${esc(t("common.export"))} CSV</button>
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
      $("#sumExport").addEventListener("click", () => {
        location.href = API.url(`/exports/summary.csv?classId=${state.classId}&termId=${state.termId}`);
      });
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
            <div class="row-count">Showing ${d.students.length} records</div>
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
      <div class="page-head"><h1>${esc(t("attendance.title"))}</h1>
        <div class="actions"><button class="btn small ghost" id="attExport">⬇ ${esc(t("common.export"))} CSV</button></div></div>
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
      const ae = $("#attExport");
      if (ae) ae.addEventListener("click", () => { location.href = API.url(`/exports/attendance.csv?classId=${state.classId || ""}`); });
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
      <div class="page-head"><h1>${esc(t("fees.title"))}</h1>
        <div class="actions"><button class="btn small ghost" id="feeExport">⬇ ${esc(t("common.export"))} CSV</button></div>
      </div>
      <div class="card">
        <div class="card-title">💰 ${esc(t("fees.items"))}</div>
        <div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>${esc(t("fees.amount"))}</th><th>${esc(t("results.term"))}</th></tr>
          ${items.items.map((i) => `<tr><td><b>${esc(i.name_en)}</b> ${esc(i.name_ar)}</td><td>${Number(i.amount_ngn).toLocaleString()} ₦</td><td>${esc((terms.find((x) => x.id === i.term_id) || {}).name_en || "—")}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">${esc(t("common.noData"))}</td></tr>`}
        </table></div>
        <div class="row-count">Showing ${items.items.length} records</div>
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
        <div class="row-count">Showing ${balances.students.length} records</div>
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
        <div class="row-count">Showing ${Math.min(30,payments.payments.length)} records</div>
      </div>`);
    const fe = $("#feeExport");
    if (fe) fe.addEventListener("click", () => { location.href = API.url("/exports/fees.csv" + (termId ? "?termId=" + termId : "")); });
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
          <div class="card-title">📢 <b>${esc(a.title)}</b> <span class="pill ${a.audience === "all" ? "info" : a.audience === "students" ? "ok" : "gold"}">${esc({ all: t("ann.all"), students: t("ann.students"), parents: t("ann.parents") }[a.audience])}</span>${a.publish_public ? ` <span class="pill ok">🌐 ${esc(t("nav.publicSite"))}</span>` : ""}</div>
          <div class="wrap" style="white-space:pre-wrap">${esc(a.body)}</div>
          <div class="muted small" style="margin-top:8px">${esc(new Date(a.created_at).toLocaleString())}</div>
          ${isAdmin ? `<div class="form-actions"><button class="btn small secondary" data-del="${a.id}">${a.is_active ? esc(t("common.delete")) : "Hide"}</button></div>` : ""}
        </div>`).join("") || `<div class="card">${emptyState("📢","No announcements yet","Announcements from your madrasa will appear here.", isAdmin?`<button class="btn" id="emptyAnnBtn">+ ${esc(t("ann.add"))}</button>`:"")}</div>`}`);
    if (isAdmin) {
      const addHandler = () => {
        openModal(`
          <h2>${esc(t("ann.add"))}</h2>
          <label data-i18n="ann.titlePh">${esc(t("ann.titlePh"))}</label><input id="anTitle">
          <label>${esc(t("ann.bodyPh"))}</label><textarea id="anBody"></textarea>
          <label data-i18n="ann.audience">${esc(t("ann.audience"))}</label>
          <select id="anAud"><option value="all">${esc(t("ann.all"))}</option><option value="students">${esc(t("ann.students"))}</option><option value="parents">${esc(t("ann.parents"))}</option></select>
          <label><input type="checkbox" id="anPub"> ${esc(t("ann.publishPublic"))}</label>
          <label>${esc(t("ann.publishUntil"))}</label><input id="anUntil" type="date">
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
                  publish_public: $("#anPub", modal).checked,
                  publish_until: $("#anUntil", modal).value || null,
                });
                toast("✓", "ok"); closeAllModals(); routeTo("announcements");
              } catch (e) { toast(errMsg(e), "err"); }
            });
          });
      };
      const btn = $("#annAdd"); if(btn) btn.addEventListener("click", addHandler);
      const emptyBtn = $("#emptyAnnBtn"); if(emptyBtn) emptyBtn.addEventListener("click", addHandler);
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
        <div class="card-title">📐 Score Structure</div>
        <p class="muted small" style="margin:0 0 8px">Configure maximum scores and promotion rules for this madrasa.</p>
        <div class="row">
          <div><label data-i18n="grading.caMax">${esc(t("grading.caMax"))}</label><input id="gCa" type="number" value="${d.caMax}"></div>
          <div><label data-i18n="grading.examMax">${esc(t("grading.examMax"))}</label><input id="gEx" type="number" value="${d.examMax}"></div>
          <div><label data-i18n="grading.passMark">${esc(t("grading.passMark"))}</label><input id="gPass" type="number" value="${d.passMark}"></div>
        </div>
        <div style="margin-top:10px"><label style="font-weight:800;color:var(--text)">${esc(t("grading.promotionAvg"))}</label><input id="gProm" type="number" value="${d.promotionMinAverage == null ? "" : d.promotionMinAverage}"></div>
        <label class="checkbox"><input id="gReq" type="checkbox" ${d.promotionRequirePass ? "checked" : ""}> ${esc(t("grading.requirePass"))}</label>
        <div class="form-actions"><button class="btn" id="gSave1">${esc(t("common.save"))}</button></div>
      </div>
      <div class="card">
        <div class="card-title">⚖️ ${esc(t("grading.bands"))}</div>
        <p class="muted small" style="margin:0 0 8px">Grade bands map total percentage to letter grades. Add or edit rows below.</p>
        <div class="tablewrap"><table>
          <tr><th>${esc(t("grading.min"))}</th><th>${esc(t("grading.grade"))}</th><th>${esc(t("grading.remark"))}</th><th>${esc(t("grading.remarkAr"))}</th><th></th></tr>
          <tbody id="bandBody">
          ${d.bands.map((b) => `<tr>
            <td><input type="number" class="bMin" value="${b.min}" style="width:90px"></td>
            <td><input class="bGrade" value="${esc(b.grade)}" style="width:70px"></td>
            <td><input class="bRemark" value="${esc(b.remark)}"></td>
            <td><input class="bRemarkAr" dir="rtl" value="${esc(b.remark_ar)}"></td>
            <td><button class="btn small danger rmBand">✕</button></td>
          </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="form-actions">
          <button class="btn secondary" id="addBand">+ Add Band</button>
          <button class="btn" id="gSave2">${esc(t("common.save"))}</button>
        </div>
        <div class="row-count" id="bandCount">Showing ${d.bands.length} records</div>
      </div>`);
    function collectBands(){
      return $$("#view .bMin").map((el, i) => ({
        min: Number(el.value),
        grade: $$("#view .bGrade")[i].value,
        remark: $$("#view .bRemark")[i].value,
        remark_ar: $$("#view .bRemarkAr")[i].value,
      }));
    }
    async function saveGrading(){
      const bands = collectBands();
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
    }
    $("#gSave1").addEventListener("click", saveGrading);
    $("#gSave2").addEventListener("click", saveGrading);
    $("#addBand").addEventListener("click", ()=>{
      const tbody = $("#bandBody");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><input type="number" class="bMin" value="0" style="width:90px"></td><td><input class="bGrade" value="" style="width:70px"></td><td><input class="bRemark" value=""></td><td><input class="bRemarkAr" dir="rtl" value=""></td><td><button class="btn small danger rmBand">✕</button></td>`;
      tbody.appendChild(tr);
      tr.querySelector(".rmBand").addEventListener("click", ()=>tr.remove());
      const cnt = $("#bandCount"); if(cnt) cnt.textContent = `Showing ${$$("#view .bMin").length} records`;
    });
    $$(".rmBand").forEach(b=>b.addEventListener("click", (e)=>{ e.target.closest("tr").remove(); const cnt=$("#bandCount"); if(cnt) cnt.textContent=`Showing ${$$("#view .bMin").length} records`; }));
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
        <div class="card-title">🏫 School Identity</div>
        <label data-i18n="common.nameEn">${esc(t("common.nameEn"))}</label><input id="mEn" value="${esc(m.name_en)}">
        <label data-i18n="common.nameAr">${esc(t("common.nameAr"))}</label><input id="mAr" dir="rtl" value="${esc(m.name_ar)}">
        <div class="row">
          <div><label data-i18n="settings.mottoEn">${esc(t("settings.mottoEn"))}</label><input id="mMottoEn" value="${esc(m.motto_en)}"></div>
          <div><label data-i18n="settings.mottoAr">${esc(t("settings.mottoAr"))}</label><input id="mMottoAr" dir="rtl" value="${esc(m.motto_ar)}"></div>
        </div>
        <div class="form-actions"><button class="btn" id="saveIdentity">💾 ${esc(t("common.save"))}</button></div>
      </div>
      <div class="card">
        <div class="card-title">📍 Contact & Location</div>
        <label data-i18n="common.address">${esc(t("common.address"))}</label><input id="mAddr" value="${esc(m.address)}">
        <div class="row">
          <div><label data-i18n="settings.city">${esc(t("settings.city"))}</label><input id="mCity" value="${esc(m.city)}"></div>
          <div><label data-i18n="settings.state">${esc(t("settings.state"))}</label><input id="mState" value="${esc(m.state_name)}"></div>
        </div>
        <div class="row">
          <div><label data-i18n="common.phone">${esc(t("common.phone"))}</label><input id="mPhone" value="${esc(m.phone)}"></div>
          <div><label data-i18n="common.email">${esc(t("common.email"))}</label><input id="mEmail" value="${esc(m.email)}"></div>
        </div>
        <div class="form-actions"><button class="btn" id="saveContact">💾 ${esc(t("common.save"))}</button></div>
      </div>
      <div class="card">
        <div class="card-title">🔧 System Settings</div>
        <label data-i18n="settings.logo">${esc(t("settings.logo"))}</label>
        <input id="mLogo" type="file" accept="image/jpeg,image/png,image/webp">
        <div style="margin-top:8px"><img id="logoPreview" src="${esc(m.logo_path||"")}" style="${m.logo_path?"max-width:120px;border-radius:8px;border:1px solid var(--border)":"display:none"}"></div>
        <label data-i18n="settings.admissionPrefix">${esc(t("settings.admissionPrefix"))}</label><input id="mPrefix" value="${esc(d.settings.admission_prefix || "")}">
        <div class="form-actions">
          <button class="btn" id="saveSystem">💾 ${esc(t("common.save"))}</button>
          <button class="btn secondary" id="logoSave">📷 Upload Logo</button>
        </div>
      </div>
      <div class="card" id="pubCard">
        <div class="card-title">🌐 ${esc(t("ps.title"))}</div>
        <div class="muted small">${esc(t("ps.intro"))}</div>
        <label><input type="checkbox" id="pListing"> ${esc(t("ps.directory"))}</label>
        <label><input type="checkbox" id="pResults"> ${esc(t("ps.results"))}</label>
        <label><input type="checkbox" id="pApply"> ${esc(t("ps.admissions"))}</label>
        <div class="row">
          <div><label>${esc(t("ps.founded"))}</label><input id="pFounded" placeholder="2018"></div>
          <div><label>${esc(t("ps.website"))}</label><input id="pWebsite" placeholder="https://…"></div>
        </div>
        <label>${esc(t("ps.description"))} (EN)</label><textarea id="pDescEn" rows="4"></textarea>
        <label>${esc(t("ps.description"))} (ع)</label><textarea id="pDescAr" rows="4" dir="rtl"></textarea>
        <div class="form-actions">
          <button class="btn" id="savePublic">💾 ${esc(t("common.save"))}</button>
          <a class="btn secondary" id="pubPreview" href="#/madrasa/" target="_blank">${esc(t("ps.preview"))}</a>
        </div>
        <div class="muted small" id="pubCounts"></div>
      </div>`);
    // public-site switches (loaded separately so the profile page never blocks)
    API.get("/madrasa/public-site").then((ps) => {
      const st = ps.settings || {};
      $("#pListing").checked = !!st.public_listing;
      $("#pResults").checked = !!st.public_results;
      $("#pApply").checked = !!st.public_admissions;
      $("#pFounded").value = st.founded_year || "";
      $("#pWebsite").value = st.website || "";
      $("#pDescEn").value = st.description_en || "";
      $("#pDescAr").value = st.description_ar || "";
      $("#pubPreview").href = "#" + (ps.urls && ps.urls.directory ? "/madrasa/" + (ps.urls.directory.split("/").pop() || "") : "");
      const c = ps.counts || {};
      $("#pubCounts").textContent = `${c.pendingApplications || 0} ${t("adm.pending")} • ${c.publishedResults || 0} ${t("pub.results.terms")} • ${c.publicNotices || 0} ${t("pub.notices")}`;
    }).catch(() => { $("#pubCard").style.display = "none"; });
    $("#savePublic").addEventListener("click", async () => {
      try {
        await API.put("/madrasa/public-site", {
          public_listing: $("#pListing").checked,
          public_results: $("#pResults").checked,
          public_admissions: $("#pApply").checked,
          founded_year: $("#pFounded").value.trim(),
          website: $("#pWebsite").value.trim(),
          description_en: $("#pDescEn").value.trim(),
          description_ar: $("#pDescAr").value.trim(),
        });
        toast("✓ " + t("ps.saved"), "ok");
      } catch (e) { toast(errMsg(e), "err"); }
    });
    async function saveProfile(){
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
    }
    $("#saveIdentity").addEventListener("click", saveProfile);
    $("#saveContact").addEventListener("click", saveProfile);
    $("#saveSystem").addEventListener("click", saveProfile);
    $("#mLogo").addEventListener("change", (e)=>{
      const f=e.target.files[0];
      if(f){
        const url=URL.createObjectURL(f);
        const img=$("#logoPreview"); img.src=url; img.style.display="block";
      }
    });
    $("#logoSave").addEventListener("click", async () => {
      const f = $("#mLogo").files[0];
      if (!f) { toast("Choose a file first", "warn"); return; }
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
      <div class="greeting-banner">
        <div class="greet">Hello, ${esc(me.user.fullName)} 👋</div>
        <div class="sub">You have ${mine.classes.length} class${mine.classes.length!==1?"es":""} assigned to you</div>
      </div>
      <div class="card">
        <div class="card-title">📚 My Classes</div>
        ${mine.classes.length ? `<div class="class-cards">${mine.classes.map((c) => `<div class="class-card"><div class="cc-name">${esc(c.name_en)}</div><div class="cc-ar muted">${esc(c.name_ar||"")}</div><div class="cc-actions"><a class="btn small ghost" href="#/results">Enter Results →</a><a class="btn small ghost" href="#/attendance">Mark Attendance →</a></div></div>`).join("")}</div>` : `<div class="empty">${emptyState("📚","No classes assigned","Your classes will appear here once assigned by admin.","")}</div>`}
      </div>
      <div class="card">
        <div class="card-title">📢 Recent Announcements</div>
        ${ann.announcements.length ? ann.announcements.slice(0,5).map((a) => `<div class="reportlink"><div style="flex:1"><b>${esc(a.title)}</b><div class="muted small" style="white-space:pre-wrap">${esc((a.body||"").slice(0,120))}</div></div><span class="muted small">${esc(new Date(a.created_at).toLocaleDateString())}</span></div>`).join("") : `<div class="empty">${esc(t("common.noData"))}</div>`}
      </div>`);
  }

  /* ====================================================================== */
  /*  STUDENT PORTAL                                                         */
  /* ====================================================================== */
  async function studentHome() {
    const d = await API.get("/portal/me");
    const s = d.self || (d.children && d.children[0]) || {};
    const isAr = window.I18N.lang === "ar";
    // try to get class name
    const className = s.classEn || s.class_en || s.classAr || s.class_ar || "";
    const classNameAr = s.classAr || s.class_ar || "";
    const displayClass = isAr && classNameAr ? classNameAr : className;
    const displayName = isAr && s.name_ar ? s.name_ar : (s.name || `${s.first_name||""} ${s.last_name||""}`.trim());
    render(`
      <div class="profile-banner">
        ${s.photo_path ? `<img class="pb-photo" src="${esc(s.photo_path)}" alt="">` : `<div class="pb-fallback">🎓</div>`}
        <div style="flex:1;min-width:0">
          <div class="pb-name">${esc(displayName)}</div>
          <div class="pb-meta mono">${esc(s.admission_no || s.admissionNo || "")}</div>
          <div class="pb-meta">${esc(displayClass)}</div>
          <div style="margin-top:6px">${s.status ? pill(s.status) : ""}</div>
        </div>
      </div>
      <div class="quick-grid">
        <a class="quick-card" href="#/results">
          <div class="qc-ico">📝</div><div class="qc-label">${esc(t("portal.myResults"))}</div><div class="qc-arrow">View results →</div>
        </a>
        <a class="quick-card" href="#/announcements">
          <div class="qc-ico">📢</div><div class="qc-label">${esc(t("nav.announcements"))}</div><div class="qc-arrow">Announcements →</div>
        </a>
        <a class="quick-card" href="#/results">
          <div class="qc-ico">🖨</div><div class="qc-label">Report Card</div><div class="qc-arrow">Print →</div>
        </a>
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
        </div>`).join("") || `<div class="card">${emptyState("📝","No results yet","Your term results will appear here once teachers enter scores.","")}</div>`}`);
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
          </table></div>
          <div class="row-count">Showing ${sd.subjects.length} records</div>`;
      } catch (e) { toast(errMsg(e), "err"); }
    }));
  }

  /* ====================================================================== */
  /*  PARENT PORTAL                                                          */
  /* ====================================================================== */
  async function parentHome() {
    const d = await API.get("/portal/me");
    const isAr = window.I18N.lang === "ar";
    if(!d.children || !d.children.length){
      render(`<div class="card">${emptyState("👨‍👩‍👧","No children linked","Your children will appear here once linked by the madrasa.","")}</div>`);
      return;
    }
    // Try to fetch averages for each child if available (use portal results)
    // We will enrich cards with latest term average if possible
    const children = d.children;
    // fetch results for each child in parallel for grade chip
    const infos = await Promise.all(children.map(async c=>{
      try{
        const rd = await API.get("/portal/results?studentId="+c.id);
        const latest = rd.terms && rd.terms[0];
        return { id:c.id, average:latest?latest.average:null, grade:latest?latest.overall_grade:null };
      }catch(e){ return { id:c.id, average:null, grade:null }; }
    }));
    const infoMap = Object.fromEntries(infos.map(x=>[x.id,x]));
    render(`
      <h1>${esc(t("portal.children"))}</h1>
      <div class="child-grid">
      ${children.map((c) => {
        const info = infoMap[c.id]||{};
        const name = isAr && c.name_ar ? c.name_ar : (c.first_name + " " + c.last_name);
        const cls = isAr && c.classAr ? c.classAr : c.classEn;
        return `
        <div class="child-card">
          <div class="cc-top">
            <div>
              <div style="font-weight:800;font-size:1.05rem">${esc(name)}</div>
              <div class="mono muted small">${esc(c.admission_no)} • ${esc(cls||"")}</div>
              ${info.average!=null ? `<div class="small" style="margin-top:6px">Latest avg: <b>${esc(info.average)}%</b></div>` : `<div class="muted small" style="margin-top:6px">No term average yet</div>`}
            </div>
            ${info.grade ? `<span class="grade-chip">${esc(info.grade)}</span>` : ""}
          </div>
          <div style="margin-top:12px"><a class="cc-link" href="#/child/${c.id}">View Full Results →</a></div>
        </div>`;
      }).join("")}
      </div>`);
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
  /*  PUBLIC ROUTES (rendered by public/js/public.js, no login required)     */
  /* ====================================================================== */
  route("", async function () { await window.Public.home(); });
  route("madaris", async function () { await window.Public.directory(); });
  route("madrasa/:slug", async function (params) { await window.Public.madrasaPage(params.slug); });
  route("results-check", async function () { await window.Public.globalResults(window.__query && window.__query.get("madrasa")); });
  route("apply", async function () { await window.Public.globalApply(""); });
  route("apply/:slug", async function (params) { await window.Public.globalApply(params.slug); });

  /* ====================================================================== */
  /*  ADMISSIONS — review queue for applications sent from the public site  */
  /* ====================================================================== */
  route("admissions", async function () {
    if (!["madrasa_admin", "super_admin"].includes(me.role)) { render(`<div class="empty">403</div>`); return; }
    let status = window.__query && window.__query.get("status") ? window.__query.get("status") : "pending";
    let d;
    try { d = await API.get("/admissions?perPage=200" + (status ? "&status=" + status : "")); }
    catch (e) { render(`<div class="empty">${esc(errMsg(e))}</div>`); return; }
    const rows = d.requests || [];
    const chips = [["pending", t("adm.pending")], ["approved", t("adm.approved")], ["on_hold", t("adm.onhold")], ["rejected", t("adm.rejected")], ["", t("common.all")]];
    render(`
      <div class="page-head"><h1>📥 ${esc(t("adm.title"))}</h1>
        <div class="actions"><a class="btn small secondary" href="${esc(API.url("/exports/admissions.csv" + (status ? "?status=" + status : "")))}" download>⬇ ${esc(t("adm.exportCsv"))}</a></div>
      </div>
      <div class="summary-strip">
        ${chips.slice(0, 4).map(([k, lbl]) => `<div class="sum"><b>${Number((d.byStatus || {})[k] || 0)}</b><span>${esc(lbl)}</span></div>`).join("")}
      </div>
      <div class="pub-chips" style="margin-bottom:12px">
        ${chips.map(([k, lbl]) => `<button class="chip ${status === k ? "on" : ""}" data-st="${k}">${esc(lbl)}</button>`).join("")}
      </div>
      ${rows.length ? `<div class="card"><div class="tablewrap"><table>
        <tr><th>${esc(t("pub.apply.reference"))}</th><th>${esc(t("adm.applicant"))}</th><th>${esc(t("pub.apply.class"))}</th><th>${esc(t("adm.contact"))}</th><th>${esc(t("common.status"))}</th><th></th></tr>
        <tbody>${rows.map((r) => `<tr>
          <td><span class="mono"><b>${esc(r.reference)}</b></span><div class="muted small">${esc(new Date(r.created_at).toLocaleDateString())}</div></td>
          <td><b>${esc(r.first_name)} ${esc(r.last_name)}</b>${r.name_ar ? `<div class="muted small" dir="rtl">${esc(r.name_ar)}</div>` : ""}
            <div class="muted small">${esc(r.gender || "")} ${r.date_of_birth ? "• " + esc(String(r.date_of_birth).slice(0, 10)) : ""}</div></td>
          <td>${esc(r.class_name || "—")}${r.quran_level ? `<div class="muted small">${esc(r.quran_level)}</div>` : ""}</td>
          <td>${esc(r.parent_name || "")}<div class="muted small">${esc(r.parent_phone || "")}</div></td>
          <td>${r.status === "approved" ? pill("promoted") : r.status === "rejected" ? pill("withdrawn") : pill("pending")}</td>
          <td><button class="btn small secondary" data-open="${r.id}">${esc(t("common.edit"))}</button></td>
        </tr>`).join("")}</tbody></table></div>
        <div class="row-count">${rows.length} ${esc(t("nav.admissions")).toLowerCase()}</div></div>`
      : `<div class="card">${emptyState("📥", t("adm.empty"), "")}</div>`}`);
    $$("#view .chip").forEach((b) => b.addEventListener("click", () => {
      const want = b.dataset.st === (window.__query && window.__query.get("status")) ? "" : b.dataset.st;
      routeTo("admissions" + (want ? "?status=" + want : ""));
    }));
    $$("#view [data-open]").forEach((b) => b.addEventListener("click", () => admissionDetail(Number(b.dataset.open))));
  });

  async function admissionDetail(id) {
    let d;
    try { d = await API.get("/admissions/" + id); } catch (e) { toast(errMsg(e), "err"); return; }
    const r = d.request;
    const classes = await API.get("/classes").catch(() => ({ classes: [] }));
    const f = (lbl, val) => val ? `<div class="ad-field"><span>${esc(lbl)}</span><b>${esc(val)}</b></div>` : "";
    openModal(`
      <h2>${esc(t("adm.title"))} — <span class="mono">${esc(r.reference)}</span></h2>
      <div class="ad-grid">
        ${f(t("adm.applicant"), `${r.first_name} ${r.last_name}`.trim() + (r.name_ar ? " • " + r.name_ar : ""))}
        ${f(t("pub.apply.gender"), r.gender === "M" ? t("pub.apply.male") : r.gender === "F" ? t("pub.apply.female") : "")}
        ${f(t("pub.apply.dob"), r.date_of_birth ? String(r.date_of_birth).slice(0, 10) : "")}
        ${f(t("pub.apply.class"), (d.class || {}).name_en || "")}
        ${f(t("pub.apply.previous"), r.previous_school)}
        ${f(t("pub.apply.level"), r.quran_level)}
        ${f(t("pub.apply.parentName"), r.parent_name)}
        ${f(t("pub.apply.parentPhone"), r.parent_phone)}
        ${f(t("pub.apply.parentEmail"), r.parent_email)}
        ${f(t("pub.apply.address"), r.address)}
        ${f(t("pub.apply.message"), r.message)}
        ${f(t("adm.admissionNo"), r.admission_no_assigned)}
      </div>
      ${r.review_note ? `<div class="msg warn">${esc(r.review_note)}</div>` : ""}
      ${r.status === "approved" && d.student ? `<div class="msg ok">✓ ${esc(d.student.admission_no)} — ${esc(d.student.first_name)} ${esc(d.student.last_name)}</div>` : ""}
      ${r.status === "approved" ? "" : `
      <hr class="divider">
      <label>${esc(t("adm.assignClass"))}</label>
      <select id="adClass">${(classes.classes || []).map((c) => `<option value="${c.id}" ${Number(c.id) === Number(r.class_id) ? "selected" : ""}>${esc(c.name_en)}</option>`).join("")}</select>
      <label>${esc(t("adm.admissionNo"))}</label><input id="adNo" placeholder="auto">
      <label><input type="checkbox" id="adAccounts"> ${esc(t("adm.makeAccounts"))}</label>
      <div id="adAcc" style="display:none">
        <div class="row">
          <div><label><input type="checkbox" id="adStudent" checked> ${esc(t("adm.studentAccount"))}</label></div>
          <div><label><input type="checkbox" id="adParent"> ${esc(t("adm.parentAccount"))}</label></div>
        </div>
        <label>${esc(t("adm.sharedPassword"))}</label><input id="adPass" type="password">
      </div>
      <label>${esc(t("adm.note"))}</label><input id="adNote" placeholder="${esc(t("adm.note"))}">
      <div class="form-actions">
        <button class="btn" id="adApprove">✓ ${esc(t("adm.approve"))}</button>
        <button class="btn secondary" id="adHold">⏸ ${esc(t("adm.hold"))}</button>
        <button class="btn danger" id="adReject">✕ ${esc(t("adm.reject"))}</button>
      </div>`}`,
      async (modal) => {
        const acc = $("#adAccounts", modal);
        if (acc) acc.addEventListener("change", () => { $("#adAcc", modal).style.display = acc.checked ? "" : "none"; });
        const doApprove = async () => {
          try {
            const res = await API.post(`/admissions/${id}/approve`, {
              class_id: Number($("#adClass", modal).value) || null,
              admission_no: $("#adNo", modal).value.trim(),
              note: $("#adNote", modal).value.trim(),
              create_student_account: $("#adStudent", modal).checked,
              create_parent_account: $("#adParent", modal).checked,
              password: $("#adPass", modal).value,
            });
            toast(`${t("adm.admitted")} — ${res.admissionNo}`, "ok");
            closeAllModals(); routeTo("admissions");
          } catch (e) { toast(errMsg(e), "err"); }
        };
        const ap = $("#adApprove", modal); if (ap) ap.addEventListener("click", doApprove);
        const rej = $("#adReject", modal);
        if (rej) rej.addEventListener("click", async () => {
          try { await API.post(`/admissions/${id}/reject`, { note: $("#adNote", modal).value.trim() }); toast("✓", "ok"); closeAllModals(); routeTo("admissions"); }
          catch (e) { toast(errMsg(e), "err"); }
        });
        const hold = $("#adHold", modal);
        if (hold) hold.addEventListener("click", async () => {
          try { await API.post(`/admissions/${id}/hold`, { note: $("#adNote", modal).value.trim() }); toast("✓", "ok"); closeAllModals(); routeTo("admissions"); }
          catch (e) { toast(errMsg(e), "err"); }
        });
      });
  }

  /* ====================================================================== */
  /*  TIMETABLE — weekly grid per class; read-only for families & teachers  */
  /* ====================================================================== */
  route("timetable", async function () {
    if (["student", "parent"].includes(me.role)) return myTimetable();
    let classes = [], subjects = [], teachers = [], grid = null, classId = 0, termId = 0;
    try {
      const [cl, su, th] = await Promise.all([
        API.get("/classes"),
        API.get("/subjects").catch(() => ({ subjects: [] })),
        API.get("/teachers").catch(() => ({ teachers: [] })),
      ]);
      classes = cl.classes || []; subjects = su.subjects || []; teachers = th.teachers || [];
      classId = Number(window.__query && window.__query.get("classId")) || (classes[0] ? classes[0].id : 0);
      if (classId) {
        const g = await API.get(`/timetable?classId=${classId}`);
        grid = g; termId = g.termId;
      }
    } catch (e) { render(`<div class="empty">${esc(errMsg(e))}</div>`); return; }
    const canEdit = me.role === "madrasa_admin" || me.role === "super_admin";
    const days = (grid && grid.days) || ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const periods = (grid && grid.periods) || [];
    const slots = (grid && grid.slots) || [];
    const at = (day, period) => slots.find((x) => x.day === day && x.period === Number(period));
    const cellSelects = (cur, day, period) => {
      if (!canEdit) {
        if (!cur) return `<span class="muted">—</span>`;
        return `<b>${esc(cur.subjectEn || "")}</b>${cur.teacherName ? `<div class="muted small">${esc(cur.teacherName)}</div>` : ""}${cur.room ? `<div class="muted small">${esc(cur.room)}</div>` : ""}`;
      }
      return `
        <select data-f="subject" data-day="${day}" data-p="${period}">
          <option value="">${esc(t("tt.none"))}</option>
          ${subjects.map((s) => `<option value="${s.id}" ${Number(cur && cur.subjectId) === Number(s.id) ? "selected" : ""}>${esc(s.name_en)}${s.name_ar ? " • " + esc(s.name_ar) : ""}</option>`).join("")}
        </select>
        <select data-f="teacher" data-day="${day}" data-p="${period}">
          <option value="">${esc(t("tt.teacher"))}</option>
          ${teachers.map((x) => `<option value="${x.id}" ${Number(cur && cur.teacherId) === Number(x.id) ? "selected" : ""}>${esc(x.full_name || x.username)}</option>`).join("")}
        </select>
        <input data-f="room" data-day="${day}" data-p="${period}" value="${esc((cur && cur.room) || "")}" placeholder="${esc(t("tt.room"))}">`;
    };
    render(`
      <div class="page-head"><h1>🗓 ${esc(t("tt.title"))}</h1>
        <div class="actions">
          <select id="ttClass">${classes.map((c) => `<option value="${c.id}" ${Number(c.id) === Number(classId) ? "selected" : ""}>${esc(c.name_en)}</option>`).join("")}</select>
          <a class="btn small secondary" id="ttPrint" target="_blank" href="${esc(API.url("/timetable/print?classId=" + classId))}">🖨 ${esc(t("tt.print"))}</a>
          ${canEdit ? `<button class="btn small ghost" id="ttCopy">⧉ ${esc(t("tt.copy"))}</button><button class="btn small" id="ttSave">💾 ${esc(t("tt.save"))}</button>` : ""}
        </div>
      </div>
      ${classId ? `<div class="card tt-card"><div class="tablewrap"><table class="tt-grid">
        <thead><tr><th class="tt-day"></th>${periods.map((p) => `<th>${esc(t("tt.period"))} ${p.period}<div class="muted small">${esc(p.start || "")}${p.end ? "–" + esc(p.end) : ""}</div></th>`).join("")}</tr></thead>
        <tbody>${days.map((day) => `<tr><th class="tt-day">${esc(day)}<div class="muted small" dir="rtl">${esc((grid && grid.dayLabelsAr || {})[day] || "")}</div></th>
          ${periods.map((p) => `<td>${cellSelects(at(day, p.period), day, p.period)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div></div>` : `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
    const cls = $("#ttClass");
    if (cls) cls.addEventListener("change", () => routeTo("timetable?classId=" + cls.value));
    if (!canEdit || !classId) return;
    $("#ttSave").addEventListener("click", async () => {
      const map = {};
      $$("#view [data-f]").forEach((el) => {
        const k = el.dataset.day + ":" + el.dataset.p;
        map[k] = map[k] || { day: el.dataset.day, period: Number(el.dataset.p) };
        const v = (el.value || "").trim();
        if (!v) return;
        if (el.dataset.f === "subject") map[k].subjectId = Number(v);
        if (el.dataset.f === "teacher") map[k].teacherId = Number(v);
        if (el.dataset.f === "room") map[k].room = v;
      });
      const slotsOut = Object.values(map).filter((s) => s.subjectId || s.teacherId || s.room);
      try {
        await API.put("/timetable", { classId, termId, slots: slotsOut });
        toast("✓ " + t("tt.saved"), "ok");
        routeTo("timetable?classId=" + classId);
      } catch (e) { toast(errMsg(e), "err"); }
    });
    $("#ttCopy").addEventListener("click", () => {
      const others = classes.filter((c) => Number(c.id) !== Number(classId));
      openModal(`
        <h2>${esc(t("tt.copy"))}</h2>
        ${others.map((c) => `<label><input type="checkbox" value="${c.id}" data-copy> ${esc(c.name_en)}</label>`).join("") || `<div class="muted small">${esc(t("common.noData"))}</div>`}
        <div class="form-actions"><button class="btn" id="cpGo">${esc(t("common.create"))}</button><button class="btn secondary" data-close>${esc(t("common.cancel"))}</button></div>`,
        async (modal) => {
          $$("[data-close]", modal).forEach((b) => b.addEventListener("click", closeAllModals));
          $("#cpGo", modal).addEventListener("click", async () => {
            const ids = $$("[data-copy]", modal).filter((x) => x.checked).map((x) => Number(x.value));
            try {
              const r = await API.post("/timetable/copy", { fromClassId: classId, toClassIds: ids });
              const skipped = (r.rejected && r.rejected.length) ? ` · ${r.rejected.length} ✕` : "";
              toast(`✓ ${r.inserted} → ${r.copiedTo}${skipped}`, "ok"); closeAllModals();
            } catch (e) { toast(errMsg(e), "err"); }
          });
        });
    });
  });

  async function myTimetable() {
    const d = await API.get("/timetable/me").catch((e) => { render(`<div class="empty">${esc(errMsg(e))}</div>`); return null; });
    if (!d) return;
    const days = d.days || ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const week = (slots, periods) => {
      if (!periods) {
        // teacher view: a simple day-grouped list
        return `<div class="card">${days.map((day) => {
          const rows = (slots || []).filter((s) => s.day === day);
          if (!rows.length) return "";
          return `<div class="card-title">${esc(day)}</div><div class="tt-list">${rows.map((s) => `<div class="tt-row"><span class="mono small">${esc(s.startTime || "")}${s.endTime ? "–" + esc(s.endTime) : ""}</span><b>${esc(s.subjectEn || "—")}</b><span class="muted small">${esc(s.className || "")}</span><span class="muted small">${esc(s.room || "")}</span></div>`).join("")}</div>`;
        }).join("") || `<div class="empty">${esc(t("common.noData"))}</div>`}</div>`;
      }
      return (periods || []).length ? `<div class="card"><div class="tablewrap"><table class="tt-grid">
        <thead><tr><th class="tt-day"></th>${periods.map((p) => `<th>${esc(t("tt.period"))} ${p.period}<div class="muted small">${esc(p.start || "")}</div></th>`).join("")}</tr></thead>
        <tbody>${days.map((day) => `<tr><th class="tt-day">${esc(day)}</th>${periods.map((p) => {
          const s = (slots || []).find((x) => x.day === day && Number(x.period) === Number(p.period));
          return `<td>${s ? `<b>${esc(s.subjectEn || "")}</b>${s.teacherName ? `<div class="muted small">${esc(s.teacherName)}</div>` : ""}${s.room ? `<div class="muted small">${esc(s.room)}</div>` : ""}` : `<span class="muted">—</span>`}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div></div>` : `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`;
    };
    if (d.kind === "teacher") { render(`<h1>🗓 ${esc(t("tt.title"))}</h1>${week(d.slots, null)}`); return; }
    const students = d.students || [];
    render(`<h1>🗓 ${esc(t("tt.title"))}</h1>
      ${students.map((s) => `<div class="card"><div class="card-title">🎓 ${esc(s.name)}${s.class ? " — " + esc(s.class.name_en || "") : ""}</div>${s.slots && s.slots.length ? week(s.slots, s.periods) : `<div class="empty">${esc(t("common.noData"))}</div>`}</div>`).join("") || `<div class="card"><div class="empty">${esc(t("common.noData"))}</div></div>`}`);
  }

  /* ====================================================================== */
  /*  SUPER ADMIN — public site settings + backups & storage                */
  /* ====================================================================== */
/** "1"/"true"/true/1 all mean on; the API may answer with either. */
function isOn(v) { return v === undefined || v === true || v === 1 || v === "1" || v === "true"; }

  route("platform/settings", SA(async function () {
    const d = await API.get("/platform/settings").catch(() => ({ settings: {} }));
    const st = d.settings || {};
    const val = (k, def) => esc(st[k] === undefined ? def : st[k]);
    render(`
      <h1>🌐 ${esc(t("ps.title"))}</h1>
      <div class="card">
        <div class="card-title">${esc(t("ps.intro"))}</div>
        <label>${esc(t("public.siteTitle"))}</label><input id="psTitle" value="${val("public_site_title", "Bello Institute")}">
        <label>${esc(t("public.tagline"))}</label><input id="psTagline" value="${val("public_site_tagline", "")}">
        <label>${esc(t("public.intro"))}</label><textarea id="psIntro" rows="3">${val("public_site_intro", "")}</textarea>
        <div class="row">
          <div><label>${esc(t("common.phone"))}</label><input id="psPhone" value="${val("public_contact_phone", "")}"></div>
          <div><label>${esc(t("common.email"))}</label><input id="psEmail" value="${val("public_contact_email", "")}"></div>
        </div>
        <label><input type="checkbox" id="psDirectory" ${isOn(st.public_directory_enabled) ? "checked" : ""}> ${esc(t("public.directory"))}</label>
        <div class="form-actions"><button class="btn" id="psSave">💾 ${esc(t("common.save"))}</button>
          <a class="btn secondary" href="#/madaris" target="_self">${esc(t("ps.preview"))}</a></div>
      </div>`);
    $("#psSave").addEventListener("click", async () => {
      try {
        await API.put("/platform/settings", {
          public_site_title: $("#psTitle").value.trim(),
          public_site_tagline: $("#psTagline").value.trim(),
          public_site_intro: $("#psIntro").value.trim(),
          public_contact_phone: $("#psPhone").value.trim(),
          public_contact_email: $("#psEmail").value.trim(),
          public_directory_enabled: $("#psDirectory").checked ? "1" : "0",
        });
        toast("✓ " + t("ps.saved"), "ok");
      } catch (e) { toast(errMsg(e), "err"); }
    });
  }));

  route("platform/backups", SA(async function () {
    const [diag, list] = await Promise.all([
      API.get("/platform/backups/diagnostics").catch(() => null),
      API.get("/platform/backups").catch(() => ({ backups: [] })),
    ]);
    const p = (diag && diag.persistence) || {};
    const tone = p.level === "critical" ? "err" : p.level === "warn" ? "warn" : "ok";
    const rows = list.backups || [];
    render(`
      <div class="page-head"><h1>🛟 ${esc(t("bk.title"))}</h1>
        <div class="actions"><button class="btn" id="bkNow">💾 ${esc(t("bk.createNow"))}</button>
          <label class="btn small secondary" style="display:inline-flex;align-items:center;gap:6px">⬆ ${esc(t("bk.importFile"))}<input type="file" id="bkFile" accept="application/json,.json" style="display:none"></label></div>
      </div>
      <div class="card storage-card ${tone}">
        <div class="card-title">${esc(t("storage.title"))}</div>
        <div class="ad-grid">
          <div class="ad-field"><span>Driver</span><b>${esc(p.driver || "—")}${p.externalDatabase ? " (external)" : ""}</b></div>
          <div class="ad-field"><span>Data dir</span><b class="mono small">${esc((p.dataDir || {}).dir || "—")}</b></div>
          <div class="ad-field"><span>Mount</span><b class="mono small">${esc((p.dataDir || {}).mountPoint || "/")} · ${esc((p.dataDir || {}).fsType || "?")}</b></div>
          <div class="ad-field"><span>Boots seen</span><b>${esc(diag && diag.bootCount != null ? diag.bootCount : "—")}</b></div>
          <div class="ad-field"><span>Host</span><b class="mono small">${esc(diag && diag.host || "—")}</b></div>
          <div class="ad-field"><span>${esc(t("storage.rows"))}</span><b>${Object.entries(p.counts || {}).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(", ") || "—"}</b></div>
        </div>
        ${(p.warnings || []).length ? `<div class="msg ${tone}" style="margin-top:10px">${(p.warnings || []).map((w) => `<div class="small">• ${esc(w.message)}</div>`).join("")}</div>` : `<div class="msg ok" style="margin-top:10px">${esc(t("storage.ok"))}</div>`}
      </div>
      <div class="card">
        <div class="card-title">${esc(t("bk.snapshot"))} <span class="muted small mono">${esc(list.directory || "")}</span></div>
        <div class="muted small">${esc(t("bk.interval"))} <b>${esc(list.intervalMinutes || 0)}</b> ${esc(t("bk.minutes"))} · ${esc(t("bk.last"))}: ${rows.length ? esc(new Date(rows[0].createdAt).toLocaleString()) : esc(t("bk.never"))}</div>
        ${rows.length ? `<div class="tablewrap"><table>
          <tr><th>${esc(t("common.name"))}</th><th>Size</th><th>${esc(t("storage.rows"))}</th><th></th></tr>
          ${rows.map((b) => `<tr>
            <td><span class="mono small">${esc(b.name)}</span><div class="muted small">${esc(new Date(b.createdAt).toLocaleString())}</div></td>
            <td>${(b.bytes / 1024).toFixed(1)} KB</td>
            <td class="small">${b.counts ? ["madaris", "users", "students"].map((k) => `${k} ${esc(b.counts[k] || 0)}`).join(" · ") : "—"}</td>
            <td class="bk-actions">
              <a class="btn small secondary" href="${esc(API.url("/platform/backups/" + encodeURIComponent(b.name) + "/download"))}" download>${esc(t("bk.download"))}</a>
              <button class="btn small danger" data-restore="${esc(b.name)}">${esc(t("bk.restore"))}</button>
            </td></tr>`).join("")}
        </table></div>` : `<div class="empty">${esc(t("bk.empty"))}</div>`}
      </div>`);
    $("#bkNow").addEventListener("click", async () => {
      try { const r = await API.post("/platform/backups", {}); toast(`✓ ${t("bk.countCreated")} (${(r.bytes / 1024).toFixed(1)} KB)`, "ok"); routeTo("platform/backups"); }
      catch (e) { toast(errMsg(e), "err"); }
    });
    $("#bkFile").addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      if (!confirm(t("bk.confirmRestore"))) return;
      const fd = new FormData(); fd.append("file", file); fd.append("confirm", "true");
      try {
        const r = await fetch(API.url("/platform/backups/import"), { method: "POST", body: fd, credentials: "same-origin" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Import failed");
        toast("✓ " + t("bk.restored"), "ok");
        setTimeout(() => location.reload(), 900);
      } catch (e) { toast(errMsg(e), "err"); }
    });
    $$("#view [data-restore]").forEach((b) => b.addEventListener("click", async () => {
      const name = b.dataset.restore;
      try {
        const plan = await API.get("/platform/backups/" + encodeURIComponent(name) + "/plan");
        const c = plan.snapshot.counts || {};
        if (!confirm(`${t("bk.confirmRestore")}\n\n${t("storage.rows")}: madaris ${c.madaris || 0}, users ${c.users || 0}, students ${c.students || 0}`)) return;
        await API.post("/platform/backups/restore", { name, confirm: true });
        toast("✓ " + t("bk.restored"), "ok");
        setTimeout(() => location.reload(), 900);
      } catch (e) { toast(errMsg(e), "err"); }
    }));
  }));

  /* ====================================================================== */
  /*  BOOT                                                                   */
  /* ====================================================================== */
  (async function boot() {
    try {
      me = await refreshMe();
      if (me && me.loggedIn) {
        await loadMadrasaMeta();
        // A signed-in user with no explicit route lands on their own dashboard;
        // an explicit public hash (e.g. previewing the public page) is respected.
        if (!location.hash || location.hash === "#") location.hash = ROLE_HOME[me.role] || "#/";
        else routeTo(location.hash.replace(/^#\/?/, ""));
      } else {
        // Logged-out visitors get the PUBLIC site, not a bare login wall.
        // #/login is still reachable from the header.
        if (!location.hash || location.hash === "#") routeTo("");
        else routeTo(location.hash.replace(/^#\/?/, ""));
      }
    } catch (err) {
      // Never strand a visitor on the boot spinner: if /auth/me itself fails
      // (API restarting, DB hiccup, etc.) fall back to the public login page,
      // which surfaces real errors once they try to sign in.
      console.error("Boot failed:", err);
      me = null;
      if (!location.hash || location.hash === "#") routeTo("");
      else routeTo(location.hash.replace(/^#\/?/, ""));
    }
  })();
})();
