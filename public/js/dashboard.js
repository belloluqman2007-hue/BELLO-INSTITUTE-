"use strict";
/* ============================================================================
   BELLO — Institution Admin Dashboard (Islamic & Western)
   ----------------------------------------------------------------------------
   Mounted at #/app/... . Completely separate from the public BELLO site
   (public/js/app.js) — different container, different stylesheet
   (dashboard.css), different router. Two admin experiences share this one
   engine; every visual and copy difference is driven by `state.category`
   ('islamic' | 'western'), resolved once from /api/auth/me after login and
   NEVER trusted from the client for any data access (the backend enforces
   tenant isolation independently — this file only decides what to render).
   ========================================================================== */
(function () {
  const ROOT_ID = "dash-app";

  /* --------------------------------------------------------------------
     Icons (inline SVG, no external assets — CSP has no external script/img
     sources anyway).
     -------------------------------------------------------------------- */
  const I = {
    dashboard: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
    building: `<svg viewBox="0 0 24 24"><path d="M4 21V5l8-2v18M20 21V9l-8-2M8 7h1M8 11h1M8 15h1M14 11h1M18 11h1M14 15h1M18 15h1M2 21h20"/></svg>`,
    users: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.1A4.9 4.9 0 0 1 8.4 13h1.2a4.9 4.9 0 0 1 4.9 4.9V20M16 5.5a3 3 0 0 1 0 5.8M18.3 13.4a4.7 4.7 0 0 1 2.2 4V20"/></svg>`,
    teacher: `<svg viewBox="0 0 24 24"><path d="M4 5h12v10H4zM8 19h4M10 15v4M19 8v7M17 15h4"/><circle cx="19" cy="5" r="2"/></svg>`,
    classes: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M8 4v14"/></svg>`,
    book: `<svg viewBox="0 0 24 24"><path d="M4 5.7A3.7 3.7 0 0 1 7.7 2H12v18H7.7A3.7 3.7 0 0 0 4 23V5.7ZM20 5.7A3.7 3.7 0 0 0 16.3 2H12v18h4.3A3.7 3.7 0 0 1 20 23V5.7Z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>`,
    academic: `<svg viewBox="0 0 24 24"><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.3v4.4c2.6 2.2 7.4 2.2 10 0v-4.4M21 9v5"/></svg>`,
    admissions: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>`,
    chat: `<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    money: `<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 6v0M18 18v0"/></svg>`,
    globe: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.4 3.7 5.4 3.7 9s-1.3 6.6-3.7 9c-2.4-2.4-3.7-5.4-3.7-9S9.6 5.4 12 3Z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    chev: `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`,
    menu: `<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    logout: `<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19.5 6.5"/></svg>`,
    clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    bell: `<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
    external: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    edit: `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    image: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    mail: `<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3 19 6v5.4c0 4.2-2.8 7.8-7 9.6-4.2-1.8-7-5.4-7-9.6V6l7-3Z"/></svg>`,
    search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    trash: `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7"/></svg>`,
    activity: `<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>`,
    file: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    download: `<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg>`,
  };

  /* --------------------------------------------------------------------
     Sidebar structure. Exactly the sections/items the spec lists. Labels
     that differ by category are resolved via T() at render time.
     -------------------------------------------------------------------- */
  /* --------------------------------------------------------------------
     Category configuration
     --------------------------------------------------------------------
     The authoritative values are served by server/services/institution.js in
     /app-config.js. This tiny fallback keeps the dashboard usable if that
     bootstrap script is unavailable during local static previews.
     -------------------------------------------------------------------- */
  const fallbackCategoryConfig = {
    islamic: {
      categoryLabel: "Islamic School", institutionLabel: "Institution", institutionNoun: "institution",
      myInstitutionLabel: "My Institution", feesLabel: "School Fees", subjectsLabel: "Islamic Subjects",
      aboutLabel: "About Institution", programsLabel: "Programs/Courses", settingsLabel: "Institution Settings",
      websiteCardTitle: "Your Institution Website", adminLabel: "Islamic School Admin", primaryColor: "#200A3D",
      hifzEnabledByDefault: true,
      subjectCatalogue: ["Qur'an", "Qur'an Memorization", "Tajweed", "Hadith", "Fiqh", "Tawheed", "Aqeedah", "Seerah", "Arabic", "Nahw", "Sarf", "Islamic Studies", "Imla'", "Arabic Reading", "Arabic Expression", "Other Subjects"],
    },
    western: {
      categoryLabel: "Western Academy", institutionLabel: "Academy", institutionNoun: "academy",
      myInstitutionLabel: "My Academy", feesLabel: "Academy Fees", subjectsLabel: "Academic Programs",
      aboutLabel: "About Academy", programsLabel: "Programs", settingsLabel: "Academy Settings",
      websiteCardTitle: "Your Academy Website", adminLabel: "Western Academy Admin", primaryColor: "#0A2342",
      hifzEnabledByDefault: false,
      subjectCatalogue: ["Mathematics", "English", "Sciences", "Computer Science", "Technology", "Business", "Arts", "Social Sciences", "Languages", "Other Subjects"],
    },
  };
  const categoryConfig = (window.__APP_CONFIG__ && window.__APP_CONFIG__.categoryConfig) || fallbackCategoryConfig;

  function category() {
    return categoryConfig[state.category] || fallbackCategoryConfig[state.category] || fallbackCategoryConfig.islamic;
  }

  function sidebarSchema() {
    const t = category();
    const subjectItems = (t.subjectCatalogue || []).map((subject) => [subject, `subjects/${subject}`]);
    const schema = [
      { key: "dashboard", label: "Dashboard", icon: "dashboard", route: "dashboard" },
      {
        key: "institution", label: t.myInstitutionLabel, icon: "building",
        items: [
          [`${t.institutionLabel} Profile`, "institution/profile"],
          [`${t.institutionLabel} Information`, "institution/information"],
          ["Public Website", "institution/website"],
          ["Website Appearance", "institution/appearance"],
          ["Website Pages", "institution/pages"],
          ["Gallery", "institution/gallery"],
          ["Contact Information", "institution/contact"],
          [t.settingsLabel, "institution/settings"],
        ],
      },
      {
        key: "students", label: "Students", icon: "users",
        items: [["All Students", "students/all"], ["Add Student", "students/add"], ["Student Applications", "students/applications"], ["Student Groups", "students/groups"], ["Student Profiles", "students/profiles"]],
      },
      {
        key: "teachers", label: "Teachers", icon: "teacher",
        items: [["All Teachers", "teachers/all"], ["Add Teacher", "teachers/add"], ["Teacher Applications", "teachers/applications"], ["Teacher Profiles", "teachers/profiles"]],
      },
      {
        key: "classes", label: "Classes", icon: "classes",
        items: [["All Classes", "classes/all"], ["Add Class", "classes/add"], ["Class Timetable", "classes/timetable"], ["Class Students", "classes/students"], ["Class Teachers", "classes/teachers"]],
      },
      { key: "subjects", label: t.subjectsLabel, icon: "book", items: subjectItems },
      {
        key: "attendance", label: "Attendance", icon: "calendar",
        items: [["Student Attendance", "attendance/students"], ["Teacher Attendance", "attendance/teachers"], ["Attendance Reports", "attendance/reports"]],
      },
      {
        key: "academic", label: "Academic", icon: "academic",
        items: [["Lessons", "academic/lessons"], ["Assignments", "academic/assignments"], ["Examinations", "academic/examinations"], ["Results", "academic/results"], ["Report Cards", "academic/report-cards"], ["Academic Sessions", "academic/sessions"], ["Terms", "academic/terms"]],
      },
      {
        key: "admissions", label: "Admissions", icon: "admissions",
        items: [["Applications", "admissions/applications"], ["Admission Status", "admissions/status"], ["Admission Requirements", "admissions/requirements"], ["Admission Settings", "admissions/settings"]],
      },
      {
        key: "communication", label: "Communication", icon: "chat",
        items: [["Announcements", "communication/announcements"], ["Messages", "communication/messages"], ["Notifications", "communication/notifications"], ["Parent Communication", "communication/parents"]],
      },
      {
        key: "finance", label: "Finance", icon: "money",
        items: [[t.feesLabel, "finance/fees"], ["Payments", "finance/payments"], ["Outstanding Fees", "finance/outstanding"], ["Fee Records", "finance/records"], ["Financial Reports", "finance/reports"]],
      },
      {
        key: "settings", label: "Settings", icon: "settings",
        items: [[t.settingsLabel, "settings/institution"], ["Administrator Account", "settings/account"], ["Staff Accounts", "settings/staff"], ["Roles & Permissions", "settings/roles"], ["Password & Security", "settings/security"], ["Notifications", "settings/notifications"]],
      },
    ];

    // This module is part of the Islamic product, but is never included in
    // the Western schema. The Hifz settings screen lets an Islamic school opt
    // out without affecting the shared academic engine.
    if (t.hifzEnabledByDefault) {
      schema.splice(7, 0, {
        key: "quran", label: "Qur'an / Islamic Education", icon: "book",
        items: [["Qur'an Progress", "quran/progress"], ["Memorization", "quran/memorization"], ["Revision", "quran/revision"], ["Tajweed", "quran/tajweed"], ["Islamic Academic Reports", "quran/reports"]],
      });
    }
    return schema;
  }

  /* --------------------------------------------------------------------
     Super Admin sidebar — the platform operator's whole menu. Completely
     separate from the institution admin schema: no tenant modules, only the
     platform-level routes that server/routes/platform.js + backups expose.
     -------------------------------------------------------------------- */
  function superAdminSchema() {
    return [
      { key: "platform", label: "Overview", icon: "dashboard", route: "platform" },
      { key: "madaris", label: "Madrasas & Academies", icon: "building", route: "platform/madaris" },
      { key: "registrations", label: "Registrations", icon: "admissions", route: "platform/registrations" },
      { key: "plans", label: "Subscription Plans", icon: "money", route: "platform/plans" },
      { key: "analytics", label: "Platform Analytics", icon: "chart", route: "platform/analytics" },
      { key: "activity", label: "Activity Log", icon: "activity", route: "platform/activity" },
      { key: "backups", label: "Backups & Storage", icon: "file", route: "platform/backups" },
      { key: "settings", label: "Platform Settings", icon: "settings", route: "platform/settings" },
    ];
  }

  /* --------------------------------------------------------------------
     App state
     -------------------------------------------------------------------- */
  const state = {
    booted: false,
    me: null,           // { role, madrasaId, category, institutionName, ... }
    superAdmin: false,  // true when /api/auth/me reports role === "super_admin"
    category: "islamic",
    route: "dashboard",
    sidebarOpen: false,
    openGroups: new Set(),
    regStatusFilter: "", // Platform -> Registrations status filter (survives re-render)
    profile: null,       // /api/madrasa/profile cache
    dashboardData: null, // /api/madrasa/dashboard cache
    cache: {},           // generic per-route data cache
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(v) {
    if (!v) return "—";
    try { return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return String(v); }
  }
  function fmtMoney(n) {
    const v = Number(n || 0);
    return "₦" + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
  }

  /** Backward-compatible shorthand for the central category configuration. */
  function T() {
    const config = category();
    return Object.assign({}, config, {
      instNoun: config.institutionNoun,
      addBtnHint: config.institutionNoun,
    });
  }

  /* --------------------------------------------------------------------
     Tiny router: hash-based, scoped under #/app/...
     -------------------------------------------------------------------- */
  function currentRoute() {
    const h = window.location.hash || "";
    const m = h.match(/^#\/app\/(.*)$/);
    return m ? decodeURIComponent(m[1]) : "dashboard";
  }
  function go(route) {
    window.location.hash = "#/app/" + encodeURIComponent(route);
  }

  /* --------------------------------------------------------------------
     Toasts
     -------------------------------------------------------------------- */
  function toast(msg, kind) {
    let wrap = document.querySelector(".dash-toasts");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "dash-toasts";
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = "dash-toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* --------------------------------------------------------------------
     Boot
     -------------------------------------------------------------------- */
  /** True when the visitor explicitly asked for the SIGN-IN page — either
      the classic hash route (/#/login) or the real /login address. This is
      the password gate: a live session never bypasses it. */
  function isLoginPage() {
    const hash = window.location.hash || "";
    if (hash.startsWith("#/app")) return false;
    if (hash === "#/login" || hash.startsWith("#/login/")) return true;
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    return path === "/login" || path === "/admin/login";
  }

  function resetSessionState() {
    state.me = null;
    state.superAdmin = false;
    state.profile = null;
    state.dashboardData = null;
    state.cache = {};
  }

  /** Roles this console is built for. Every other (valid!) account — teacher,
      student, parent — authenticates successfully but has no admin dashboard
      to enter, and MUST be told so instead of being dropped back on an empty
      form ("I sign in and nothing happens"). */
  const ADMIN_ROLES = ["madrasa_admin", "super_admin"];
  const ROLE_LABELS = {
    teacher: "teacher",
    student: "student",
    parent: "parent",
  };

  /** Why a correct username/password still cannot open this console. */
  function nonAdminMessage(role) {
    const who = ROLE_LABELS[role] || "this";
    return `Those details are correct, but the ${who} account has no administrator dashboard. ` +
      "This sign-in is for Islamic School, Western Academy and platform administrators only.";
  }

  // boot() can be reached twice for one sign-in (the explicit call plus the
  // hashchange fired by moving to #/app/dashboard). Without a guard both runs
  // authenticate and render in parallel, doubling every request and letting
  // the slower one paint over the faster one's result.
  let bootInFlight = null;

  async function boot() {
    if (bootInFlight) return bootInFlight;
    bootInFlight = (async () => {
      try { await bootOnce(); } finally { bootInFlight = null; }
    })();
    return bootInFlight;
  }

  async function bootOnce() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    let me;
    try { me = await window.API.get("/auth/me"); } catch (e) { me = { loggedIn: false }; }

    const authenticated = me.loggedIn && ADMIN_ROLES.includes(me.role);

    // Signed in with a real account that simply is not an administrator: end
    // that session and say why, rather than re-rendering a blank form.
    if (me.loggedIn && !authenticated) {
      try { await window.API.logout(); } catch (e) { /* best effort */ }
      resetSessionState();
      renderLogin(root, nonAdminMessage(me.role), null);
      return;
    }

    // The login page ALWAYS shows the sign-in form. A visitor whose session
    // is still alive gets a "you are already signed in" notice with an
    // explicit Continue action — never a silent, passwordless entry into
    // the super-admin console (the reported fault).
    if (isLoginPage() || !authenticated) {
      resetSessionState();
      renderLogin(root, null, authenticated ? me : null);
      return;
    }
    state.me = me;
    state.superAdmin = me.role === "super_admin";
    state.category = me.category === "western" ? "western" : "islamic";
    // The super admin is not a tenant: it gets its own indigo/slate console
    // theme instead of silently inheriting the Islamic School identity.
    applyTheme(state.superAdmin ? "super" : state.category);

    // Super admins have no tenant, so the institution profile endpoint does
    // not apply to them (and would 403). Only fetch it for tenant admins.
    if (!state.superAdmin) {
      try {
        state.profile = await window.API.get("/madrasa/profile");
      } catch (e) {
        toast("Could not load institution profile.", "error");
      }
    }

    state.route = normalizeRoute(currentRoute());
    renderApp(root);
  }

  /** One listener for the whole page lifetime (boot() used to add a fresh
      listener on every call, so they piled up after each login). It also
      never renders the admin shell from stale state: without a session in
      memory it re-authenticates instead. */
  function onHashChange() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;                       // the public site is mounted — not ours
    if (isLoginPage()) { boot(); return; }   // explicit sign-in page → password gate
    if (!state.me) { boot(); return; }       // no session in memory → re-authenticate
    state.route = normalizeRoute(currentRoute());
    renderApp(root);
  }
  window.addEventListener("hashchange", onHashChange);

  /** Any authenticated API call answering 401 means the session ended
      server-side (logged out elsewhere, expired, account deactivated).
      The dashboard must fall back to the sign-in screen instead of
      rendering an admin shell whose every request fails. */
  window.addEventListener("bello:unauthorized", () => {
    if (!state.me) return;                   // already signed out / on the form
    resetSessionState();
    const root = document.getElementById(ROOT_ID);
    if (root) renderLogin(root, "Your session has ended. Please sign in again.", null);
  });

  /** The super admin's "dashboard" is the platform overview, not a tenant. */
  function normalizeRoute(route) {
    if (state.superAdmin && (route === "dashboard" || route === "")) return "platform";
    return route;
  }

  /* --------------------------------------------------------------------
     Login screen (shown when not authenticated / wrong role)
     -------------------------------------------------------------------- */
  /** Single place that owns the <body> theme class, so no caller can leave
      two palettes applied at once (which silently broke every var()). */
  function applyTheme(theme) {
    document.body.classList.remove("dash-islamic", "dash-western", "dash-super");
    if (theme === "super") document.body.classList.add("dash-super");
    else if (theme === "western") document.body.classList.add("dash-western");
    else if (theme === "islamic") document.body.classList.add("dash-islamic");
  }

  function renderLogin(root, error, session, username) {
    applyTheme(null);
    document.title = "Admin Sign-In — BELLO";
    // Shown ONLY when /api/auth/me reports a live session: the visitor is
    // told who is signed in and must explicitly choose to continue — the
    // dashboard is never entered without that deliberate action or a
    // password.
    const notice = (session && session.loggedIn && session.user) ? `
          <div class="dash-login-session">
            <div class="dash-login-session-copy">
              <strong>You are already signed in as ${esc(session.user.fullName || session.user.username)}.</strong>
              <small>${session.role === "super_admin" ? "Platform Super Admin" : ((categoryConfig[session.category] || fallbackCategoryConfig.islamic).adminLabel)}${session.institutionName ? " — " + esc(session.institutionName) : ""}</small>
            </div>
            <div class="dash-login-session-actions">
              <button type="button" id="dashContinueBtn">Continue to dashboard</button>
              <button type="button" id="dashSignOutBtn">Sign out</button>
            </div>
          </div>` : "";
    root.innerHTML = `
      <div class="dash-login-page">
        <div class="dash-login-card">
          <div class="brand-row">
            <img src="/assets/bello-multi-madrasa-platform-logo.png" alt="BELLO">
            <div><strong style="font-weight:800;font-size:1.05rem;">BELLO</strong><div style="font-size:.72rem;color:#726d7b;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Admin Sign-In</div></div>
          </div>
          <h1>Sign in to your dashboard</h1>
          <p class="sub">Islamic School, Western Academy and platform administrators use the same sign-in — BELLO routes you to the right dashboard automatically.</p>
          ${notice}
          ${error ? `<div class="dash-login-error" role="alert" aria-live="assertive">${esc(error)}</div>` : ""}
          <form id="dashLoginForm" novalidate>
            <div class="dash-login-field">
              <label for="dlUser">Username</label>
              <input id="dlUser" name="username" autocomplete="username" value="${esc(username || "")}" required>
            </div>
            <div class="dash-login-field">
              <label for="dlPass">Password</label>
              <input id="dlPass" name="password" type="password" autocomplete="current-password" required>
            </div>
            <button class="dash-login-submit" type="submit">Sign In</button>
          </form>
          <div class="dash-login-foot">Registering a new institution? <a href="/register-madrasa" data-noroute style="font-weight:700;color:#38146a;">Register an Islamic School</a> or <a href="/western-schools" data-noroute style="font-weight:700;color:#38146a;">a Western Academy</a>.</div>
        </div>
      </div>`;

    // After a failed attempt the form is re-rendered, so put the cursor back
    // where the visitor has to type next instead of leaving focus nowhere.
    const focusTarget = root.querySelector(username ? "#dlPass" : "#dlUser");
    if (focusTarget && typeof focusTarget.focus === "function") {
      try { focusTarget.focus(); } catch (e) { /* non-fatal */ }
    }

    const continueBtn = root.querySelector("#dashContinueBtn");
    if (continueBtn) continueBtn.addEventListener("click", () => {
      const targetHash = (session && session.role === "super_admin") ? "#/app/platform" : "#/app/dashboard";
      try { window.history.replaceState(null, "", "/admin" + targetHash); } catch (e) { /* ignore */ }
      window.location.hash = targetHash;
      boot();
    });
    const signOutBtn = root.querySelector("#dashSignOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", async () => {
      try { await window.API.logout(); } catch (e) { /* ignore */ }
      resetSessionState();
      renderLogin(root, "You have been signed out. Sign in with any administrator account below.", null);
    });

    const form = root.querySelector("#dashLoginForm");
    // The submit button is the ONLY control that must never be left in the
    // "Signing in…" state: a failed attempt that does not restore it looks
    // exactly like "I press Sign In and nothing happens".
    const submitBtn = form.querySelector("button[type=submit]") || form.querySelector("button");
    const submitLabel = submitBtn ? submitBtn.textContent : "Sign In";

    function failed(message) {
      // Keep the typed username so a retry only needs the password again,
      // and put the reason on screen where the form is.
      const typed = form.elements.username ? form.elements.username.value : "";
      renderLogin(root, message, session, typed);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submitBtn && submitBtn.disabled) return;   // ignore double submits
      // form.elements.<name> is the standard accessor (works in every
      // engine; the form.<name> shortcut is not implemented by jsdom).
      const username = (form.elements.username.value || "").trim();
      const password = form.elements.password.value || "";
      // Browsers with `required` normally block this, but autofill and
      // password managers can submit an empty field — say so rather than
      // firing a request that silently 400s.
      if (!username || !password) {
        failed("Enter both your username and your password.");
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Signing in…"; }
      let result;
      try {
        result = await window.API.login(username, password);
      } catch (err) {
        // A failed network request has no .message worth showing; everything
        // else (401 wrong password, 403 deactivated, 429 rate limited) does.
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        failed(err && err.message
          ? err.message
          : (offline ? "You appear to be offline. Check your connection and try again."
                     : "Could not reach the server. Please try again."));
        return;
      } finally {
        if (submitBtn && submitBtn.isConnected) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
      }

      // Authenticated — but this console only serves administrators. A
      // teacher/student/parent must be told that, not silently returned to
      // the form with their session still open.
      if (!ADMIN_ROLES.includes(result && result.role)) {
        try { await window.API.logout(); } catch (e2) { /* best effort */ }
        resetSessionState();
        renderLogin(root, nonAdminMessage(result && result.role), null, username);
        return;
      }

      // Signing in always switches the account: drop any stale dashboard
      // state from a previous session before mounting the new one.
      resetSessionState();
      // Land on the admin section's own address when the form was opened
      // from /login or /admin, so a reload never bounces back here.
      const path = window.location.pathname.replace(/\/+$/, "") || "/";
      const targetHash = (result && result.role === "super_admin") ? "#/app/platform" : "#/app/dashboard";
      if (path === "/login" || path === "/admin" || path === "/admin/login") {
        try { window.history.replaceState(null, "", "/admin" + targetHash); } catch (e) { /* ignore */ }
      }
      window.location.hash = targetHash;
      await boot();
    });
  }

  /* --------------------------------------------------------------------
     Shell (sidebar + header + routed content)
     -------------------------------------------------------------------- */
  function pageTitleFor(route) {
    if (state.superAdmin) {
      const smap = {
        platform: "Platform Overview",
        "platform/madaris": "Madrasas & Academies",
        "platform/registrations": "Registrations",
        "platform/plans": "Subscription Plans",
        "platform/analytics": "Platform Analytics",
        "platform/activity": "Activity Log",
        "platform/backups": "Backups & Storage",
        "platform/settings": "Platform Settings",
      };
      if (smap[route]) return smap[route];
      if (route.startsWith("platform/madaris/")) return "Madrasa / Academy Detail";
      return "Super Admin";
    }
    const top = route.split("/")[0];
    const t = category();
    const map = {
      dashboard: "Dashboard", institution: t.myInstitutionLabel, students: "Students",
      teachers: "Teachers", classes: "Classes", subjects: t.subjectsLabel, attendance: "Attendance",
      academic: "Academic", quran: "Qur'an / Islamic Education", admissions: "Admissions",
      communication: "Communication", finance: "Finance", website: "Website", settings: "Settings",
    };
    return map[top] || "Dashboard";
  }

  function renderApp(root) {
    // No session in memory → never paint the admin shell from stale state;
    // re-authenticate instead.
    if (!state.me) { boot(); return; }
    const cat = state.category;
    const schema = state.superAdmin ? superAdminSchema() : sidebarSchema(cat);
    const t = T();
    const m = (state.profile && state.profile.madrasa) || {};
    const verified = Number(m.verified) === 1;
    const initials = (state.me.user.fullName || state.me.user.username || "A").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

    root.innerHTML = `
      <div class="dash-root">
        <div class="dash-overlay" id="dashOverlay"></div>
        <div class="dash-shell">
          <aside class="dash-sidebar" id="dashSidebar">
            <div class="dash-brand">
              <span class="dash-brand-logo"><img src="/assets/bello-multi-madrasa-platform-logo.png" alt="BELLO"></span>
              <span class="dash-brand-words">
                <strong>${state.superAdmin ? "BELLO" : esc(m.name_en || "BELLO")}</strong>
                <small>${state.superAdmin ? "Super Admin" : esc(category().adminLabel)}</small>
              </span>
            </div>
            <nav class="dash-nav" id="dashNav">${renderNav(schema)}</nav>
            <div class="dash-sidebar-foot">
              <button class="dash-logout-btn" id="dashLogoutBtn">${I.logout} Log Out</button>
            </div>
          </aside>
          <div class="dash-main">
            <header class="dash-header">
              <button class="dash-burger" id="dashBurger" aria-label="Open menu">${I.menu}</button>
              <div class="dash-header-title">
                <h1>${esc(pageTitleFor(state.route))}</h1>
                <div class="sub">Welcome, ${esc(state.me.user.fullName || state.me.user.username)}</div>
              </div>
              <div class="dash-header-spacer"></div>
              ${state.superAdmin
                ? `<span class="dash-badge verified">${I.shield} Super Admin</span>`
                : `<span class="dash-badge ${verified ? "verified" : "pending"}">${verified ? I.check + " Verified" : I.clock + " Pending Review"}</span>`}
              <div class="dash-header-user">
                <span class="dash-header-avatar">${esc(initials)}</span>
                <span class="who"><strong>${esc(state.me.user.fullName || state.me.user.username)}</strong><small>${state.superAdmin ? "Platform Administrator" : esc(m.name_en || "")}</small></span>
              </div>
            </header>
            <main class="dash-content"><div class="dash-content-inner" id="dashContent"></div></main>
          </div>
        </div>
      </div>`;

    // sidebar interactivity
    root.querySelectorAll("[data-nav-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-nav-toggle");
        if (state.openGroups.has(key)) state.openGroups.delete(key); else state.openGroups.add(key);
        root.querySelector("#dashNav").innerHTML = renderNav(schema);
        bindNavLinks(root);
      });
    });
    bindNavLinks(root);

    root.querySelector("#dashLogoutBtn").addEventListener("click", async () => {
      // Clear the in-memory session FIRST so nothing can re-render the
      // admin shell from stale state while the request is in flight.
      resetSessionState();
      applyTheme(null);
      try { await window.API.logout(); } catch (e) { /* ignore */ }
      // A real navigation away: fresh page, fresh state, no session cookie.
      window.location.replace("/");
    });
    root.querySelector("#dashBurger").addEventListener("click", () => setSidebarOpen(root, true));
    root.querySelector("#dashOverlay").addEventListener("click", () => setSidebarOpen(root, false));

    renderRoute(root);
  }

  function bindNavLinks(root) {
    root.querySelectorAll("[data-nav-route]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        go(a.getAttribute("data-nav-route"));
        setSidebarOpen(root, false);
      });
    });
  }

  function setSidebarOpen(root, open) {
    root.querySelector("#dashSidebar").classList.toggle("is-open", open);
    root.querySelector("#dashOverlay").classList.toggle("is-open", open);
  }

  function renderNav(schema) {
    return schema.map((sec) => {
      if (sec.route) {
        const active = state.route === sec.route;
        return `<button class="dash-nav-link${active ? " top-active" : ""}" data-nav-route="${esc(sec.route)}">${I[sec.icon] || ""}<span>${esc(sec.label)}</span></button>`;
      }
      const open = state.openGroups.has(sec.key) || sec.items.some(([, r]) => state.route === r);
      const rows = sec.items.map(([label, r]) => {
        const active = state.route === r;
        return `<button class="${active ? "active" : ""}" data-nav-route="${esc(r)}">${esc(label)}</button>`;
      }).join("");
      return `
        <div class="dash-nav-group">
          <button class="dash-nav-link" data-nav-toggle="${sec.key}" aria-expanded="${open}">
            ${I[sec.icon] || ""}<span>${esc(sec.label)}</span><span class="chev">${I.chev}</span>
          </button>
          <div class="dash-nav-sub${open ? " is-open" : ""}">${rows}</div>
        </div>`;
    }).join("");
  }

  /* --------------------------------------------------------------------
     Context handed to the MY INSTITUTION module.
     Exposing the dashboard's own primitives (rather than letting that module
     invent its own) is what keeps the section visually and behaviourally
     identical to the rest of the workspace.
     -------------------------------------------------------------------- */
  function institutionContext() {
    return { I, esc, T, go, toast, openModal, closeModal, statCard, fmtDate, state };
  }

  /* --------------------------------------------------------------------
     Route dispatch
     -------------------------------------------------------------------- */
  async function renderRoute(root) {
    const content = root.querySelector("#dashContent");
    content.innerHTML = `<div class="dash-coming-soon"><div class="icon">${I.clock}</div><h3>Loading…</h3></div>`;
    const route = state.route;
    try {
      if (state.superAdmin) return await renderSuperRoute(content, route);
      if (route === "dashboard") return await pageDashboard(content);

      // Institution and public-site management.
      // The whole MY INSTITUTION section lives in public/js/my-institution.js.
      // It renders into this same #dashContent node and borrows the helpers
      // below, so it stays inside the existing admin design system. The older
      // "Website" menu items alias the same screens rather than duplicating
      // them. If that module is unavailable the legacy editors still answer.
      if (window.BelloMyInstitution && window.BelloMyInstitution.handles(route)) {
        return await window.BelloMyInstitution.render(institutionContext(), content, route);
      }
      if (["institution/profile", "institution/information", "institution/contact", "institution/settings", "settings/institution"].includes(route)) return await pageInstitutionEditor(content, route);
      if (route === "institution/website" || route === "website/public") return await pageWebsiteOverview(content);
      if (route === "institution/appearance" || route === "website/appearance") return await pageAppearance(content);
      if (route === "institution/gallery" || route === "website/gallery") return await pageGallery(content);
      if (["institution/pages", "website/homepage", "website/about", "website/programs", "website/teachers", "website/admissions", "website/news", "website/contact"].includes(route)) return await pageWebsiteContent(content, route);

      // Students, staff, classes and subjects
      if (window.BelloTeacherClasses && window.BelloTeacherClasses.handles(route)) {
        return await window.BelloTeacherClasses.render({ I, esc, T, go, toast, openModal, closeModal, statCard, fmtDate, options, emptyRow, pillFor, catalogue, state }, content, route);
      }
      if (route === "students/all") return await pageStudents(content);
      if (route === "students/add") return await pageStudentForm(content);
      if (route === "students/applications") return await pageAdmissionApplications(content);
      if (route === "students/groups") return await pageStudentGroups(content);
      if (route === "students/profiles") return await pageStudentProfiles(content);

      if (route === "teachers/all") return await pageTeachers(content);
      if (route === "teachers/add") return await pageTeacherForm(content);
      if (route === "teachers/applications") return await pageTeacherApplications(content);
      if (route === "teachers/profiles") return await pageTeacherProfiles(content);

      if (route === "classes/all") return await pageClasses(content);
      if (route === "classes/add") return await pageClassForm(content);
      if (route === "classes/timetable") return await pageTimetableManager(content);
      if (route === "classes/students") return await pageClassRoster(content);
      if (route === "classes/teachers") return await pageClassTeacherRoster(content);
      if (route.startsWith("subjects/detail/")) return await pageSubjectDetail(content, "Other Subjects", decodeURIComponent(route.slice("subjects/detail/".length)));
      if (route.startsWith("subjects/")) return await pageSubjectDetail(content, decodeURIComponent(route.slice("subjects/".length)));

      // Islamic education remains a discrete category-specific module; Western
      // navigation never exposes these routes and the backend enforces it too.
      if (route.startsWith("quran/")) return await pageQuranProgress(content, route);

      // The complete Academic + Admissions workspace is isolated in its own
      // module but renders inside this unchanged dashboard shell/design system.
      if (window.BelloAcademicAdmissions && window.BelloAcademicAdmissions.handles(route)) {
        return await window.BelloAcademicAdmissions.render({ I, esc, go, toast, openModal, closeModal, statCard, fmtDate, options, emptyRow, pillFor, catalogue, allTerms, todayIso, bindRouteButtons, state }, content, route);
      }

      // Attendance and academics
      if (route === "attendance/students") return await pageAttendanceStudents(content);
      if (route === "attendance/teachers") return await pageTeacherAttendance(content);
      if (route === "attendance/reports") return await pageAttendanceReport(content);
      if (["academic/lessons", "academic/assignments"].includes(route)) return await pageHomework(content, route);
      if (route === "academic/examinations") return await pageGrading(content);
      if (route === "academic/results") return await pageResultsWorkbook(content);
      if (route === "academic/report-cards") return await pageReportCards(content);
      if (route === "academic/sessions" || route === "academic/terms") return await pageSessionsManager(content, route);

      // Admissions, communication and finance
      if (route === "admissions/applications" || route === "admissions/status") return await pageAdmissionApplications(content);
      if (route === "admissions/requirements") return await pageAdmissionRequirements(content);
      if (route === "admissions/settings") return await pageAdmissionSettings(content);
      if (route === "communication/announcements") return await pageAnnouncements(content);
      if (route === "communication/messages") return await pageMessages(content);
      if (route === "communication/notifications") return await pageNotifications(content);
      if (route === "communication/parents") return await pageParentCommunication(content);
      if (route === "finance/fees") return await pageFees(content);
      if (route === "finance/payments" || route === "finance/records") return await pagePayments(content);
      if (route === "finance/outstanding") return await pageOutstandingFees(content);
      if (route === "finance/reports") return await pageFinanceReport(content);

      // Account, access controls and notification preferences
      if (route === "settings/account" || route === "settings/security") return await pageAccountSettings(content);
      if (route === "settings/staff") return await pageTeachers(content);
      if (route === "settings/roles") return await pageRoles(content);
      if (route === "settings/notifications") return await pageNotificationSettings(content);
      return pageComingSoon(content, "Dashboard", route);
    } catch (e) {
      content.innerHTML = `<div class="dash-coming-soon"><div class="icon">${I.close}</div><h3>Something went wrong</h3><p>${esc(e.message || "Please try again.")}</p></div>`;
    }
  }

  function pageComingSoon(content, group, route, note) {
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">${esc(group)}</div><h2>${esc(routeLabel(route))}</h2></div></div>
      <div class="dash-card"><div class="dash-coming-soon">
        <div class="icon">${I.settings}</div>
        <h3>${esc(routeLabel(route))}</h3>
        <p>${esc(note || "This address is not part of the administrator workspace. Choose a section from the sidebar.")}</p>
      </div></div>`;
  }
  function routeLabel(route) {
    const last = route.split("/").pop();
    return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /* ============================ DASHBOARD ============================= */

  /** `sub` is an optional smaller suffix beside the value (e.g. "/ 12").
      It is a separate argument on purpose: `value` is always escaped, so
      passing markup in it used to print literal "&lt;small…&gt;" tags. */
  function statCard(icon, value, label, accent, sub) {
    return `<div class="dash-stat-card"><div class="dash-stat-icon${accent ? " accent" : ""}">${I[icon] || ""}</div>` +
      `<div class="dash-stat-value">${esc(value)}${sub ? `<small class="dash-stat-sub">${esc(sub)}</small>` : ""}</div>` +
      `<div class="dash-stat-label">${esc(label)}</div></div>`;
  }

  function donutSvg(parts, size) {
    size = size || 120;
    const r = size / 2 - 10;
    const c = size / 2;
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    let angle = -90;
    const segs = parts.map((p) => {
      const frac = p.value / total;
      const start = angle;
      angle += frac * 360;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = c + r * Math.cos((start * Math.PI) / 180);
      const y1 = c + r * Math.sin((start * Math.PI) / 180);
      const x2 = c + r * Math.cos((angle * Math.PI) / 180);
      const y2 = c + r * Math.sin((angle * Math.PI) / 180);
      return `<path d="M${c} ${c} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${p.color}"></path>`;
    }).join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="dash-donut">${segs}<circle cx="${c}" cy="${c}" r="${r * 0.55}" fill="var(--d-surface)"></circle></svg>`;
  }

  async function pageDashboard(content) {
    const t = T();
    let data; let analytics; let hifzOverview = null;
    try {
      [data, analytics, hifzOverview] = await Promise.all([
        window.API.get("/madrasa/dashboard"),
        window.API.get("/madrasa/analytics?months=6&attendanceDays=30"),
        t.hifzEnabledByDefault ? window.API.get("/quran-progress/config")
          .then((config) => config.enabled ? window.API.get("/quran-progress/overview") : config)
          .catch(() => null) : Promise.resolve(null),
      ]);
    } catch (e) { data = null; analytics = null; }
    state.dashboardData = data;
    const m = (state.profile && state.profile.madrasa) || {};
    const slug = m.slug || "your-institution";
    const url = `${window.location.origin}/schools/${encodeURIComponent(slug)}`;
    const s = (data && data.stats) || { totalStudents: 0, totalTeachers: 0, totalClasses: 0, totalSubjects: 0, pendingApplications: 0, attendanceToday: { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 } };
    const att = s.attendanceToday || { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    const reportAnalytics = (analytics && analytics.analytics) || {};
    const enrolmentByClass = (reportAnalytics.enrolment && reportAnalytics.enrolment.byClass) || [];
    const academic = reportAnalytics.results || {};
    const finance = reportAnalytics.fees || {};
    const maxClassCount = Math.max(1, ...enrolmentByClass.map((row) => Number(row.value) || 0));
    const hifz = (hifzOverview && hifzOverview.totals) || null;
    const hifzDisabled = !!(hifzOverview && hifzOverview.enabled === false);

    content.innerHTML = `
      <div class="dash-website-card" style="margin-bottom:22px;">
        <div class="dash-website-info">
          <div class="label">${esc(t.websiteCardTitle)}</div>
          <div class="url">${esc(url)}</div>
          <div class="desc">Your public page is live and updates automatically as you edit your ${esc(t.instNoun)} in this dashboard.</div>
        </div>
        <div class="dash-website-actions">
          <a class="dash-btn dash-btn-accent" href="/schools/${esc(slug)}" target="_blank" rel="noopener">${I.external} Visit Website</a>
          <button class="dash-btn dash-btn-ghost" data-nav-route="institution/appearance" style="color:#fff;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.08);">${I.edit} Edit Website</button>
        </div>
      </div>

      <div class="dash-stats-grid">
        ${statCard("users", s.totalStudents, "Total Students")}
        ${statCard("teacher", s.totalTeachers, "Total Teachers")}
        ${statCard("classes", s.totalClasses, "Total Classes")}
        ${statCard("book", s.totalSubjects, "Total Subjects")}
        ${statCard("calendar", att.present + "/" + (att.present + att.absent + att.late + att.excused + att.unmarked), "Attendance Today", true)}
        ${statCard("admissions", s.pendingApplications, "Pending Applications", true)}
        ${statCard("money", fmtMoney(finance.outstanding || 0), "Outstanding Fees")}
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Student Overview</h3><span class="hint">Enrollment</span></div>
          <div class="dash-card-pad">
            <div class="dash-bars">
              ${enrolmentByClass.length ? enrolmentByClass.map((row) => `<div class="dash-bar-col" title="${esc(row.label)}: ${Number(row.value) || 0}"><div class="dash-bar" style="height:${Math.max(4, Math.round(((Number(row.value) || 0) / maxClassCount) * 100))}px"></div><div class="dash-bar-label">${esc(row.label)}</div></div>`).join("") : `<p class="hint">No class enrolment data yet. Create a class and assign students to see this chart.</p>`}
            </div>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Attendance Today</h3></div>
          <div class="dash-card-pad">
            <div class="dash-donut-wrap">
              ${donutSvg([
                { value: att.present, color: "var(--d-ok)" },
                { value: att.absent, color: "var(--d-danger)" },
                { value: att.late, color: "var(--d-warn)" },
                { value: att.unmarked || 0, color: "var(--d-line)" },
              ])}
              <div class="dash-donut-legend">
                <div class="dash-legend-row"><span class="dash-legend-dot" style="background:var(--d-ok)"></span>Present: ${att.present}</div>
                <div class="dash-legend-row"><span class="dash-legend-dot" style="background:var(--d-danger)"></span>Absent: ${att.absent}</div>
                <div class="dash-legend-row"><span class="dash-legend-dot" style="background:var(--d-warn)"></span>Late: ${att.late}</div>
                <div class="dash-legend-row"><span class="dash-legend-dot" style="background:var(--d-line)"></span>Unmarked: ${att.unmarked || 0}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        ${t.hifzEnabledByDefault ? `<div class="dash-card dash-islamic-insight">
          <div class="dash-card-head"><h3>Qur'an & Hifz Progress</h3><button class="dash-btn dash-btn-ghost dash-btn-sm" data-nav-route="quran/progress">Open tracker</button></div>
          <div class="dash-card-pad">
            ${hifz ? `<div class="dash-progress-pair"><div><span>Memorization</span><strong>${hifz.memorizationAverage || 0}%</strong><i><b style="width:${Math.min(100, Number(hifz.memorizationAverage || 0))}%"></b></i></div><div><span>Revision</span><strong>${hifz.revisionAverage || 0}%</strong><i><b style="width:${Math.min(100, Number(hifz.revisionAverage || 0))}%"></b></i></div></div><p class="hint" style="margin:16px 0 0">${hifz.students || 0} learner(s) tracked across ${hifz.records || 0} progress entry/entries.</p>` : hifzDisabled ? `<div class="dash-empty-state dash-empty-state--compact"><div class="dash-empty-state-icon">${I.settings}</div><h3>Hifz tracking is switched off</h3><p>Existing records are kept safely. Open the tracker to enable this optional Islamic learning module.</p></div>` : `<div class="dash-empty-state dash-empty-state--compact"><div class="dash-empty-state-icon">${I.book}</div><h3>Hifz tracking is ready</h3><p>Record a first Surah, Juz or recitation assessment to start this view.</p></div>`}
          </div>
        </div>` : `<div class="dash-card dash-western-insight">
          <div class="dash-card-head"><h3>Academic Performance</h3><button class="dash-btn dash-btn-ghost dash-btn-sm" data-nav-route="academic/results">Open results</button></div>
          <div class="dash-card-pad"><div class="dash-kpi-line"><strong>${academic.average == null ? "—" : `${academic.average}%`}</strong><span>Term average</span></div><div class="dash-kpi-line"><strong>${academic.passRate == null ? "—" : `${academic.passRate}%`}</strong><span>Pass rate</span></div><p class="hint" style="margin:14px 0 0">${academic.summaries || 0} calculated student summary/summaries in the current reporting term.</p></div>
        </div>`}
        <div class="dash-card">
          <div class="dash-card-head"><h3>${t.hifzEnabledByDefault ? "Academic Performance" : "Fee Collection"}</h3><button class="dash-btn dash-btn-ghost dash-btn-sm" data-nav-route="${t.hifzEnabledByDefault ? "academic/results" : "finance/reports"}">View details</button></div>
          <div class="dash-card-pad">${t.hifzEnabledByDefault ? `<div class="dash-kpi-line"><strong>${academic.average == null ? "—" : `${academic.average}%`}</strong><span>Term average</span></div><div class="dash-kpi-line"><strong>${academic.passRate == null ? "—" : `${academic.passRate}%`}</strong><span>Pass rate</span></div><p class="hint" style="margin:14px 0 0">Islamic and general subjects appear together in the shared report-card and gradebook workflow.</p>` : `<div class="dash-kpi-line"><strong>${fmtMoney(finance.thisMonth || 0)}</strong><span>Collected this month</span></div><div class="dash-kpi-line"><strong>${finance.collectionRate || 0}%</strong><span>Collection rate</span></div><p class="hint" style="margin:14px 0 0">${finance.studentsInDebt || 0} student(s) have an outstanding balance in the current term.</p>`}</div>
        </div>
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Today's Classes</h3></div>
          <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Time</th></tr></thead>
            <tbody>
              ${(data && data.todaysClasses && data.todaysClasses.length) ? data.todaysClasses.map((c) => `<tr><td>${esc(c.className)}</td><td>${esc(c.subjectName)}</td><td>${esc(c.teacherName)}</td><td>${esc(c.startTime)}–${esc(c.endTime)}</td></tr>`).join("")
                : `<tr class="dash-empty-row"><td colspan="4">No classes scheduled for today yet — set one up in Classes → Class Timetable.</td></tr>`}
            </tbody>
          </table></div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Recent Applications</h3></div>
          <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>Applicant</th><th>Status</th></tr></thead>
            <tbody>
              ${(data && data.recentApplications && data.recentApplications.length) ? data.recentApplications.map((a) => `<tr><td>${esc(a.name)}</td><td><span class="dash-pill ${pillFor(a.status)}">${esc(a.status)}</span></td></tr>`).join("")
                : `<tr class="dash-empty-row"><td colspan="2">No applications yet.</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>

      <div class="dash-card" style="margin-bottom:18px;">
        <div class="dash-card-head"><h3>Recent Announcements</h3></div>
        <div class="dash-card-pad">
          ${(data && data.recentAnnouncements && data.recentAnnouncements.length) ? data.recentAnnouncements.map((a) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--d-line-soft);">
              <strong style="font-size:.88rem;">${esc(a.title)}</strong>
              <div style="font-size:.8rem;color:var(--d-muted);margin-top:2px;">${esc((a.body || "").slice(0, 140))}${a.body && a.body.length > 140 ? "…" : ""}</div>
            </div>`).join("") : `<div class="dash-coming-soon" style="padding:20px;"><p>No announcements posted yet.</p></div>`}
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-head"><h3>Quick Actions</h3></div>
        <div class="dash-card-pad">
          <div class="dash-quick-grid">
            ${quickAction("users", "Add Student", "students/add")}
            ${quickAction("teacher", "Add Teacher", "teachers/add")}
            ${quickAction("classes", "Create Class", "classes/add")}
            ${quickAction("calendar", "Record Attendance", "attendance/students")}
            ${quickAction("bell", "Add Announcement", "communication/announcements")}
            ${quickAction("globe", "Edit Website", "institution/appearance")}
          </div>
        </div>
      </div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  function quickAction(icon, label, route) {
    return `<button class="dash-quick-btn" data-nav-route="${esc(route)}"><span class="dash-quick-icon">${I[icon] || ""}</span>${esc(label)}</button>`;
  }
  function pillFor(status) {
    const s = String(status || "").toLowerCase();
    if (["approved", "active", "present", "paid"].includes(s)) return "ok";
    if (["pending", "on_hold"].includes(s)) return "warn";
    if (["rejected", "absent", "overdue"].includes(s)) return "danger";
    return "info";
  }

  /* ====================== INSTITUTION PROFILE ========================== */

  async function pageWebsiteOverview(content) {
    const m = (state.profile && state.profile.madrasa) || {};
    const site = await window.API.get("/madrasa/public-site").catch(() => null);
    const slug = m.slug || "your-institution";
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Website</div><h2>Public Website</h2><p>Your live, standalone public page.</p></div></div>
      <div class="dash-website-card" style="margin-bottom:20px;">
        <div class="dash-website-info">
          <div class="label">Live URL</div>
          <div class="url">${esc(window.location.origin + "/schools/" + encodeURIComponent(slug))}</div>
          <div class="desc">This link opens only this institution’s public website.</div>
        </div>
        <div class="dash-website-actions">
          <a class="dash-btn dash-btn-accent" href="/schools/${esc(slug)}" target="_blank" rel="noopener">${I.external} Visit Website</a>
          <button class="dash-btn dash-btn-ghost" data-nav-route="institution/appearance" style="color:#fff;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.35);">${I.edit} Edit Website</button>
        </div>
      </div>
      <div class="dash-grid-3">
        ${statCard("admissions", site ? site.counts.pendingApplications : "—", "Pending Applications")}
        ${statCard("academic", site ? site.counts.publishedResults : "—", "Published Results")}
        ${statCard("bell", site ? site.counts.publicNotices : "—", "Public Notices")}
      </div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  async function pageAppearance(content) {
    const m = (state.profile && state.profile.madrasa) || {};
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Website</div><h2>Website Appearance</h2><p>Logo, cover image, brand color and tagline for your public site — kept inside the BELLO template.</p></div></div>
      <div class="dash-grid-2">
        <div class="dash-card"><div class="dash-card-pad">
          <div class="dash-field" style="margin-bottom:16px;">
            <label>Logo</label>
            <div style="display:flex;align-items:center;gap:14px;">
              <img src="${esc(m.logo_path || "/assets/bello-multi-madrasa-platform-logo.png")}" style="width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid var(--d-line);">
              <input type="file" id="logoInput" accept="image/png,image/jpeg,image/webp">
            </div>
          </div>
          <div class="dash-field" style="margin-bottom:16px;">
            <label>Cover / Hero Image</label>
            <div style="display:flex;align-items:center;gap:14px;">
              ${m.hero_image_path ? `<img src="${esc(m.hero_image_path)}" style="width:96px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--d-line);">` : ""}
              <input type="file" id="heroInput" accept="image/png,image/jpeg,image/webp">
            </div>
          </div>
          <form id="appearanceForm">
            <div class="dash-form-grid">
              <div class="dash-field"><label>Tagline</label><input name="tagline" value="${esc(m.tagline || "")}"></div>
              <div class="dash-field"><label>Brand Color</label><input name="brand_color" type="color" value="${esc(m.brand_color || T().primaryColor)}"></div>
            </div>
            <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Save Appearance</button>
          </form>
        </div></div>
        <div class="dash-card"><div class="dash-card-head"><h3>Preview</h3></div>
          <div class="dash-card-pad">
            <div style="border-radius:14px;overflow:hidden;border:1px solid var(--d-line);">
              <div style="height:120px;background:${esc(m.brand_color || "var(--d-primary-800)")};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;">${esc(m.name_en || "Your Institution")}</div>
              <div style="padding:14px;font-size:.82rem;color:var(--d-muted);">${esc(m.tagline || "Your tagline appears here.")}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    content.querySelector("#logoInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("logo", f);
      try { await window.API.post("/madrasa/profile/logo", fd); toast("Logo updated.", "success"); pageAppearance(content); }
      catch (err) { toast(err.message || "Upload failed.", "error"); }
    });
    content.querySelector("#heroInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("hero", f);
      try { await window.API.post("/madrasa/profile/hero", fd); toast("Cover image updated.", "success"); pageAppearance(content); }
      catch (err) { toast(err.message || "Upload failed.", "error"); }
    });
    content.querySelector("#appearanceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await window.API.put("/madrasa/profile", { tagline: fd.get("tagline"), brand_color: fd.get("brand_color") });
        toast("Appearance saved.", "success");
        const p = await window.API.get("/madrasa/profile"); state.profile = p;
        pageAppearance(content);
      } catch (err) { toast(err.message || "Could not save.", "error"); }
    });
  }

  async function pageGallery(content) {
    const g = await window.API.get("/madrasa/gallery");
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Website</div><h2>Gallery</h2><p>Photos shown on your public website.</p></div>
        <label class="dash-btn dash-btn-primary" style="cursor:pointer;">${I.plus} Add Photo<input type="file" id="galleryInput" accept="image/png,image/jpeg,image/webp" style="display:none;"></label>
      </div>
      <div class="dash-card"><div class="dash-card-pad">
        ${g.images.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;">
          ${g.images.map((img) => `
            <div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--d-line);">
              <img src="${esc(img.image_path)}" style="width:100%;height:120px;object-fit:cover;display:block;">
              <button data-del="${img.id}" class="dash-btn dash-btn-danger dash-btn-sm" style="position:absolute;top:6px;right:6px;padding:5px 8px;">${I.trash}</button>
            </div>`).join("")}
        </div>` : `<div class="dash-coming-soon"><div class="icon">${I.image}</div><h3>No photos yet</h3><p>Add photos of your ${T().institutionNoun} — classrooms, events, students at work.</p></div>`}
      </div></div>
    `;
    content.querySelector("#galleryInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("image", f);
      try { await window.API.post("/madrasa/gallery", fd); toast("Photo added.", "success"); pageGallery(content); }
      catch (err) { toast(err.message || "Upload failed.", "error"); }
    });
    content.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await window.API.del("/madrasa/gallery/" + btn.getAttribute("data-del")); pageGallery(content); }
      catch (err) { toast(err.message || "Could not delete.", "error"); }
    }));
  }

  /* =============================== SETTINGS ================================= */

  /* =====================================================================
     COMPLETE TENANT ADMIN WORKSPACE
     ---------------------------------------------------------------------
     Every sidebar item below is a data-backed workspace. Empty states are
     deliberate guidance, never a fake chart or a "coming soon" screen.
     ===================================================================== */
  function bindRouteButtons(scope) {
    scope.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => {
      e.preventDefault();
      go(el.getAttribute("data-nav-route"));
    }));
  }
  function options(rows, selected, label) {
    return (rows || []).map((r) => `<option value="${esc(r.id)}" ${String(r.id) === String(selected) ? "selected" : ""}>${esc(label ? label(r) : (r.name_en || r.label || r.full_name || r.id))}</option>`).join("");
  }
  function emptyRow(cols, copy) {
    return `<tr class="dash-empty-row"><td colspan="${cols}">${esc(copy)}</td></tr>`;
  }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function routeTitle(route) { return routeLabel(route).replace(/\b\w/g, (c) => c.toUpperCase()); }
  async function catalogue() {
    const [classes, subjects, sessions] = await Promise.all([
      window.API.get("/classes").catch(() => ({ classes: [] })),
      window.API.get("/subjects").catch(() => ({ subjects: [] })),
      window.API.get("/sessions").catch(() => ({ sessions: [] })),
    ]);
    return { classes: classes.classes || [], subjects: subjects.subjects || [], sessions: sessions.sessions || [] };
  }
  function allTerms(sessions) {
    return (sessions || []).flatMap((s) => (s.terms || []).map((t) => Object.assign({ session_label: s.label }, t)));
  }

  /* =========================== INSTITUTION ============================ */
  async function pageInstitutionEditor(content, route) {
    const profile = await window.API.get("/madrasa/profile");
    state.profile = profile;
    const m = profile.madrasa || {};
    const isContact = route.includes("contact");
    const isSettings = route.includes("settings");
    const heading = isContact ? "Contact Information" : (isSettings ? `${T().institutionLabel} Settings` : `${T().institutionLabel} Profile`);
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">My ${esc(T().institutionLabel)}</div><h2>${esc(heading)}</h2><p>${isContact ? "Keep the public contact details and links families rely on up to date." : "These details are used throughout the administrator workspace and on your public profile."}</p></div></div>
      <div class="dash-card"><div class="dash-card-pad"><form id="institutionEditor">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Name (English)</label><input name="name_en" required value="${esc(m.name_en)}"></div>
          <div class="dash-field"><label>Name (Arabic)</label><input name="name_ar" dir="rtl" value="${esc(m.name_ar)}"></div>
          <div class="dash-field"><label>Motto (English)</label><input name="motto_en" value="${esc(m.motto_en)}"></div>
          <div class="dash-field"><label>Motto (Arabic)</label><input name="motto_ar" dir="rtl" value="${esc(m.motto_ar)}"></div>
          <div class="dash-field"><label>Phone</label><input name="phone" autocomplete="tel" value="${esc(m.phone)}"></div>
          <div class="dash-field"><label>Email</label><input name="email" type="email" autocomplete="email" value="${esc(m.email)}"></div>
          <div class="dash-field"><label>WhatsApp</label><input name="whatsapp" autocomplete="tel" value="${esc(m.whatsapp)}"></div>
          <div class="dash-field"><label>Website URL</label><input name="website" type="url" placeholder="https://…" value="${esc(m.website)}"></div>
          <div class="dash-field"><label>City</label><input name="city" value="${esc(m.city)}"></div>
          <div class="dash-field"><label>State</label><input name="state_name" value="${esc(m.state_name)}"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Street Address</label><input name="address" value="${esc(m.address)}"></div>
          <div class="dash-field"><label>Facebook URL</label><input name="facebook" type="url" value="${esc(m.facebook)}"></div>
          <div class="dash-field"><label>Instagram URL</label><input name="instagram" type="url" value="${esc(m.instagram)}"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Map Link</label><input name="maps_link" type="url" placeholder="https://maps.google.com/…" value="${esc(m.maps_link)}"></div>
          <div class="dash-field"><label>Administrator / Head Name</label><input name="admin_full_name" value="${esc(m.admin_full_name)}"></div>
          <div class="dash-field"><label>Position</label><input name="admin_position" value="${esc(m.admin_position)}"></div>
        </div>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save ${esc(heading)}</button>
      </form></div></div>`;
    content.querySelector("#institutionEditor").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.target); const body = {};
      ["name_en", "name_ar", "motto_en", "motto_ar", "phone", "email", "whatsapp", "website", "city", "state_name", "address", "facebook", "instagram", "maps_link", "admin_full_name", "admin_position"].forEach((k) => { body[k] = form.get(k); });
      try { await window.API.put("/madrasa/profile", body); toast("Institution details saved.", "success"); await pageInstitutionEditor(content, route); }
      catch (err) { toast(err.message || "Could not save institution details.", "error"); }
    });
  }

  async function pageWebsiteContent(content, route) {
    const [profile, publicSite, settingData] = await Promise.all([
      window.API.get("/madrasa/profile"), window.API.get("/madrasa/public-site"), window.API.get("/madrasa/settings"),
    ]);
    state.profile = profile;
    const m = profile.madrasa || {}; const site = publicSite.settings || {}; const settings = settingData.settings || {};
    const key = route.split("/").pop();
    const meta = {
      pages: ["Website pages", "Edit the content sections shown to visitors."],
      homepage: ["Homepage", "Welcome visitors with an accurate introduction and call to action."],
      about: [T().aboutLabel, "Tell families about your institution’s identity and approach."],
      programs: [T().programsLabel, "Explain the learning programmes alongside the live subjects list."],
      teachers: ["Teachers", "Introduce your teaching team without exposing private staff details."],
      admissions: ["Admissions", "Set the admission guidance visible to prospective families."],
      news: ["News & Announcements", "Public news comes from announcements marked for public publication."],
      contact: ["Contact Page", "Contact details below are published from your institution profile."],
    }[key] || ["Website content", "Update the copy visitors see."];
    const contentKey = `website_${key}_content`;
    const titleKey = `website_${key}_title`;
    const defaultCopy = key === "homepage" ? (site.description_en || "") : key === "admissions" ? (m.admission_info || "") : (settings[contentKey] || "");
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Website</div><h2>${esc(meta[0])}</h2><p>${esc(meta[1])}</p></div>
        <a class="dash-btn dash-btn-ghost" href="/schools/${esc(m.slug)}" target="_blank" rel="noopener">${I.external} Preview public site</a></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="websiteContentForm">
          <div class="dash-form-grid">
            <div class="dash-field" style="grid-column:1/-1"><label>Section heading</label><input name="title" maxlength="200" value="${esc(settings[titleKey] || (key === "homepage" ? m.name_en : meta[0]))}"></div>
            <div class="dash-field" style="grid-column:1/-1"><label>${key === "admissions" ? "Admission requirements and guidance" : "Page content"}</label><textarea name="body" maxlength="4000" rows="10" placeholder="Write clear, family-friendly content…">${esc(defaultCopy)}</textarea></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save public content</button>
        </form>
        ${key === "news" ? `<p class="hint" style="margin:16px 0 0">Create and control public news in <button class="dash-link-btn" type="button" data-nav-route="communication/announcements">Announcements</button>. Only items marked “Publish on public website” appear to visitors.</p>` : ""}
        ${key === "contact" ? `<p class="hint" style="margin:16px 0 0">Phone, email, address and social links are managed in <button class="dash-link-btn" type="button" data-nav-route="institution/contact">Contact Information</button>.</p>` : ""}
      </div></div>`;
    content.querySelector("#websiteContentForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const body = {};
      body[titleKey] = fd.get("title"); body[contentKey] = fd.get("body");
      try {
        await window.API.put("/madrasa/settings", body);
        if (key === "homepage") await window.API.put("/madrasa/public-site", { description_en: fd.get("body") });
        if (key === "admissions") await window.API.put("/madrasa/profile", { admission_info: fd.get("body") });
        toast("Public content saved.", "success");
      } catch (err) { toast(err.message || "Could not save public content.", "error"); }
    });
    bindRouteButtons(content);
  }

  /* ============================== STUDENTS ============================= */
  const studentStatusLabels = { active: "Active", inactive: "Inactive", promoted: "Promoted", graduated: "Graduated", withdrawn: "Withdrawn", suspended: "Suspended" };
  function studentStatus(status) { return studentStatusLabels[status] || String(status || "Unknown"); }
  function studentStatusPill(status) { return `<span class="dash-pill ${pillFor(status)}">${esc(studentStatus(status))}</span>`; }
  function studentAvatar(s, compact = false) { return s.photo_path ? `<img class="student-avatar${compact ? " compact" : ""}" src="${esc(s.photo_path)}" alt="">` : `<span class="student-avatar student-avatar--empty${compact ? " compact" : ""}">${esc((s.first_name || "S").charAt(0) + (s.last_name || "").charAt(0))}</span>`; }

  async function pageStudents(content) {
    const [stats, base] = await Promise.all([window.API.get("/students/stats"), catalogue()]);
    let page = 1; const perPage = 12; let selected = new Set(); let currentRows = [];
    const filterValues = () => ({
      search: content.querySelector("#studentSearch")?.value.trim() || "",
      classId: content.querySelector("#studentClass")?.value || "",
      sessionId: content.querySelector("#studentSession")?.value || "",
      program: content.querySelector("#studentProgram")?.value.trim() || "",
      gender: content.querySelector("#studentGender")?.value || "",
      education_track: content.querySelector("#studentTrack")?.value || "",
      status: content.querySelector("#studentStatus")?.value || "",
      sort: content.querySelector("#studentSort")?.value || "admission",
      direction: content.querySelector("#studentDirection")?.value || "asc",
    });
    const query = (values) => Object.entries(Object.assign({}, values, { page, perPage })).filter(([, v]) => v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const renderRows = (rows) => {
      currentRows = rows || [];
      const tbody = content.querySelector("#studentRows"); if (!tbody) return;
      tbody.innerHTML = currentRows.length ? currentRows.map((s) => `<tr>
        <td><input class="student-select" type="checkbox" value="${s.id}" ${selected.has(Number(s.id)) ? "checked" : ""} aria-label="Select ${esc(s.first_name)} ${esc(s.last_name)}"></td>
        <td><div class="student-name-cell">${studentAvatar(s, true)}<div><strong>${esc([s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" "))}</strong>${s.preferred_name ? `<small>${esc(s.preferred_name)}</small>` : ""}</div></div></td>
        <td><strong>${esc(s.student_code || s.admission_no)}</strong><small>${esc(s.admission_no)}</small></td>
        <td>${esc(s.class_en || "Unassigned")}${s.section ? `<small>${esc(s.section)}</small>` : ""}</td>
        <td>${esc(s.session_label || "—")}</td><td>${esc(s.program || "—")}</td><td>${studentStatusPill(s.status)}</td>
        <td><div class="dash-table-actions"><button class="dash-btn dash-btn-ghost dash-btn-sm" data-profile="${s.id}">View</button><button class="dash-btn dash-btn-ghost dash-btn-sm" data-edit="${s.id}">${I.edit}</button></div></td>
      </tr>`).join("") : emptyRow(8, "No students match these filters.");
      tbody.querySelectorAll(".student-select").forEach((box) => box.addEventListener("change", () => { const id = Number(box.value); box.checked ? selected.add(id) : selected.delete(id); updateBulk(); }));
      tbody.querySelectorAll("[data-profile]").forEach((b) => b.addEventListener("click", () => openStudentProfile(Number(b.dataset.profile), false)));
      tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openStudentProfile(Number(b.dataset.edit), true)));
      const all = content.querySelector("#selectAllStudents"); if (all) all.checked = currentRows.length > 0 && currentRows.every((s) => selected.has(Number(s.id)));
    };
    const updateBulk = () => { const bar = content.querySelector("#studentBulkBar"); if (bar) { bar.hidden = !selected.size; const n = bar.querySelector("[data-selected-count]"); if (n) n.textContent = selected.size; } };
    const load = async () => {
      content.querySelector("#studentLoading").hidden = false; content.querySelector("#studentTableCard").classList.add("is-loading");
      try { const d = await window.API.get(`/students?${query(filterValues())}`); renderRows(d.students || []); const total = Number(d.total || 0); content.querySelector("#studentResultCount").textContent = `${total} student${total === 1 ? "" : "s"}`; content.querySelector("#studentPageLabel").textContent = `Page ${d.page || page} of ${Math.max(1, d.totalPages || Math.ceil(total / perPage))}`; content.querySelector("#studentPrev").disabled = page <= 1; content.querySelector("#studentNext").disabled = page >= Math.max(1, d.totalPages || Math.ceil(total / perPage)); }
      catch (e) { content.querySelector("#studentRows").innerHTML = emptyRow(8, e.message || "Could not load students."); }
      finally { content.querySelector("#studentLoading").hidden = true; content.querySelector("#studentTableCard").classList.remove("is-loading"); }
    };
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>All Students</h2><p>One secure directory for Islamic, Western and dual-track learners.</p></div><div class="dash-actions"><button id="printStudents" class="dash-btn dash-btn-ghost">${I.external} Print</button><a id="exportStudents" class="dash-btn dash-btn-ghost" href="${window.API.url("/exports/students.csv")}" target="_blank" rel="noopener">${I.download} Export</a><button class="dash-btn dash-btn-primary" data-nav-route="students/add">${I.plus} Add Student</button></div></div>
      <div class="dash-stats-grid student-stat-grid">${statCard("users", stats.total || 0, "Total students")}${statCard("check", stats.active || 0, "Active students")}${statCard("plus", stats.newStudents || 0, "New in last 30 days", true)}${statCard("academic", stats.graduated || 0, "Graduated")}${statCard("close", stats.withdrawn || 0, "Withdrawn")}</div>
      <div class="dash-card student-filter-card"><div class="dash-card-pad"><div class="student-filter-head"><div><strong>Find a student</strong><small>Search by name, student ID, admission number or guardian</small></div><button type="button" class="dash-btn dash-btn-ghost dash-btn-sm" id="toggleStudentFilters">Advanced filters</button></div><div class="student-filter-grid"><div class="dash-field student-search-field"><label>Search</label><input id="studentSearch" type="search" placeholder="e.g. Bello, STU0001 or guardian phone"></div><div class="dash-field"><label>Class / level</label><select id="studentClass"><option value="">All classes</option>${options(base.classes)}</select></div><div class="dash-field"><label>Academic session</label><select id="studentSession"><option value="">All sessions</option>${options(base.sessions, null, (x) => x.label)}</select></div><div class="dash-field"><label>Status</label><select id="studentStatus"><option value="">All statuses</option>${Object.entries(studentStatusLabels).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div></div><div id="studentAdvancedFilters" class="student-advanced-filters" hidden><div class="dash-field"><label>Program</label><input id="studentProgram" placeholder="Program name"></div><div class="dash-field"><label>Gender</label><select id="studentGender"><option value="">All genders</option><option value="M">Male</option><option value="F">Female</option><option value="Other">Other / not specified</option></select></div><div class="dash-field"><label>Education track</label><select id="studentTrack"><option value="">Islamic + Western</option><option value="islamic">Islamic only</option><option value="western">Western only</option><option value="both">Both tracks</option></select></div><div class="dash-field"><label>Sort by</label><select id="studentSort"><option value="admission">Admission number</option><option value="name">Name</option><option value="newest">Newest added</option><option value="class">Class</option><option value="status">Status</option></select></div><div class="dash-field"><label>Direction</label><select id="studentDirection"><option value="asc">Ascending</option><option value="desc">Descending</option></select></div></div></div></div>
      <div id="studentBulkBar" class="student-bulk-bar" hidden><strong><span data-selected-count>0</span> selected</strong><div class="dash-actions"><select id="bulkStudentAction"><option value="">Bulk action</option><option value="active">Restore / activate</option><option value="inactive">Archive as inactive</option><option value="suspended">Suspend</option><option value="graduated">Mark graduated</option><option value="withdrawn">Mark withdrawn</option></select><button class="dash-btn dash-btn-primary dash-btn-sm" id="applyBulkStudent">Apply</button><button class="dash-btn dash-btn-ghost dash-btn-sm" id="clearStudentSelection">Clear</button></div></div>
      <div id="studentTableCard" class="dash-card"><div class="student-loading" id="studentLoading" hidden>Loading student records…</div><div class="dash-table-wrap"><table class="dash-table student-directory-table"><thead><tr><th><input id="selectAllStudents" type="checkbox" aria-label="Select all students"></th><th>Student</th><th>ID / admission no.</th><th>Class / section</th><th>Session</th><th>Program</th><th>Status</th><th></th></tr></thead><tbody id="studentRows"></tbody></table></div><div class="student-pagination"><span id="studentResultCount">—</span><span id="studentPageLabel">Page 1</span><button id="studentPrev" class="dash-btn dash-btn-ghost dash-btn-sm">Previous</button><button id="studentNext" class="dash-btn dash-btn-ghost dash-btn-sm">Next</button></div></div>`;
    const inputs = ["studentSearch", "studentClass", "studentSession", "studentProgram", "studentGender", "studentTrack", "studentStatus", "studentSort", "studentDirection"].map((id) => content.querySelector(`#${id}`));
    let timer; inputs.forEach((input) => input && input.addEventListener(input.tagName === "INPUT" ? "input" : "change", () => { if (input.id !== "studentSort" && input.id !== "studentDirection") page = 1; clearTimeout(timer); timer = setTimeout(load, input.tagName === "INPUT" ? 300 : 0); }));
    content.querySelector("#toggleStudentFilters").addEventListener("click", (e) => { const box = content.querySelector("#studentAdvancedFilters"); box.hidden = !box.hidden; e.currentTarget.textContent = box.hidden ? "Advanced filters" : "Hide advanced filters"; });
    content.querySelector("#selectAllStudents").addEventListener("change", (e) => { currentRows.forEach((s) => e.target.checked ? selected.add(Number(s.id)) : selected.delete(Number(s.id))); renderRows(currentRows); updateBulk(); });
    content.querySelector("#studentPrev").addEventListener("click", () => { if (page > 1) { page--; load(); } }); content.querySelector("#studentNext").addEventListener("click", () => { page++; load(); });
    content.querySelector("#clearStudentSelection").addEventListener("click", () => { selected.clear(); renderRows(currentRows); updateBulk(); });
    content.querySelector("#applyBulkStudent").addEventListener("click", async () => { const action = content.querySelector("#bulkStudentAction").value; if (!action || !selected.size) return toast("Choose a bulk action first.", "error"); if (!window.confirm(`Apply “${studentStatus(action)}” to ${selected.size} student(s)?`)) return; try { await window.API.post("/students/bulk-status", { student_ids: [...selected], status: action }); toast("Bulk student action completed.", "success"); selected.clear(); load(); } catch (e) { toast(e.message || "Bulk action failed.", "error"); } });
    content.querySelector("#printStudents").addEventListener("click", () => window.print());
    content.querySelector("#exportStudents").addEventListener("click", (e) => { const href = window.API.url(`/exports/students.csv?${query(Object.assign({}, filterValues(), { page: "", perPage: "" }))}`); e.currentTarget.href = href; });
    bindRouteButtons(content); await load();
  }

  async function pageStudentForm(content) {
    const { classes, sessions } = await catalogue();
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>Add Student</h2><p>Register one complete student profile. The system assigns a unique student ID and admission number when you save.</p></div><button class="dash-btn dash-btn-ghost" data-nav-route="students/all">Back to directory</button></div><form id="studentForm" class="student-registration-form"><div class="dash-card"><div class="dash-card-head"><h3>Personal information</h3><span class="hint">Fields marked * are required</span></div><div class="dash-card-pad"><div class="student-form-photo"><div id="studentPhotoPreview" class="student-photo-preview"><span>${I.image}</span></div><div><label class="dash-btn dash-btn-ghost student-file-label">${I.image} Choose student photo<input id="newStudentPhoto" type="file" name="photo" accept="image/png,image/jpeg,image/webp" hidden></label><small class="dash-field-hint">JPG, PNG or WEBP · max ${esc(String(5))}MB</small></div></div><div class="dash-form-grid"><div class="dash-field"><label>First name <span class="req">*</span></label><input name="first_name" required maxlength="100"></div><div class="dash-field"><label>Middle name</label><input name="middle_name" maxlength="100"></div><div class="dash-field"><label>Last name <span class="req">*</span></label><input name="last_name" required maxlength="100"></div><div class="dash-field"><label>Preferred name</label><input name="preferred_name"></div><div class="dash-field"><label>Gender</label><select name="gender"><option value="">Not specified</option><option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option></select></div><div class="dash-field"><label>Date of birth</label><input name="date_of_birth" type="date"></div><div class="dash-field"><label>Nationality</label><input name="nationality" value="Nigerian"></div><div class="dash-field"><label>Religion</label><input name="religion" value="Islam"></div><div class="dash-field"><label>State of origin</label><input name="state_of_origin"></div><div class="dash-field"><label>LGA</label><input name="lga"></div></div></div></div><div class="dash-card"><div class="dash-card-head"><h3>Academic information</h3><span class="hint">One student, one or both education tracks</span></div><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Admission number</label><input name="admission_no" placeholder="Leave blank to generate"></div><div class="dash-field"><label>Student ID</label><input name="student_code" placeholder="Leave blank to use admission number"></div><div class="dash-field"><label>Admission date</label><input name="admission_date" type="date" value="${todayIso()}"></div><div class="dash-field"><label>Academic session</label><select name="session_id"><option value="">Not set</option>${options(sessions, null, (x) => x.label)}</select></div><div class="dash-field"><label>Current class / level</label><select name="class_id"><option value="">Unassigned</option>${options(classes)}</select></div><div class="dash-field"><label>Islamic class</label><select name="islamic_class_id"><option value="">Not assigned</option>${options(classes)}</select></div><div class="dash-field"><label>Western class</label><select name="western_class_id"><option value="">Not assigned</option>${options(classes)}</select></div><div class="dash-field"><label>Section / arm</label><input name="section" placeholder="e.g. A or Blue"></div><div class="dash-field"><label>General program</label><input name="program" placeholder="e.g. Basic, STEM"></div><div class="dash-field"><label>Islamic program</label><input name="islamic_program" placeholder="e.g. Tahfiz, Arabic"></div><div class="dash-field"><label>Western program</label><input name="western_program" placeholder="e.g. Basic, STEM"></div><div class="dash-field"><label>Education track</label><select name="education_track"><option value="both">Islamic + Western</option><option value="islamic">Islamic education</option><option value="western">Western / general</option></select></div><div class="dash-field"><label>Student type</label><select name="student_type"><option value="new">New student</option><option value="returning">Returning student</option></select></div><div class="dash-field"><label>Previous school</label><input name="previous_school"></div><div class="dash-field"><label>Previous class / level</label><input name="previous_class"></div></div></div></div><div class="dash-card"><div class="dash-card-head"><h3>Parent / guardian information</h3><span class="hint">Provide at least one reliable contact</span></div><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Father's name</label><input name="father_name"></div><div class="dash-field"><label>Mother's name</label><input name="mother_name"></div><div class="dash-field"><label>Guardian name</label><input name="guardian_name"></div><div class="dash-field"><label>Relationship</label><input name="guardian_relationship" placeholder="e.g. Aunt, Uncle"></div><div class="dash-field"><label>Parent / guardian display name</label><input name="parent_name"></div><div class="dash-field"><label>Phone number</label><input name="parent_phone" type="tel"></div><div class="dash-field"><label>Alternative phone</label><input name="alternative_phone" type="tel"></div><div class="dash-field"><label>Email</label><input name="parent_email" type="email"></div><div class="dash-field" style="grid-column:1/-1"><label>Address</label><textarea name="address" rows="2"></textarea></div><div class="dash-field"><label>Emergency contact</label><input name="emergency_contact"></div><div class="dash-field"><label>Relevant emergency information</label><textarea name="emergency_info" rows="2"></textarea></div></div></div></div><div class="dash-card"><div class="dash-card-head"><h3>Other information</h3></div><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Residential address</label><textarea name="residential_address" rows="2"></textarea></div><div class="dash-field"><label>Additional notes</label><textarea name="notes" rows="2"></textarea></div><div class="dash-field" style="grid-column:1/-1"><label>Documents</label><input id="newStudentDocuments" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"><small class="dash-field-hint">Documents are stored privately and can only be downloaded by authorized staff.</small></div></div></div></div><div class="student-form-actions"><button type="button" class="dash-btn dash-btn-ghost" data-nav-route="students/all">Cancel</button><button type="reset" class="dash-btn dash-btn-ghost">Reset form</button><button class="dash-btn dash-btn-primary" type="submit">${I.check} Save student</button></div></form>`;
    const form = content.querySelector("#studentForm"); const photo = content.querySelector("#newStudentPhoto");
    photo.addEventListener("change", () => { const f = photo.files[0]; if (f) content.querySelector("#studentPhotoPreview").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Student preview">`; });
    form.addEventListener("reset", () => setTimeout(() => { content.querySelector("#studentPhotoPreview").innerHTML = `<span>${I.image}</span>`; }, 0));
    form.addEventListener("submit", async (e) => { e.preventDefault(); const btn = form.querySelector("button[type=submit]"); btn.disabled = true; const fd = new FormData(form); const body = {}; ["first_name", "middle_name", "last_name", "preferred_name", "gender", "date_of_birth", "nationality", "state_of_origin", "lga", "religion", "admission_no", "student_code", "admission_date", "session_id", "class_id", "islamic_class_id", "western_class_id", "section", "program", "islamic_program", "western_program", "education_track", "student_type", "previous_school", "previous_class", "father_name", "mother_name", "guardian_name", "guardian_relationship", "parent_name", "parent_phone", "alternative_phone", "parent_email", "address", "residential_address", "emergency_contact", "emergency_info", "notes"].forEach((k) => body[k] = fd.get(k)); try { const result = await window.API.post("/students", body); const id = result.id; if (photo.files[0]) { const p = new FormData(); p.append("photo", photo.files[0]); await window.API.post(`/students/${id}/photo`, p); } for (const file of [...content.querySelector("#newStudentDocuments").files]) { const d = new FormData(); d.append("document", file); d.append("document_name", file.name); await window.API.post(`/students/${id}/documents`, d); } toast(`Student saved — ${result.studentCode || result.admissionNo}.`, "success"); go("students/profiles"); } catch (err) { toast(err.message || "Could not save student. Nothing was changed.", "error"); btn.disabled = false; } }); bindRouteButtons(content);
  }

  async function pageStudentGroups(content) {
    const [data, base, teacherData] = await Promise.all([window.API.get("/students/groups"), catalogue(), window.API.get("/teachers").catch(() => ({ teachers: [] }))]); const groups = data.groups || []; const teachers = teacherData.teachers || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>Student groups</h2><p>Build classes, houses, clubs, Qur'an circles, teams and custom cohorts. A student can belong to multiple groups.</p></div><button class="dash-btn dash-btn-primary" id="newStudentGroup">${I.plus} Create group</button></div><div class="student-group-toolbar"><input id="groupSearch" type="search" placeholder="Search groups"><select id="groupType"><option value="">All group types</option>${["class", "house", "club", "society", "islamic", "quran", "academic", "sports", "graduation", "special_program", "custom"].map((x) => `<option value="${x}">${esc(x.replace(/_/g, " "))}</option>`).join("")}</select></div><div id="studentGroupsGrid" class="dash-grid-3">${groups.length ? groups.map((g) => studentGroupCard(g)).join("") : `<div class="dash-card"><div class="dash-empty-state"><div class="dash-empty-state-icon">${I.users}</div><h3>No student groups yet</h3><p>Create your first group and start adding students.</p></div></div>`}</div>`;
    const draw = () => { const q = content.querySelector("#groupSearch").value.toLowerCase(); const type = content.querySelector("#groupType").value; const shown = groups.filter((g) => (!type || g.group_type === type) && (!q || `${g.name} ${g.description || ""}`.toLowerCase().includes(q))); content.querySelector("#studentGroupsGrid").innerHTML = shown.length ? shown.map(studentGroupCard).join("") : `<div class="dash-card"><div class="dash-card-pad">No groups match your search.</div></div>`; bindGroupCards(); };
    const bindGroupCards = () => content.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => openStudentGroupModal(Number(b.dataset.group), teachers)));
    content.querySelector("#groupSearch").addEventListener("input", draw); content.querySelector("#groupType").addEventListener("change", draw); content.querySelector("#newStudentGroup").addEventListener("click", () => openStudentGroupModal(null, teachers)); bindGroupCards();
  }
  function studentGroupCard(g) { return `<article class="dash-card student-group-card"><div class="dash-card-pad"><div class="student-group-card-top"><span class="dash-pill info">${esc(String(g.group_type || "custom").replace(/_/g, " "))}</span>${g.status === "archived" ? `<span class="dash-pill muted">Archived</span>` : ""}</div><h3>${esc(g.name)}</h3><p>${esc(g.description || "No description")}</p><div class="student-group-meta"><strong>${Number(g.member_count || 0)}</strong><span>members</span><span>·</span><span>${esc(g.teacher_name || "No teacher")}</span></div><div class="dash-actions"><button class="dash-btn dash-btn-ghost dash-btn-sm" data-group="${g.id}">Manage group</button><a class="dash-btn dash-btn-ghost dash-btn-sm" href="${window.API.url(`/exports/student-groups/${g.id}.csv`)}" target="_blank" rel="noopener">${I.download} Export</a></div></div></article>`; }
  async function openStudentGroupModal(groupId, teachers) {
    const base = await catalogue(); const data = groupId ? await window.API.get(`/students/groups/${groupId}`) : { group: null, members: [] }; const g = data.group; const members = data.members || [];
    const modal = openModal(g ? `Manage group · ${g.name}` : "Create student group", `<form id="groupForm"><div class="dash-form-grid"><div class="dash-field"><label>Group name <span class="req">*</span></label><input name="name" required value="${esc(g?.name || "")}"></div><div class="dash-field"><label>Group type</label><select name="group_type">${["class", "house", "club", "society", "islamic", "quran", "academic", "sports", "graduation", "special_program", "custom"].map((x) => `<option value="${x}" ${g?.group_type === x ? "selected" : ""}>${esc(x.replace(/_/g, " "))}</option>`).join("")}</select></div><div class="dash-field"><label>Assigned teacher</label><select name="teacher_id"><option value="">Not assigned</option>${options(teachers, g?.teacher_id, (x) => x.full_name || x.username)}</select></div><div class="dash-field"><label>Group leader</label><select name="leader_student_id"><option value="">Not assigned</option>${options(base.classes.length ? (await window.API.get("/students?perPage=200")).students : [], g?.leader_student_id, (x) => `${x.first_name} ${x.last_name}`)}</select></div><div class="dash-field" style="grid-column:1/-1"><label>Description</label><textarea name="description">${esc(g?.description || "")}</textarea></div></div><div class="dash-actions" style="margin-top:16px"><button class="dash-btn dash-btn-primary" type="submit">${I.check} ${g ? "Save group" : "Create group"}</button>${g ? `<button id="archiveGroup" type="button" class="dash-btn dash-btn-danger">Archive group</button>` : ""}</div></form>${g ? `<hr class="dash-rule"><div class="dash-card-head" style="padding:0 0 12px;border:0"><h3>Members (${members.length})</h3></div><div class="student-group-members">${members.length ? members.map((s) => `<div class="student-group-member">${studentAvatar(s, true)}<span>${esc(s.first_name)} ${esc(s.last_name)}<small>${esc(s.class_name || "Unassigned")}</small></span><button type="button" class="dash-btn dash-btn-danger dash-btn-sm" data-remove-member="${s.id}">Remove</button></div>`).join("") : `<p class="hint">No members yet.</p>`}</div><form id="addGroupMembers" class="student-add-members"><select name="student_id"><option value="">Add a student…</option>${options((await window.API.get("/students?perPage=200")).students.filter((s) => !members.some((m) => Number(m.id) === Number(s.id))))}</select><button class="dash-btn dash-btn-ghost dash-btn-sm">Add student</button></form>` : ""}`);
    modal.querySelector("#groupForm").addEventListener("submit", async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); try { if (g) await window.API.patch(`/students/groups/${g.id}`, body); else await window.API.post("/students/groups", body); toast(g ? "Group saved." : "Group created.", "success"); closeModal(); pageStudentGroups(document.querySelector("#dashContent")); } catch (e2) { toast(e2.message || "Could not save group.", "error"); } });
    if (g) { modal.querySelector("#archiveGroup").addEventListener("click", async () => { if (!window.confirm("Archive this group? Student records will remain safe.")) return; try { await window.API.del(`/students/groups/${g.id}`); toast("Group archived.", "success"); closeModal(); pageStudentGroups(document.querySelector("#dashContent")); } catch (e) { toast(e.message || "Could not archive group.", "error"); } }); modal.querySelectorAll("[data-remove-member]").forEach((b) => b.addEventListener("click", async () => { if (!window.confirm("Remove this student from the group?")) return; try { await window.API.del(`/students/groups/${g.id}/members/${b.dataset.removeMember}`); closeModal(); openStudentGroupModal(g.id, teachers); } catch (e) { toast(e.message || "Could not remove member.", "error"); } })); modal.querySelector("#addGroupMembers").addEventListener("submit", async (e) => { e.preventDefault(); const sid = new FormData(e.target).get("student_id"); if (!sid) return; try { await window.API.post(`/students/groups/${g.id}/members`, { student_id: sid }); closeModal(); openStudentGroupModal(g.id, teachers); } catch (e2) { toast(e2.message || "Could not add member.", "error"); } }); }
  }

  async function pageStudentProfiles(content) {
    const data = await window.API.get("/students?perPage=200"); const rows = data.students || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>Student profiles</h2><p>Open the complete academic, family, finance, documents and communication record for any student.</p></div><button class="dash-btn dash-btn-primary" data-nav-route="students/add">${I.plus} Add student</button></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Search profiles</label><input id="profileSearch" type="search" placeholder="Name or student ID"></div></div></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Student</th><th>Student ID</th><th>Class / track</th><th>Guardian</th><th>Status</th><th></th></tr></thead><tbody id="profileRows"></tbody></table></div></div>`;
    const draw = () => { const q = content.querySelector("#profileSearch").value.toLowerCase(); const shown = rows.filter((s) => `${s.first_name} ${s.last_name} ${s.student_code || ""} ${s.admission_no}`.toLowerCase().includes(q)); content.querySelector("#profileRows").innerHTML = shown.length ? shown.map((s) => `<tr><td><div class="student-name-cell">${studentAvatar(s, true)}<strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></div></td><td>${esc(s.student_code || s.admission_no)}<small>${esc(s.admission_no)}</small></td><td>${esc(s.class_en || "Unassigned")}<small>${esc([s.islamic_class_name ? `Islamic: ${s.islamic_class_name}` : "", s.western_class_name ? `Western: ${s.western_class_name}` : "", s.education_track || "both"].filter(Boolean).join(" · "))}</small></td><td>${esc(s.parent_name || s.guardian_name || "—")}</td><td>${studentStatusPill(s.status)}</td><td><button class="dash-btn dash-btn-primary dash-btn-sm" data-profile-open="${s.id}">Open profile</button></td></tr>`).join("") : emptyRow(6, "No profiles match your search."); content.querySelectorAll("[data-profile-open]").forEach((b) => b.addEventListener("click", () => openStudentProfile(Number(b.dataset.profileOpen), false))); };
    content.querySelector("#profileSearch").addEventListener("input", draw); draw(); bindRouteButtons(content);
  }

  async function openStudentProfile(id, editMode = false) {
    const [record, base] = await Promise.all([window.API.get(`/students/${id}`), catalogue()]); const s = record.student;
    const modal = openModal(`${s.first_name} ${s.last_name} · profile`, `<div class="student-profile-hero"><div>${studentAvatar(s)}</div><div><h3>${esc([s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" "))}</h3><p>${esc(s.student_code || s.admission_no)} · ${esc(s.class_en || "Unassigned")} ${s.section ? `· ${esc(s.section)}` : ""}</p>${studentStatusPill(s.status)}</div><div class="dash-actions"><button type="button" class="dash-btn dash-btn-primary dash-btn-sm" id="profileEdit">${I.edit} Edit student</button><button type="button" class="dash-btn dash-btn-ghost dash-btn-sm" id="profilePrint">Print profile</button></div></div><div class="student-profile-tabs"><button class="active" data-profile-tab="overview">Overview</button><button data-profile-tab="personal">Personal & family</button><button data-profile-tab="academic">Academic</button><button data-profile-tab="life">Student life</button><button data-profile-tab="finance">Finance</button><button data-profile-tab="documents">Documents</button><button data-profile-tab="communication">Communication</button></div><div id="studentProfilePanel"></div>`);
    modal.querySelector(".dash-modal").style.width = "min(980px, 100%)";
    const panel = modal.querySelector("#studentProfilePanel");
    const tab = (name) => {
      const attendance = record.attendance || []; const present = attendance.filter((a) => a.status === "present").length; const finance = record.finance || {};
      const render = {
        overview: `<div class="student-profile-summary">${[["Student ID", s.student_code || s.admission_no], ["Admission no.", s.admission_no], ["Current class", s.class_en || "Unassigned"], ["Section / arm", s.section || "—"], ["Islamic class", s.islamic_class_name || "—"], ["Western class", s.western_class_name || "—"], ["Program", s.program || "—"], ["Education track", s.education_track || "both"], ["Academic session", s.session_label || "—"], ["Admission date", fmtDate(s.admission_date || s.created_at)], ["Current status", studentStatusPill(s.status)]].map(([l, v]) => `<div><small>${esc(l)}</small><strong>${typeof v === "string" && v.startsWith("<span") ? v : esc(v)}</strong></div>`).join("")}</div><div class="dash-grid-2 student-profile-columns"><div class="dash-card"><div class="dash-card-head"><h3>Recent academic performance</h3></div><div class="dash-card-pad">${(record.terms || []).length ? `<div class="dash-table-wrap"><table class="dash-table"><tbody>${record.terms.slice(0, 6).map((t) => `<tr><td>${esc(t.term_name || "Term")}</td><td>${esc(String(t.average ?? "—"))}%</td><td>${esc(t.overall_grade || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No report-card summaries yet. Results will appear here when teachers publish them.</p>`}</div></div><div class="dash-card"><div class="dash-card-head"><h3>Attendance snapshot</h3></div><div class="dash-card-pad"><div class="dash-kpi-line"><strong>${present}</strong><span>present days</span></div><div class="dash-kpi-line"><strong>${attendance.length - present}</strong><span>other marks</span></div><p class="hint">Attendance records from the existing attendance module.</p></div></div></div><div class="dash-card"><div class="dash-card-head"><h3>Quick actions</h3></div><div class="dash-card-pad"><div class="dash-actions"><button class="dash-btn dash-btn-ghost dash-btn-sm" data-status-action="suspended">Suspend</button><button class="dash-btn dash-btn-ghost dash-btn-sm" data-status-action="graduated">Graduate</button><button class="dash-btn dash-btn-ghost dash-btn-sm" data-status-action="withdrawn">Withdraw</button><button class="dash-btn dash-btn-ghost dash-btn-sm" data-placement-action="transfer">Change class</button><button class="dash-btn dash-btn-ghost dash-btn-sm" data-placement-action="promote">Promote</button><button class="dash-btn dash-btn-accent dash-btn-sm" data-status-action="active">Activate</button></div></div></div>`,
        personal: `<div class="dash-info-grid student-profile-info">${[["Date of birth", fmtDate(s.date_of_birth)], ["Gender", s.gender || "—"], ["Nationality", s.nationality || "—"], ["State / LGA", [s.state_of_origin, s.lga].filter(Boolean).join(" / ") || "—"], ["Religion", s.religion || "—"], ["Address", s.residential_address || s.address || "—"], ["Father", s.father_name || "—"], ["Mother", s.mother_name || "—"], ["Guardian", [s.guardian_name || s.parent_name, s.guardian_relationship].filter(Boolean).join(" · ") || "—"], ["Contact", [s.parent_phone, s.alternative_phone, s.parent_email].filter(Boolean).join(" · ") || "—"], ["Emergency", [s.emergency_contact, s.emergency_info].filter(Boolean).join(" · ") || "—"]].map(([l, v]) => `<div><b>${esc(l)}</b><br>${esc(v)}</div>`).join("")}</div>`,
        academic: `<div class="student-profile-block-grid"><div class="dash-card"><div class="dash-card-head"><h3>Results & report cards</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Term</th><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th></tr></thead><tbody>${(record.results || []).length ? record.results.map((r) => `<tr><td>${esc(r.term_name || "—")}</td><td>${esc(r.subject_name || "—")}</td><td>${esc(r.ca)}</td><td>${esc(r.exam)}</td><td>${esc(r.total)}</td></tr>`).join("") : emptyRow(5, "No subject results yet.")}</tbody></table></div></div><div class="dash-card"><div class="dash-card-head"><h3>Academic history</h3></div><div class="dash-card-pad">${(record.classHistory || []).length ? record.classHistory.map((h) => `<p class="student-history-line">${esc(h.action)} · ${esc(h.from_class_name || "Unassigned")} → ${esc(h.to_class_name || "Unassigned")}<small>${fmtDate(h.created_at)}</small></p>`).join("") : `<p class="hint">No placement or promotion history yet.</p>`}</div></div><div class="dash-card"><div class="dash-card-head"><h3>Attendance</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Date</th><th>Class</th><th>Status</th></tr></thead><tbody>${attendance.length ? attendance.slice(0, 20).map((a) => `<tr><td>${fmtDate(a.day)}</td><td>${esc(a.class_name || "—")}</td><td>${studentStatusPill(a.status)}</td></tr>`).join("") : emptyRow(3, "No attendance records yet.")}</tbody></table></div></div></div>`,
        life: `<div class="dash-card"><div class="dash-card-head"><h3>Groups, clubs and activities</h3><span class="hint">${(record.groups || []).length} group(s)</span></div><div class="dash-card-pad">${(record.groups || []).length ? `<div class="student-profile-chip-list">${record.groups.map((g) => `<span class="dash-pill info">${esc(g.name)} · ${esc(g.group_type)}</span>`).join("")}</div>` : `<p class="hint">This student is not assigned to a group yet.</p>`}<h3 class="student-subheading">Awards, achievements and records</h3><div class="student-life-records">${(record.lifeRecords || []).length ? record.lifeRecords.map((r) => `<article class="student-life-record"><span class="dash-pill ${r.category === "discipline" ? "warn" : "ok"}">${esc(r.category)}</span><strong>${esc(r.title)}</strong><small>${fmtDate(r.record_date || r.created_at)}</small><p>${esc(r.details || "")}</p></article>`).join("") : `<p class="hint">No awards, activities or disciplinary records have been added.</p>`}</div><button id="addLifeRecord" class="dash-btn dash-btn-ghost dash-btn-sm" style="margin-top:12px">${I.plus} Add student-life record</button><h3 class="student-subheading">Status history</h3>${(record.statusHistory || []).length ? record.statusHistory.map((h) => `<p class="student-history-line">${studentStatusPill(h.to_status)}<small>${fmtDate(h.created_at)}${h.reason ? ` · ${esc(h.reason)}` : ""}</small></p>`).join("") : `<p class="hint">No status changes recorded.</p>`}</div></div><div class="dash-card" style="margin-top:14px"><div class="dash-card-head"><h3>Assignments / learning tasks</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Assignment</th><th>Subject</th><th>Due</th></tr></thead><tbody>${(record.homework || []).length ? record.homework.map((h) => `<tr><td>${esc(h.title)}<small>${esc(h.details || "")}</small></td><td>${esc(h.subject_name || "—")}</td><td>${fmtDate(h.due_date)}</td></tr>`).join("") : emptyRow(3, "No assignments posted for this student's class.")}</tbody></table></div></div>`,
        finance: `<div class="student-profile-summary"><div><small>Total billed</small><strong>${fmtMoney(finance.billed)}</strong></div><div><small>Paid</small><strong>${fmtMoney(finance.paid)}</strong></div><div><small>Outstanding</small><strong>${fmtMoney(finance.outstanding)}</strong></div></div><div class="dash-card"><div class="dash-card-head"><h3>Payment history</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Date</th><th>Fee</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${(record.payments || []).length ? record.payments.map((p) => `<tr><td>${fmtDate(p.payment_date)}</td><td>${esc(p.fee_name || "—")}</td><td>${esc(p.method)}</td><td>${esc(p.reference || "—")}</td><td>${fmtMoney(p.amount_ngn)}</td></tr>`).join("") : emptyRow(5, "No payments recorded yet.")}</tbody></table></div></div>`,
        documents: `<div class="dash-card"><div class="dash-card-head"><h3>Student documents</h3><label class="dash-btn dash-btn-primary dash-btn-sm">${I.plus} Upload<input id="profileDocumentUpload" type="file" hidden></label></div><div class="dash-card-pad">${(record.documents || []).length ? `<div class="student-document-list">${record.documents.map((d) => `<div><span>${I.file}</span><strong>${esc(d.document_name)}</strong><small>${esc(d.mime_type)} · ${Math.ceil(Number(d.file_size || 0) / 1024)} KB</small><a class="dash-btn dash-btn-ghost dash-btn-sm" href="/api/students/${id}/documents/${d.id}" target="_blank">Download</a><button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-doc="${d.id}">Remove</button></div>`).join("")}</div>` : `<p class="hint">No documents have been uploaded.</p>`}</div></div>`,
        communication: `<div class="dash-card"><div class="dash-card-head"><h3>Communication history</h3><button id="addStudentCommunication" class="dash-btn dash-btn-primary dash-btn-sm">${I.plus} Add note</button></div><div class="dash-card-pad">${(record.communications || []).length ? record.communications.map((c) => `<article class="student-communication"><strong>${esc(c.subject || c.channel)}</strong><small>${fmtDate(c.created_at)}</small><p>${esc(c.message)}</p></article>`).join("") : `<p class="hint">No direct communication notes yet.</p>`}</div></div><div class="dash-card" style="margin-top:14px"><div class="dash-card-head"><h3>School communication</h3></div><div class="dash-card-pad">${(record.communicationHistory || []).slice(0, 10).map((m) => `<article class="student-communication"><strong>${esc(m.author_name || "School")}</strong><small>${fmtDate(m.created_at)}</small><p>${esc(m.body)}</p></article>`).join("") || `<p class="hint">No general messages yet.</p>`}</div></div>`
      }[name] || ""; panel.innerHTML = render;
      panel.querySelectorAll("[data-status-action]").forEach((b) => b.addEventListener("click", async () => { const status = b.dataset.statusAction; if ((status === "withdrawn" || status === "suspended") && !window.confirm(`Change this student to ${studentStatus(status)}?`)) return; try { await window.API.patch(`/students/${id}/status`, { status }); toast("Student status updated.", "success"); closeModal(); openStudentProfile(id, false); } catch (e) { toast(e.message || "Could not update status.", "error"); } }));
      panel.querySelectorAll("[data-placement-action]").forEach((b) => b.addEventListener("click", () => openStudentPlacementModal(id, base, b.dataset.placementAction)));
      const up = panel.querySelector("#profileDocumentUpload"); if (up) up.addEventListener("change", async () => { const f = up.files[0]; if (!f) return; const d = new FormData(); d.append("document", f); d.append("document_name", f.name); try { await window.API.post(`/students/${id}/documents`, d); toast("Document uploaded.", "success"); tab(name); } catch (e) { toast(e.message || "Could not upload document.", "error"); } });
      panel.querySelectorAll("[data-delete-doc]").forEach((b) => b.addEventListener("click", async () => { if (!window.confirm("Remove this document?")) return; try { await window.API.del(`/students/${id}/documents/${b.dataset.deleteDoc}`); tab(name); } catch (e) { toast(e.message || "Could not remove document.", "error"); } }));
      const life = panel.querySelector("#addLifeRecord"); if (life) life.addEventListener("click", () => { const form = openModal("Add student-life record", `<form id="lifeRecordForm"><div class="dash-form-grid"><div class="dash-field"><label>Category</label><select name="category"><option value="activity">Activity</option><option value="award">Award</option><option value="achievement">Achievement</option><option value="discipline">Disciplinary record</option></select></div><div class="dash-field"><label>Date</label><input name="record_date" type="date" value="${todayIso()}"></div><div class="dash-field" style="grid-column:1/-1"><label>Title</label><input name="title" required></div><div class="dash-field" style="grid-column:1/-1"><label>Details</label><textarea name="details"></textarea></div></div><button class="dash-btn dash-btn-primary" style="margin-top:14px">Save record</button></form>`); form.querySelector("#lifeRecordForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post(`/students/${id}/life-records`, Object.fromEntries(new FormData(e.target))); closeModal(); toast("Student-life record saved.", "success"); tab("life"); } catch (e2) { toast(e2.message || "Could not save record.", "error"); } }); });
      const note = panel.querySelector("#addStudentCommunication"); if (note) note.addEventListener("click", () => { const form = openModal("Add communication note", `<form id="communicationForm"><div class="dash-field"><label>Subject</label><input name="subject"></div><div class="dash-field" style="margin-top:12px"><label>Message <span class="req">*</span></label><textarea name="message" required></textarea></div><button class="dash-btn dash-btn-primary" style="margin-top:14px">Save note</button></form>`); form.querySelector("#communicationForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post(`/students/${id}/communication`, Object.fromEntries(new FormData(e.target))); closeModal(); toast("Communication note saved.", "success"); tab("communication"); } catch (e2) { toast(e2.message || "Could not save note.", "error"); } }); });
    };
    modal.querySelectorAll("[data-profile-tab]").forEach((b) => b.addEventListener("click", () => { modal.querySelectorAll("[data-profile-tab]").forEach((x) => x.classList.remove("active")); b.classList.add("active"); tab(b.dataset.profileTab); }));
    modal.querySelector("#profilePrint").addEventListener("click", () => window.print());
    modal.querySelector("#profileEdit").addEventListener("click", () => { closeModal(); openStudentEditModal(id, base); });
    tab(editMode ? "personal" : "overview"); if (editMode) openStudentEditModal(id, base);
  }
  async function openStudentEditModal(id, base) {
    const s = (await window.API.get(`/students/${id}`)).student;
    const modal = openModal(`Edit student · ${s.first_name} ${s.last_name}`, `<form id="studentEditForm"><div class="student-edit-tabs"><strong>Identity & placement</strong></div><div class="dash-form-grid"><div class="dash-field"><label>First name</label><input name="first_name" required value="${esc(s.first_name)}"></div><div class="dash-field"><label>Middle name</label><input name="middle_name" value="${esc(s.middle_name)}"></div><div class="dash-field"><label>Last name</label><input name="last_name" required value="${esc(s.last_name)}"></div><div class="dash-field"><label>Preferred name</label><input name="preferred_name" value="${esc(s.preferred_name)}"></div><div class="dash-field"><label>Gender</label><select name="gender"><option value="">Not specified</option><option value="M" ${s.gender === "M" ? "selected" : ""}>Male</option><option value="F" ${s.gender === "F" ? "selected" : ""}>Female</option><option value="Other" ${s.gender === "Other" ? "selected" : ""}>Other</option></select></div><div class="dash-field"><label>Date of birth</label><input name="date_of_birth" type="date" value="${esc(s.date_of_birth || "")}"></div><div class="dash-field"><label>Current class / level</label><select name="class_id"><option value="">Unassigned</option>${options(base.classes, s.class_id)}</select></div><div class="dash-field"><label>Islamic class</label><select name="islamic_class_id"><option value="">Not assigned</option>${options(base.classes, s.islamic_class_id)}</select></div><div class="dash-field"><label>Western class</label><select name="western_class_id"><option value="">Not assigned</option>${options(base.classes, s.western_class_id)}</select></div><div class="dash-field"><label>Academic session</label><select name="session_id"><option value="">Not set</option>${options(base.sessions, s.session_id, (x) => x.label)}</select></div><div class="dash-field"><label>Section / arm</label><input name="section" value="${esc(s.section)}"></div><div class="dash-field"><label>Program</label><input name="program" value="${esc(s.program)}"></div><div class="dash-field"><label>Education track</label><select name="education_track"><option value="both" ${s.education_track === "both" ? "selected" : ""}>Islamic + Western</option><option value="islamic" ${s.education_track === "islamic" ? "selected" : ""}>Islamic only</option><option value="western" ${s.education_track === "western" ? "selected" : ""}>Western only</option></select></div><div class="dash-field"><label>Islamic program</label><input name="islamic_program" value="${esc(s.islamic_program)}"></div><div class="dash-field"><label>Western program</label><input name="western_program" value="${esc(s.western_program)}"></div><div class="dash-field"><label>Status</label><select name="status">${Object.entries(studentStatusLabels).map(([v, l]) => `<option value="${v}" ${s.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="dash-field"><label>Guardian name</label><input name="guardian_name" value="${esc(s.guardian_name)}"></div><div class="dash-field"><label>Guardian relationship</label><input name="guardian_relationship" value="${esc(s.guardian_relationship)}"></div><div class="dash-field"><label>Phone</label><input name="parent_phone" value="${esc(s.parent_phone)}"></div><div class="dash-field"><label>Alternative phone</label><input name="alternative_phone" value="${esc(s.alternative_phone)}"></div><div class="dash-field"><label>Email</label><input name="parent_email" value="${esc(s.parent_email)}"></div><div class="dash-field" style="grid-column:1/-1"><label>Address</label><textarea name="address">${esc(s.address)}</textarea></div><div class="dash-field" style="grid-column:1/-1"><label>Notes</label><textarea name="notes">${esc(s.notes)}</textarea></div></div><div class="dash-actions" style="margin-top:16px"><button type="button" class="dash-btn dash-btn-ghost" id="closeStudentEdit">Cancel</button><button class="dash-btn dash-btn-primary">${I.check} Save changes</button></div></form>`);
    modal.querySelector("#closeStudentEdit").addEventListener("click", closeModal); modal.querySelector("#studentEditForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const body = Object.fromEntries(fd); const status = body.status; delete body.status; try { await window.API.patch(`/students/${id}`, body); await window.API.patch(`/students/${id}/status`, { status }); toast("Student profile saved.", "success"); closeModal(); openStudentProfile(id, false); } catch (e2) { toast(e2.message || "Could not save profile.", "error"); } });
  }

  function openStudentPlacementModal(id, base, action) {
    const modal = openModal(action === "promote" ? "Promote student" : "Change student class", `<p class="dash-info-line">${action === "promote" ? "Promotion updates the academic placement and records a promotion history entry." : "Transfer this student to a new class or session. The existing results and attendance history remain attached to the same student."}</p><form id="placementForm"><div class="dash-form-grid"><div class="dash-field"><label>Target class / level <span class="req">*</span></label><select name="class_id" required><option value="">Choose class</option>${options(base.classes)}</select></div><div class="dash-field"><label>Academic session</label><select name="session_id"><option value="">Keep current session</option>${options(base.sessions, null, (x) => x.label)}</select></div><div class="dash-field" style="grid-column:1/-1"><label>Reason / note</label><textarea name="notes" placeholder="Optional placement note"></textarea></div></div><div class="dash-actions" style="margin-top:15px"><button type="button" class="dash-btn dash-btn-ghost" id="cancelPlacement">Cancel</button><button class="dash-btn dash-btn-primary">${I.check} ${action === "promote" ? "Promote student" : "Transfer student"}</button></div></form>`);
    modal.querySelector("#cancelPlacement").addEventListener("click", closeModal); modal.querySelector("#placementForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const body = { class_id: fd.get("class_id"), session_id: fd.get("session_id"), notes: fd.get("notes") }; try { if (action === "promote") await window.API.post(`/students/${id}/promote`, body); else await window.API.patch(`/students/${id}`, body); toast(action === "promote" ? "Student promoted." : "Student transferred.", "success"); closeModal(); openStudentProfile(id, false); } catch (e2) { toast(e2.message || "Could not update placement.", "error"); } });
  }

  /* =============================== STAFF =============================== */
  async function pageTeachers(content) {
    const data = await window.API.get("/teachers"); const teachers = data.teachers || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Teachers</div><h2>All Teachers</h2><p>${teachers.length} teacher account(s). Assignments decide access to class registers and results.</p></div><button class="dash-btn dash-btn-primary" data-nav-route="teachers/add">${I.plus} Add Teacher</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Teacher</th><th>Username</th><th>Assignments</th><th>Status</th><th></th></tr></thead><tbody>${teachers.length ? teachers.map((t) => `<tr><td><strong>${esc(t.full_name)}</strong>${t.full_name_ar ? `<small class="dash-ar">${esc(t.full_name_ar)}</small>` : ""}</td><td>${esc(t.username)}</td><td>${esc((t.assignments || []).map((a) => `${a.class ? a.class.name_en : "All classes"}${a.subject ? ` · ${a.subject.name_en}` : ""}`).join(", ") || "Not assigned")}</td><td><span class="dash-pill ${t.is_active ? "ok" : "danger"}">${t.is_active ? "active" : "inactive"}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-teacher="${t.id}">${I.edit} Manage</button></td></tr>`).join("") : emptyRow(5, "No teacher accounts yet.")}</tbody></table></div></div>`;
    content.querySelectorAll("[data-teacher]").forEach((b) => b.addEventListener("click", () => openTeacherModal(Number(b.dataset.teacher), data)));
    bindRouteButtons(content);
  }

  async function pageTeacherForm(content) {
    const { classes, subjects } = await catalogue();
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Teachers</div><h2>Add Teacher</h2><p>Create a secure staff account, then choose the classes and subjects it can manage.</p></div></div><div class="dash-card"><div class="dash-card-pad"><form id="teacherForm"><div class="dash-form-grid"><div class="dash-field"><label>Full Name <span class="req">*</span></label><input name="full_name" required></div><div class="dash-field"><label>Arabic Name</label><input name="full_name_ar" dir="rtl"></div><div class="dash-field"><label>Username <span class="req">*</span></label><input name="username" required autocomplete="off"></div><div class="dash-field"><label>Temporary Password <span class="req">*</span></label><input name="password" required minlength="8" type="password"></div><div class="dash-field"><label>Email</label><input name="email" type="email"></div><div class="dash-field"><label>Phone</label><input name="phone"></div></div><div class="dash-field" style="margin-top:16px"><label>Teaching assignments</label><div id="assignmentRows"></div><button class="dash-btn dash-btn-ghost dash-btn-sm" id="addAssignment" type="button" style="margin-top:8px">${I.plus} Add assignment</button></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Create Teacher</button></form></div></div>`;
    const addRow = () => { const r = document.createElement("div"); r.className = "dash-assignment-row"; r.innerHTML = `<select class="assign-class"><option value="">All classes</option>${options(classes)}</select><select class="assign-subject"><option value="">All subjects in class</option>${options(subjects)}</select><button type="button" class="dash-icon-btn" aria-label="Remove assignment">${I.close}</button>`; r.querySelector("button").addEventListener("click", () => r.remove()); content.querySelector("#assignmentRows").appendChild(r); };
    content.querySelector("#addAssignment").addEventListener("click", addRow); addRow();
    content.querySelector("#teacherForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const body = {}; ["full_name", "full_name_ar", "username", "password", "email", "phone"].forEach((k) => body[k] = fd.get(k)); body.assignments = [...content.querySelectorAll(".dash-assignment-row")].map((r) => ({ class_id: r.querySelector(".assign-class").value || null, subject_id: r.querySelector(".assign-subject").value || null })); try { await window.API.post("/teachers", body); toast("Teacher account created.", "success"); go("teachers/all"); } catch (err) { toast(err.message || "Could not create teacher.", "error"); } });
  }

  async function openTeacherModal(id, data) {
    const t = (data.teachers || []).find((row) => Number(row.id) === id); if (!t) return;
    const modal = openModal(`Manage ${t.full_name}`, `<form id="teacherEditForm"><div class="dash-form-grid"><div class="dash-field"><label>Full Name</label><input name="full_name" value="${esc(t.full_name)}"></div><div class="dash-field"><label>Email</label><input name="email" type="email" value="${esc(t.email)}"></div><div class="dash-field"><label>Phone</label><input name="phone" value="${esc(t.phone)}"></div><div class="dash-field"><label>New password (optional)</label><input name="password" minlength="8" type="password"></div><div class="dash-field"><label>Account status</label><select name="is_active"><option value="true" ${t.is_active ? "selected" : ""}>Active</option><option value="false" ${!t.is_active ? "selected" : ""}>Inactive</option></select></div></div><div class="dash-field" style="margin-top:14px"><label>Assignments</label><div id="editAssignmentRows"></div><button class="dash-btn dash-btn-ghost dash-btn-sm" id="editAddAssignment" type="button" style="margin-top:8px">${I.plus} Add assignment</button></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save Teacher</button></form>`);
    const add = (assignment = {}) => { const r = document.createElement("div"); r.className = "dash-assignment-row"; r.innerHTML = `<select class="assign-class"><option value="">All classes</option>${options(data.classes, assignment.classId)}</select><select class="assign-subject"><option value="">All subjects in class</option>${options(data.subjects, assignment.subjectId)}</select><button type="button" class="dash-icon-btn" aria-label="Remove assignment">${I.close}</button>`; r.querySelector("button").addEventListener("click", () => r.remove()); modal.querySelector("#editAssignmentRows").appendChild(r); };
    (t.assignments || []).forEach(add); if (!(t.assignments || []).length) add(); modal.querySelector("#editAddAssignment").addEventListener("click", () => add());
    modal.querySelector("#teacherEditForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const body = { full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"), is_active: fd.get("is_active") === "true", assignments: [...modal.querySelectorAll(".dash-assignment-row")].map((r) => ({ class_id: r.querySelector(".assign-class").value || null, subject_id: r.querySelector(".assign-subject").value || null })) }; if (fd.get("password")) body.password = fd.get("password"); try { await window.API.patch(`/teachers/${id}`, body); toast("Teacher details saved.", "success"); closeModal(); pageTeachers(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not save teacher.", "error"); } });
  }

  async function pageTeacherProfiles(content) { return pageTeachers(content); }


  async function pageTeacherApplications(content) {
    const data = await window.API.get("/teachers/applications"); const rows = data.applications || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Teachers</div><h2>Teacher Applications</h2><p>Keep candidates separate from staff accounts until you approve them.</p></div><button id="addTeacherCandidate" class="dash-btn dash-btn-primary">${I.plus} Add Candidate</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Candidate</th><th>Contact</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>${rows.length ? rows.map((a) => `<tr><td><strong>${esc(a.full_name)}</strong><small>${esc((a.message || "").slice(0, 100))}</small></td><td>${esc(a.email || "—")}<small>${esc(a.phone || "")}</small></td><td>${fmtDate(a.created_at)}</td><td><span class="dash-pill ${pillFor(a.status)}">${esc(a.status)}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-teacher-app="${a.id}">${a.status === "pending" ? "Review" : "View"}</button></td></tr>`).join("") : emptyRow(5, "No teacher candidates yet. Add applications received by email or in person.")}</tbody></table></div></div>`;
    content.querySelector("#addTeacherCandidate").addEventListener("click", () => openTeacherCandidateModal());
    content.querySelectorAll("[data-teacher-app]").forEach((b) => b.addEventListener("click", () => openTeacherApplicationModal(Number(b.dataset.teacherApp), rows.find((a) => Number(a.id) === Number(b.dataset.teacherApp)))));
  }
  function openTeacherCandidateModal() {
    const modal = openModal("Add teacher candidate", `<form id="candidateForm"><div class="dash-form-grid"><div class="dash-field"><label>Full Name</label><input name="full_name" required></div><div class="dash-field"><label>Email</label><input name="email" type="email"></div><div class="dash-field"><label>Phone</label><input name="phone"></div><div class="dash-field" style="grid-column:1/-1"><label>Application / interview notes</label><textarea name="message"></textarea></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Add candidate</button></form>`);
    modal.querySelector("#candidateForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.post("/teachers/applications", Object.fromEntries(fd)); toast("Teacher candidate added.", "success"); closeModal(); pageTeacherApplications(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not add candidate.", "error"); } });
  }
  async function openTeacherApplicationModal(id, app) {
    const base = await catalogue(); const modal = openModal(`Teacher application — ${app.full_name}`, `<p class="dash-info-line">${esc(app.message || "No application note was added.")}</p><form id="reviewTeacherApp"><div class="dash-form-grid"><div class="dash-field"><label>Review status</label><select name="status"><option value="pending" ${app.status === "pending" ? "selected" : ""}>Pending</option><option value="on_hold" ${app.status === "on_hold" ? "selected" : ""}>On hold</option><option value="rejected" ${app.status === "rejected" ? "selected" : ""}>Rejected</option></select></div><div class="dash-field"><label>Review note</label><input name="review_note" value="${esc(app.review_note || "")}"></div></div><button type="submit" class="dash-btn dash-btn-ghost" style="margin-top:14px">Save review</button></form>${app.status !== "approved" ? `<hr class="dash-rule"><h4>Create teacher account</h4><form id="approveTeacherApp"><div class="dash-form-grid"><div class="dash-field"><label>Username</label><input name="username" required minlength="3"></div><div class="dash-field"><label>Temporary Password</label><input name="password" required minlength="8" type="password"></div></div><div class="dash-field" style="margin-top:14px"><label>Assignments</label><div id="candidateAssignments"></div><button id="candidateAddAssign" class="dash-btn dash-btn-ghost dash-btn-sm" type="button" style="margin-top:8px">${I.plus} Add assignment</button></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">Approve & create teacher</button></form>` : `<p class="dash-info-line">This candidate is now a teacher account.</p>`}`);
    modal.querySelector("#reviewTeacherApp").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.patch(`/teachers/applications/${id}`, Object.fromEntries(fd)); toast("Review saved.", "success"); closeModal(); pageTeacherApplications(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not save review.", "error"); } });
    const list = modal.querySelector("#candidateAssignments");
    const add = () => { const row = document.createElement("div"); row.className = "dash-assignment-row"; row.innerHTML = `<select class="assign-class"><option value="">All classes</option>${options(base.classes)}</select><select class="assign-subject"><option value="">All subjects</option>${options(base.subjects)}</select><button class="dash-icon-btn" type="button">${I.close}</button>`; row.querySelector("button").addEventListener("click", () => row.remove()); list.appendChild(row); };
    const approve = modal.querySelector("#approveTeacherApp"); if (approve) { modal.querySelector("#candidateAddAssign").addEventListener("click", add); add(); approve.addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const body = { username: fd.get("username"), password: fd.get("password"), review_note: app.review_note || "", assignments: [...list.querySelectorAll(".dash-assignment-row")].map((row) => ({ class_id: row.querySelector(".assign-class").value || null, subject_id: row.querySelector(".assign-subject").value || null })) }; try { await window.API.post(`/teachers/applications/${id}/approve`, body); toast("Candidate approved and teacher account created.", "success"); closeModal(); pageTeacherApplications(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not approve candidate.", "error"); } }); }
  }

  /* ============================ CLASSES ================================ */
  async function pageClasses(content) {
    const [data, subs] = await Promise.all([window.API.get("/classes"), window.API.get("/subjects")]); const classes = data.classes || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>All Classes</h2><p>Set up each group, then attach the subjects it studies.</p></div><button class="dash-btn dash-btn-primary" data-nav-route="classes/add">${I.plus} Add Class</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Class</th><th>Students</th><th>Subjects</th><th>Manage</th></tr></thead><tbody>${classes.length ? classes.map((c) => `<tr><td><strong>${esc(c.name_en)}</strong>${c.name_ar ? `<small class="dash-ar">${esc(c.name_ar)}</small>` : ""}</td><td>${Number(c.student_count || 0)}</td><td>${esc((c.subjects || []).map((s) => s.name_en).join(", ") || "No subjects yet")}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-class-manage="${c.id}">${I.edit} Manage</button></td></tr>`).join("") : emptyRow(4, "No classes have been created.")}</tbody></table></div></div>`;
    content.querySelectorAll("[data-class-manage]").forEach((b) => b.addEventListener("click", () => openClassModal(Number(b.dataset.classManage), classes, subs.subjects || []))); bindRouteButtons(content);
  }
  async function pageClassForm(content) {
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Add Class</h2><p>Create a class first, then add subjects and assign students/teachers.</p></div></div><div class="dash-card"><div class="dash-card-pad"><form id="classForm"><div class="dash-form-grid"><div class="dash-field"><label>Class Name (English) <span class="req">*</span></label><input name="name_en" required></div><div class="dash-field"><label>Class Name (Arabic)</label><input name="name_ar" dir="rtl"></div><div class="dash-field"><label>Display order</label><input name="sort_order" type="number" min="0" value="0"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Create Class</button></form></div></div>`;
    content.querySelector("#classForm").addEventListener("submit", async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); try { await window.API.post("/classes", body); toast("Class created.", "success"); go("classes/all"); } catch (err) { toast(err.message || "Could not create class.", "error"); } });
  }
  function openClassModal(id, classes, subjects) {
    const c = classes.find((x) => Number(x.id) === id); if (!c) return; const chosen = new Set((c.subjects || []).map((s) => Number(s.id)));
    const modal = openModal(`Manage ${c.name_en}`, `<form id="classEdit"><div class="dash-form-grid"><div class="dash-field"><label>Class Name (English)</label><input name="name_en" value="${esc(c.name_en)}"></div><div class="dash-field"><label>Class Name (Arabic)</label><input name="name_ar" dir="rtl" value="${esc(c.name_ar)}"></div><div class="dash-field"><label>Display order</label><input name="sort_order" type="number" min="0" value="${esc(c.sort_order)}"></div><div class="dash-field"><label>Class status</label><select name="is_active"><option value="true" ${c.is_active ? "selected" : ""}>Active</option><option value="false" ${!c.is_active ? "selected" : ""}>Inactive</option></select></div></div><div class="dash-field" style="margin-top:14px"><label>Subjects for this class</label><div class="dash-check-grid">${subjects.length ? subjects.map((s) => `<label><input type="checkbox" name="subjects" value="${s.id}" ${chosen.has(Number(s.id)) ? "checked" : ""}> ${esc(s.name_en)}</label>`).join("") : "No subjects yet — add one in the Subjects menu."}</div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save Class</button></form><hr class="dash-rule"><button class="dash-btn dash-btn-danger" type="button" id="deleteClass">${I.trash} Delete class</button>`);
    modal.querySelector("#classEdit").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.patch(`/classes/${id}`, { name_en: fd.get("name_en"), name_ar: fd.get("name_ar"), sort_order: fd.get("sort_order"), is_active: fd.get("is_active") === "true" }); await window.API.put(`/classes/${id}/subjects`, { subject_ids: fd.getAll("subjects") }); toast("Class saved.", "success"); closeModal(); pageClasses(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not save class.", "error"); } });
    modal.querySelector("#deleteClass").addEventListener("click", async () => { if (!window.confirm("Delete this empty class? Students must be moved first.")) return; try { await window.API.del(`/classes/${id}`); toast("Class deleted.", "success"); closeModal(); pageClasses(document.querySelector("#dashContent")); } catch (err) { toast(err.message || "Could not delete class.", "error"); } });
  }

  async function pageClassRoster(content) {
    const classesData = await window.API.get("/classes"); const classes = classesData.classes || []; const selected = state.cache.rosterClassId || (classes[0] && classes[0].id) || "";
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Class Students</h2><p>View each class roster and jump directly to a student record.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-field" style="max-width:420px"><label>Class</label><select id="rosterClass"><option value="">Select class</option>${options(classes, selected)}</select></div><div id="rosterResult" style="margin-top:16px"></div></div></div>`;
    const load = async () => { const cid = content.querySelector("#rosterClass").value; const out = content.querySelector("#rosterResult"); if (!cid) return out.innerHTML = ""; const data = await window.API.get(`/students?classId=${encodeURIComponent(cid)}&perPage=200`); out.innerHTML = `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Admission No.</th><th>Student</th><th>Status</th><th></th></tr></thead><tbody>${data.students.length ? data.students.map((s) => `<tr><td>${esc(s.admission_no)}</td><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td><span class="dash-pill ${pillFor(s.status)}">${esc(s.status)}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-student="${s.id}">Open</button></td></tr>`).join("") : emptyRow(4, "This class has no students.")}</tbody></table></div>`; out.querySelectorAll("[data-student]").forEach((b) => b.addEventListener("click", () => openStudentModal(Number(b.dataset.student), classes))); };
    content.querySelector("#rosterClass").addEventListener("change", () => { state.cache.rosterClassId = Number(content.querySelector("#rosterClass").value); load(); }); if (selected) load();
  }

  async function pageClassTeacherRoster(content) {
    const data = await window.API.get("/teachers"); const classes = data.classes || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Class Teachers</h2><p>Teaching assignments by class and subject.</p></div><button class="dash-btn dash-btn-primary" data-nav-route="teachers/add">${I.plus} Add Teacher</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Class</th><th>Assigned Teachers</th></tr></thead><tbody>${classes.length ? classes.map((c) => { const assigned = (data.teachers || []).flatMap((t) => (t.assignments || []).filter((a) => Number(a.classId) === Number(c.id) || !a.classId).map((a) => `${t.full_name}${a.subject ? ` — ${a.subject.name_en}` : ""}`)); return `<tr><td>${esc(c.name_en)}</td><td>${esc(assigned.join(", ") || "No teachers assigned")}</td></tr>`; }).join("") : emptyRow(2, "No classes have been created.")}</tbody></table></div></div>`; bindRouteButtons(content);
  }

  async function pageSubjectDetail(content, categoryName, detailId) {
    if (detailId) {
      const data = await window.API.get(`/subjects/${encodeURIComponent(detailId)}`);
      const subject = data.subject;
      const stat = (value, label) => `<div class="dash-kpi-line"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
      content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic Programs / ${esc(subject.category || "Other Subjects")}</div><h2>${esc(subject.name_en)}</h2><p>${esc(subject.description || "Manage the subject catalogue, teaching assignments and connected academic records from one place.")}</p></div><div class="dash-actions"><button id="assignSubjectClasses" class="dash-btn dash-btn-ghost">${I.classes} Assign classes</button><button id="assignSubjectTeachers" class="dash-btn dash-btn-ghost">${I.teacher} Assign teachers</button><button id="editSubject" class="dash-btn dash-btn-primary">${I.edit} Edit subject</button><button id="archiveSubject" class="dash-btn dash-btn-ghost">${subject.status === "archived" ? "Activate" : "Archive"}</button><button id="deleteSubject" class="dash-btn dash-btn-danger">${I.trash} Delete</button></div></div>
        <div class="dash-stats-grid">${stat(subject.subject_code || "—", "Code")}${stat(subject.category || "Other Subjects", "Category")}${stat(subject.education_track || "both", "Education track")}${stat(data.students.length, "Enrolled students")}</div>
        <div class="dash-grid-2" style="margin-top:18px"><div class="dash-card"><div class="dash-card-head"><h3>Overview</h3></div><div class="dash-card-pad"><div class="dash-detail-grid"><div><small>Academic level</small><strong>${esc(subject.academic_level || "—")}</strong></div><div><small>Status</small><strong><span class="dash-pill ${pillFor(subject.status)}">${esc(subject.status || "active")}</span></strong></div><div style="grid-column:1/-1"><small>Description</small><p>${esc(subject.description || "No description added yet.")}</p></div></div></div></div><div class="dash-card"><div class="dash-card-head"><h3>Classes & teachers</h3></div><div class="dash-card-pad"><p class="hint">${data.classes.length} class(es) · ${data.teachers.length} teacher assignment(s)</p>${data.teachers.length ? `<div class="dash-chip-list">${data.teachers.map((teacher) => `<span class="dash-chip">${esc(teacher.full_name)}${teacher.class_name ? ` · ${esc(teacher.class_name)}` : ""}</span>`).join("")}</div>` : `<p class="hint">No teachers assigned yet.</p>`}</div></div></div>
        <div class="dash-card" style="margin-top:18px"><div class="dash-card-head"><h3>Classes offering this subject</h3><span class="hint">Session and term links remain on the shared class catalogue.</span></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Class</th><th>Students</th><th>Academic session</th><th>Term</th></tr></thead><tbody>${data.classes.length ? data.classes.map((row) => `<tr><td><strong>${esc(row.name_en)}</strong></td><td>${Number(row.student_count || 0)}</td><td>${esc(row.subject_session_id || subject.session_id || "—")}</td><td>${esc(row.subject_term_id || subject.term_id || "—")}</td></tr>`).join("") : emptyRow(4, "Assign this subject to a class to see its students here.")}</tbody></table></div></div>
        <div class="dash-grid-2" style="margin-top:18px"><div class="dash-card"><div class="dash-card-head"><h3>Timetable</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Day</th><th>Period</th><th>Teacher</th><th>Classroom</th></tr></thead><tbody>${data.timetable.length ? data.timetable.map((row) => `<tr><td>${esc(row.day)}</td><td>${esc(row.period)}</td><td>${esc(row.teacher_name || "—")}</td><td>${esc(row.room || "—")}</td></tr>`).join("") : emptyRow(4, "No timetable slots yet.")}</tbody></table></div></div><div class="dash-card"><div class="dash-card-head"><h3>Academic activity</h3></div><div class="dash-card-pad"><div class="dash-kpi-line"><strong>${data.lessons.length}</strong><span>Lessons</span></div><div class="dash-kpi-line"><strong>${data.assignments.length}</strong><span>Assignments</span></div><div class="dash-kpi-line"><strong>${data.exams.length}</strong><span>Exams</span></div><div class="dash-kpi-line"><strong>${data.results.length}</strong><span>Result records</span></div></div></div></div>
        <div class="dash-card" style="margin-top:18px"><div class="dash-card-head"><h3>Students taking ${esc(subject.name_en)}</h3></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Admission No.</th><th>Student</th><th>Class</th></tr></thead><tbody>${data.students.length ? data.students.map((row) => `<tr><td>${esc(row.admission_no)}</td><td>${esc(`${row.first_name} ${row.last_name}`.trim())}</td><td>${esc(row.class_name || "—")}</td></tr>`).join("") : emptyRow(3, "No enrolled students yet.")}</tbody></table></div></div>`;
      const edit = () => openSubjectModal(subject, () => pageSubjectDetail(content, categoryName, detailId));
      content.querySelector("#editSubject").addEventListener("click", edit);
      content.querySelector("#assignSubjectClasses").addEventListener("click", () => {
        const modal = openModal(`Assign ${subject.name_en} to classes`, `<form id="subjectClassesForm"><p class="hint">A class linked here automatically exposes the subject to its enrolled students, results and report cards.</p><div class="dash-check-grid">${data.classes.map((row) => `<label><input type="checkbox" name="class_id" value="${row.id}" ${data.classes.some((current) => Number(current.id) === Number(row.id)) ? "checked" : ""}> ${esc(row.name_en)}</label>`).join("")}</div><button class="dash-btn dash-btn-primary" style="margin-top:14px" type="submit">${I.check} Save class assignments</button></form>`);
        modal.querySelector("#subjectClassesForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await window.API.put(`/subjects/${subject.id}/classes`, { class_ids: [...event.target.querySelectorAll("[name=class_id]:checked")].map((input) => Number(input.value)) }); closeModal(); toast("Class assignments saved.", "success"); pageSubjectDetail(content, categoryName, detailId); } catch (err) { toast(err.message || "Could not assign classes.", "error"); } });
      });
      content.querySelector("#assignSubjectTeachers").addEventListener("click", async () => {
        const teacherData = await window.API.get("/teachers");
        const rows = data.teachers.length ? data.teachers : [{ user_id: "", class_id: "", role: "subject_teacher" }];
        const modal = openModal(`Assign teachers · ${subject.name_en}`, `<form id="subjectTeachersForm"><div id="subjectTeacherRows">${rows.map((row, index) => `<div class="dash-assignment-row" data-teacher-row><select class="subject-teacher"><option value="">Select teacher</option>${options(teacherData.teachers || [], row.user_id)}</select><select class="subject-teacher-class"><option value="">All classes</option>${options(data.classes, row.class_id)}</select><input class="subject-teacher-role" value="${esc(row.role || "subject_teacher")}" placeholder="Role"><button type="button" class="dash-icon-btn" data-remove-teacher>${I.close}</button></div>`).join("")}</div><button type="button" id="addSubjectTeacherRow" class="dash-btn dash-btn-ghost dash-btn-sm">${I.plus} Add teacher</button><button class="dash-btn dash-btn-primary" style="margin-top:14px" type="submit">${I.check} Save teacher assignments</button></form>`);
        const addRow = () => { const wrapper = modal.querySelector("#subjectTeacherRows"); const row = document.createElement("div"); row.className = "dash-assignment-row"; row.setAttribute("data-teacher-row", ""); row.innerHTML = `<select class="subject-teacher"><option value="">Select teacher</option>${options(teacherData.teachers || [])}</select><select class="subject-teacher-class"><option value="">All classes</option>${options(data.classes)}</select><input class="subject-teacher-role" value="subject_teacher" placeholder="Role"><button type="button" class="dash-icon-btn" data-remove-teacher>${I.close}</button>`; row.querySelector("[data-remove-teacher]").addEventListener("click", () => row.remove()); wrapper.appendChild(row); };
        modal.querySelector("#addSubjectTeacherRow").addEventListener("click", addRow); modal.querySelectorAll("[data-remove-teacher]").forEach((button) => button.addEventListener("click", () => button.closest("[data-teacher-row]").remove()));
        modal.querySelector("#subjectTeachersForm").addEventListener("submit", async (event) => { event.preventDefault(); const teachers = [...modal.querySelectorAll("[data-teacher-row]")].map((row) => ({ user_id: row.querySelector(".subject-teacher").value, class_id: row.querySelector(".subject-teacher-class").value || null, role: row.querySelector(".subject-teacher-role").value })).filter((row) => row.user_id); try { await window.API.put(`/subjects/${subject.id}/teachers`, { teachers }); closeModal(); toast("Teacher assignments saved.", "success"); pageSubjectDetail(content, categoryName, detailId); } catch (err) { toast(err.message || "Could not assign teachers.", "error"); } });
      });
      content.querySelector("#archiveSubject").addEventListener("click", async () => { const archived = subject.status !== "archived"; if (!window.confirm(`${archived ? "Archive" : "Activate"} this subject?`)) return; try { await window.API.patch(`/subjects/${subject.id}`, { status: archived ? "archived" : "active" }); toast(`Subject ${archived ? "archived" : "activated"}.`, "success"); pageSubjectDetail(content, categoryName, detailId); } catch (err) { toast(err.message || "Could not update subject.", "error"); } });
      content.querySelector("#deleteSubject").addEventListener("click", async () => { if (!window.confirm("Delete this subject and its class links? Subjects with results must be archived instead.")) return; try { await window.API.del(`/subjects/${subject.id}`); toast("Subject deleted.", "success"); go(`subjects/${encodeURIComponent(categoryName || subject.category || "Other Subjects")}`); } catch (err) { toast(err.message || "Could not delete subject.", "error"); } });
      return;
    }

    const category = categoryName || "Other Subjects";
    let data = await window.API.get(`/subjects?category=${encodeURIComponent(category)}&includeArchived=true`);
    let subjects = data.subjects || [];
    let subjectPage = 1;
    const subjectPageSize = 12;
    const render = () => {
      const search = content.querySelector("#subjectSearch")?.value.trim().toLowerCase() || "";
      const track = content.querySelector("#subjectTrack")?.value || "";
      const status = content.querySelector("#subjectStatus")?.value || "";
      const rows = subjects.filter((row) => (!search || [row.name_en, row.name_ar, row.subject_code, row.description].join(" ").toLowerCase().includes(search)) && (!track || row.education_track === track) && (!status || row.status === status));
      const pageCount = Math.max(1, Math.ceil(rows.length / subjectPageSize));
      subjectPage = Math.min(subjectPage, pageCount);
      const visibleRows = rows.slice((subjectPage - 1) * subjectPageSize, subjectPage * subjectPageSize);
      const body = content.querySelector("#subjectRows");
      if (body) body.innerHTML = visibleRows.length ? visibleRows.map((row) => `<tr><td><button class="dash-link-btn" data-open-subject="${row.id}"><strong>${esc(row.name_en)}</strong></button><small>${esc(row.description || "")}</small></td><td>${esc(row.subject_code || "—")}</td><td>${esc(row.education_track || "both")}</td><td>${Number(row.class_count || 0)}</td><td>${Number(row.teacher_count || 0)}</td><td>${Number(row.student_count || 0)}</td><td><span class="dash-pill ${pillFor(row.status)}">${esc(row.status || "active")}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-open-subject="${row.id}">${I.edit} Manage</button></td></tr>`).join("") : emptyRow(8, "No subjects match this category and filter.");
      body?.querySelectorAll("[data-open-subject]").forEach((button) => button.addEventListener("click", () => go(`subjects/detail/${button.dataset.openSubject}`)));
      const pagination = content.querySelector("#subjectPagination");
      if (pagination) { pagination.innerHTML = rows.length > subjectPageSize ? `<button class="dash-btn dash-btn-ghost dash-btn-sm" ${subjectPage <= 1 ? "disabled" : ""} data-subject-page="prev">Previous</button><span class="hint">Page ${subjectPage} of ${pageCount}</span><button class="dash-btn dash-btn-ghost dash-btn-sm" ${subjectPage >= pageCount ? "disabled" : ""} data-subject-page="next">Next</button>` : ""; pagination.querySelector("[data-subject-page=prev]")?.addEventListener("click", () => { subjectPage--; render(); }); pagination.querySelector("[data-subject-page=next]")?.addEventListener("click", () => { subjectPage++; render(); }); }
    };
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">${esc(T().subjectsLabel)}</div><h2>${esc(category)}</h2><p>Manage real subject records shared by classes, teachers, timetable, lessons, assignments, exams, results and report cards.</p></div><button id="addCustomSubject" class="dash-btn dash-btn-primary">${I.plus} Add subject</button></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Search subjects</label><input id="subjectSearch" type="search" placeholder="Name, code or description"></div><div class="dash-field"><label>Education track</label><select id="subjectTrack"><option value="">All tracks</option><option value="islamic">Islamic</option><option value="western">Western</option><option value="both">Both</option></select></div><div class="dash-field"><label>Status</label><select id="subjectStatus"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div></div></div></div><div class="dash-card" style="margin-top:18px"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Subject</th><th>Code</th><th>Track</th><th>Classes</th><th>Teachers</th><th>Students</th><th>Status</th><th></th></tr></thead><tbody id="subjectRows"></tbody></table></div><div id="subjectPagination" class="dash-actions" style="justify-content:center;padding:12px 14px"></div></div></div>`;
    ["#subjectSearch", "#subjectTrack", "#subjectStatus"].forEach((selector) => content.querySelector(selector).addEventListener("input", () => { subjectPage = 1; render(); }));
    const addButton = content.querySelector("#addCustomSubject");
    addButton.addEventListener("click", () => openSubjectModal({ category }, async () => { data = await window.API.get(`/subjects?category=${encodeURIComponent(category)}&includeArchived=true`); subjects = data.subjects || []; render(); }));
    render();
  }

  function openSubjectModal(subject, done) {
    const isEdit = Boolean(subject && subject.id);
    const modal = openModal(isEdit ? `Edit subject · ${subject.name_en}` : "Create academic subject", `<form id="customSubjectForm"><div class="dash-form-grid"><div class="dash-field"><label>Subject name <span class="req">*</span></label><input name="name_en" required maxlength="120" value="${esc(subject?.name_en || "")}"></div><div class="dash-field"><label>Subject code</label><input name="subject_code" maxlength="60" value="${esc(subject?.subject_code || "")}" placeholder="e.g. MATH-JSS1"></div><div class="dash-field"><label>Category</label><select name="category">${["Mathematics", "English", "Sciences", "Computer Science", "Technology", "Business", "Arts", "Social Sciences", "Languages", "Other Subjects"].map((category) => `<option value="${esc(category)}" ${category === (subject?.category || "Other Subjects") ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></div><div class="dash-field"><label>Education track</label><select name="education_track"><option value="islamic" ${subject?.education_track === "islamic" ? "selected" : ""}>Islamic</option><option value="western" ${subject?.education_track === "western" ? "selected" : ""}>Western</option><option value="both" ${!subject?.education_track || subject?.education_track === "both" ? "selected" : ""}>Both</option></select></div><div class="dash-field"><label>Academic level</label><input name="academic_level" value="${esc(subject?.academic_level || "")}" placeholder="Primary, JSS 1, Senior"></div><div class="dash-field"><label>Status</label><select name="status"><option value="active" ${!subject?.status || subject.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${subject?.status === "inactive" ? "selected" : ""}>Inactive</option><option value="archived" ${subject?.status === "archived" ? "selected" : ""}>Archived</option></select></div><div class="dash-field" style="grid-column:1/-1"><label>Description</label><textarea name="description" maxlength="5000">${esc(subject?.description || "")}</textarea></div></div><div class="dash-modal-foot" style="margin:18px -22px -20px;border-top:1px solid var(--d-line)"><button type="button" id="cancelAcademicSubject" class="dash-btn dash-btn-ghost">Cancel</button><button type="submit" class="dash-btn dash-btn-primary">${I.check} ${isEdit ? "Save changes" : "Create subject"}</button></div></form>`);
    modal.querySelector("#cancelAcademicSubject").addEventListener("click", closeModal);
    modal.querySelector("#customSubjectForm").addEventListener("submit", async (event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.target)); if (!isEdit && subject?.category && !["Mathematics", "English", "Sciences", "Computer Science", "Technology", "Business", "Arts", "Social Sciences", "Languages", "Other Subjects"].includes(subject.category)) payload.category = subject.category; try { const response = isEdit ? await window.API.patch(`/subjects/${subject.id}`, payload) : await window.API.post("/subjects", payload); closeModal(); toast(isEdit ? "Subject updated." : "Subject created.", "success"); if (done) await done(response); } catch (err) { toast(err.message || "Could not save subject.", "error"); } });
  }

  /* ===================== QUR'AN / HIFZ PROGRESS ======================= */
  function quranViewMeta(route) {
    const view = route.split("/").pop();
    return {
      progress: ["Qur'an Progress", "Record recitation, memorization and revision milestones for each learner."],
      memorization: ["Memorization", "Follow Hifz memorization progress, ayah range and teacher assessment."],
      revision: ["Revision", "Track revision consistency alongside memorization milestones."],
      tajweed: ["Tajweed", "Review recitation and Tajweed assessments from the teaching team."],
      reports: ["Islamic Academic Reports", "A clear overview of active Qur'an and Hifz learning records."],
    }[view] || ["Qur'an Progress", "Track each learner's Qur'an learning journey."];
  }

  async function pageQuranProgress(content, route) {
    const meta = quranViewMeta(route);
    let config;
    try { config = await window.API.get("/quran-progress/config"); }
    catch (err) {
      content.innerHTML = `<div class="dash-card"><div class="dash-coming-soon"><div class="icon">${I.close}</div><h3>Qur'an progress is unavailable</h3><p>${esc(err.message || "This module is only available to Islamic institutions.")}</p></div></div>`;
      return;
    }
    if (!config.enabled) {
      content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Qur'an / Islamic Education</div><h2>${esc(meta[0])}</h2><p>Hifz tracking is currently switched off for this institution.</p></div></div>
        <div class="dash-card"><div class="dash-card-pad"><div class="dash-empty-state"><div class="dash-empty-state-icon">${I.book}</div><h3>Enable Qur'an / Hifz tracking</h3><p>When enabled, administrators and assigned teachers can record Surah, Juz, ayah ranges, memorization, revision, recitation, Tajweed and comments for individual students.</p><button id="enableHifz" class="dash-btn dash-btn-primary">${I.check} Enable Hifz tracking</button></div></div></div>`;
      content.querySelector("#enableHifz").addEventListener("click", async () => {
        try { await window.API.put("/quran-progress/config", { enabled: true }); toast("Qur'an / Hifz tracking enabled.", "success"); pageQuranProgress(content, route); }
        catch (err) { toast(err.message || "Could not enable Hifz tracking.", "error"); }
      });
      return;
    }

    const [studentsData, overview, recordData] = await Promise.all([
      window.API.get("/students?perPage=200"),
      window.API.get("/quran-progress/overview"),
      window.API.get("/quran-progress?limit=250"),
    ]);
    const students = studentsData.students || [];
    const selectedStudent = state.cache.quranStudentId || "";
    const allRecords = recordData.records || [];
    const view = route.split("/").pop();
    const displayRecords = selectedStudent ? allRecords.filter((record) => Number(record.student_id) === Number(selectedStudent)) : allRecords;
    const total = overview.totals || {};
    const statusRows = overview.byStatus || [];
    const statusCopy = statusRows.length ? statusRows.map((row) => `${row.status.replace(/_/g, " ")}: ${row.count}`).join(" · ") : "No assessments recorded yet";
    const addAllowed = view !== "reports";

    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Qur'an / Islamic Education</div><h2>${esc(meta[0])}</h2><p>${esc(meta[1])}</p></div>
        <div class="dash-actions">${addAllowed ? `<button id="addQuranProgress" class="dash-btn dash-btn-primary">${I.plus} Record progress</button>` : ""}<button id="disableHifz" class="dash-btn dash-btn-ghost">${I.settings} Hifz settings</button></div></div>
      <div class="dash-stats-grid">
        ${statCard("users", total.students || 0, "Students tracked")}
        ${statCard("book", total.records || 0, "Progress entries")}
        ${statCard("activity", `${total.memorizationAverage || 0}%`, "Average memorization", true)}
        ${statCard("refresh", `${total.revisionAverage || 0}%`, "Average revision")}
      </div>
      <div class="dash-card" style="margin-bottom:18px"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Student</label><select id="quranStudent"><option value="">All students</option>${options(students, selectedStudent, (student) => `${student.admission_no} — ${student.first_name} ${student.last_name}`)}</select></div><div class="dash-field"><label>Performance snapshot</label><div class="dash-info-line" style="margin-top:0">${esc(statusCopy)}</div></div></div></div></div>
      <div class="dash-card"><div class="dash-card-head"><h3>Recent progress</h3><span class="hint">${displayRecords.length} record(s)</span></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Date</th><th>Student</th><th>Surah / Juz</th><th>Ayah</th><th>Memorization</th><th>Revision</th><th>Recitation</th><th>Tajweed</th><th>Status</th><th></th></tr></thead><tbody>
        ${displayRecords.length ? displayRecords.map((record) => `<tr><td>${fmtDate(record.progress_date)}</td><td><strong>${esc(record.first_name)} ${esc(record.last_name)}</strong><small>${esc(record.class_en || "Unassigned")}</small></td><td>${esc([record.surah, record.juz].filter(Boolean).join(" · ") || "—")}</td><td>${record.ayah_from || record.ayah_to ? `${esc(record.ayah_from || "?")}–${esc(record.ayah_to || "?")}` : "—"}</td><td>${Number(record.memorization_progress || 0)}%</td><td>${Number(record.revision_progress || 0)}%</td><td>${record.recitation_assessment ? `${record.recitation_assessment}/5` : "—"}</td><td>${record.tajweed_assessment ? `${record.tajweed_assessment}/5` : "—"}</td><td><span class="dash-pill ${record.performance_status === "excellent" || record.performance_status === "good" ? "ok" : record.performance_status === "needs_support" || record.performance_status === "needs_revision" ? "warn" : "info"}">${esc((record.performance_status || "developing").replace(/_/g, " "))}</span></td><td><button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-quran="${record.id}" title="Delete progress record">${I.trash}</button></td></tr>`).join("") : emptyRow(10, selectedStudent ? "No Qur'an progress has been recorded for this student." : "No Qur'an / Hifz progress has been recorded yet.")}
      </tbody></table></div></div>`;

    content.querySelector("#quranStudent").addEventListener("change", () => {
      state.cache.quranStudentId = content.querySelector("#quranStudent").value ? Number(content.querySelector("#quranStudent").value) : null;
      pageQuranProgress(content, route);
    });
    const settingButton = content.querySelector("#disableHifz");
    settingButton.addEventListener("click", () => openHifzSettingsModal(content, route));
    const add = content.querySelector("#addQuranProgress");
    if (add) add.addEventListener("click", () => openQuranProgressModal(students, selectedStudent, content, route));
    content.querySelectorAll("[data-delete-quran]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Delete this Qur'an progress record?")) return;
      try { await window.API.del(`/quran-progress/${button.dataset.deleteQuran}`); toast("Progress record deleted.", "success"); pageQuranProgress(content, route); }
      catch (err) { toast(err.message || "Could not delete progress record.", "error"); }
    }));
  }

  function openHifzSettingsModal(content, route) {
    const modal = openModal("Qur'an / Hifz tracking settings", `<div class="dash-empty-state"><div class="dash-empty-state-icon">${I.book}</div><h3>Hifz tracking is enabled</h3><p>Disabling it hides the Qur'an progress workspace and prevents new progress entries. Existing records stay safely stored until it is enabled again.</p><button id="confirmDisableHifz" class="dash-btn dash-btn-danger">Disable Hifz tracking</button></div>`);
    modal.querySelector("#confirmDisableHifz").addEventListener("click", async () => {
      try { await window.API.put("/quran-progress/config", { enabled: false }); closeModal(); toast("Hifz tracking disabled. Existing records were kept.", "success"); pageQuranProgress(content, route); }
      catch (err) { toast(err.message || "Could not update Hifz tracking.", "error"); }
    });
  }

  function openQuranProgressModal(students, selectedStudent, content, route) {
    const modal = openModal("Record Qur'an / Hifz progress", `<form id="quranProgressForm"><div class="dash-form-grid">
      <div class="dash-field" style="grid-column:1/-1"><label>Student <span class="req">*</span></label><select name="student_id" required><option value="">Select student</option>${options(students, selectedStudent, (student) => `${student.admission_no} — ${student.first_name} ${student.last_name}`)}</select></div>
      <div class="dash-field"><label>Date</label><input name="progress_date" type="date" value="${todayIso()}" required></div><div class="dash-field"><label>Performance status</label><select name="performance_status"><option value="excellent">Excellent</option><option value="good" selected>Good</option><option value="developing">Developing</option><option value="needs_support">Needs support</option><option value="needs_revision">Needs revision</option></select></div>
      <div class="dash-field"><label>Surah</label><input name="surah" placeholder="e.g. Al-Baqarah"></div><div class="dash-field"><label>Juz</label><input name="juz" placeholder="e.g. Juz 1"></div>
      <div class="dash-field"><label>Ayah from</label><input name="ayah_from" type="number" min="1" max="286"></div><div class="dash-field"><label>Ayah to</label><input name="ayah_to" type="number" min="1" max="286"></div>
      <div class="dash-field"><label>Memorization progress (%)</label><input name="memorization_progress" type="number" min="0" max="100" value="0"></div><div class="dash-field"><label>Revision progress (%)</label><input name="revision_progress" type="number" min="0" max="100" value="0"></div>
      <div class="dash-field"><label>Recitation assessment</label><select name="recitation_assessment"><option value="">Not assessed</option>${[1,2,3,4,5].map((n) => `<option value="${n}">${n}/5</option>`).join("")}</select></div><div class="dash-field"><label>Tajweed assessment</label><select name="tajweed_assessment"><option value="">Not assessed</option>${[1,2,3,4,5].map((n) => `<option value="${n}">${n}/5</option>`).join("")}</select></div>
      <div class="dash-field" style="grid-column:1/-1"><label>Teacher comments</label><textarea name="teacher_comments" maxlength="3000" placeholder="Specific feedback, next revision target or recitation notes…"></textarea></div>
    </div><div class="dash-modal-foot" style="margin:18px -22px -20px;border-top:1px solid var(--d-line)"><button class="dash-btn dash-btn-ghost" type="button" id="cancelQuranProgress">Cancel</button><button class="dash-btn dash-btn-primary" type="submit">${I.check} Save progress</button></div></form>`);
    modal.querySelector("#cancelQuranProgress").addEventListener("click", closeModal);
    modal.querySelector("#quranProgressForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      try { await window.API.post("/quran-progress", Object.fromEntries(form)); closeModal(); toast("Qur'an progress recorded.", "success"); pageQuranProgress(content, route); }
      catch (err) { toast(err.message || "Could not save Qur'an progress.", "error"); }
    });
  }

  /* ============================ TIMETABLE ============================== */
  async function pageTimetableManager(content) {
    const [catalog, teacherData] = await Promise.all([catalogue(), window.API.get("/teachers").catch(() => ({ teachers: [] }))]);
    const selected = state.cache.timetableClassId || (catalog.classes[0] && catalog.classes[0].id) || "";
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Class Timetable</h2><p>Build the weekly timetable for one class. Changes replace that class’s selected term timetable.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Class</label><select id="timetableClass"><option value="">Select class</option>${options(catalog.classes, selected)}</select></div><div class="dash-field"><label>Term</label><select id="timetableTerm"><option value="">Current term</option>${options(allTerms(catalog.sessions), "", (t) => `${t.session_label} — ${t.name_en}`)}</select></div></div><div id="timetableEditor" style="margin-top:18px"></div></div></div>`;
    const load = async () => {
      const classId = content.querySelector("#timetableClass").value; const termId = content.querySelector("#timetableTerm").value; const out = content.querySelector("#timetableEditor"); if (!classId) return out.innerHTML = "";
      state.cache.timetableClassId = Number(classId); let grid;
      try { grid = await window.API.get(`/timetable?classId=${encodeURIComponent(classId)}${termId ? `&termId=${encodeURIComponent(termId)}` : ""}`); } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not load timetable.")}</p>`; return; }
      const found = (day, period) => (grid.slots || []).find((s) => s.day === day && Number(s.period) === Number(period)) || {};
      out.innerHTML = `<div class="dash-table-wrap"><table class="dash-table dash-timetable-edit"><thead><tr><th>Day / Period</th><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>${(grid.days || []).flatMap((day) => (grid.periods || []).map((p) => { const slot = found(day, p.period); return `<tr data-day="${day}" data-period="${p.period}"><td><strong>${day}</strong> · Period ${p.period}</td><td><input class="slot-start" type="time" value="${esc(slot.startTime || p.start || "")}"> <input class="slot-end" type="time" value="${esc(slot.endTime || p.end || "")}"></td><td><select class="slot-subject"><option value="">— No class —</option>${options(catalog.subjects, slot.subjectId)}</select></td><td><select class="slot-teacher"><option value="">—</option>${options(teacherData.teachers || [], slot.teacherId, (t) => t.full_name)}</select></td><td><input class="slot-room" value="${esc(slot.room || "")}" placeholder="Room"></td></tr>`; })).join("")}</tbody></table></div><div class="dash-actions" style="margin-top:16px"><button id="saveTimetable" class="dash-btn dash-btn-primary">${I.check} Save timetable</button><a class="dash-btn dash-btn-ghost" href="${window.API.url(`/timetable/print?classId=${encodeURIComponent(classId)}${termId ? `&termId=${encodeURIComponent(termId)}` : ""}`)}" target="_blank" rel="noopener">${I.external} Print</a></div>`;
      out.querySelector("#saveTimetable").addEventListener("click", async () => { const slots = [...out.querySelectorAll("tbody tr")].map((row) => ({ day: row.dataset.day, period: Number(row.dataset.period), startTime: row.querySelector(".slot-start").value, endTime: row.querySelector(".slot-end").value, subjectId: row.querySelector(".slot-subject").value || null, teacherId: row.querySelector(".slot-teacher").value || null, room: row.querySelector(".slot-room").value })).filter((s) => s.subjectId || s.teacherId || s.room); try { const r = await window.API.put("/timetable", { classId: Number(classId), termId: termId ? Number(termId) : undefined, slots }); toast(`${r.saved} timetable slot(s) saved.`, "success"); } catch (err) { toast(err.message || "Could not save timetable.", "error"); } });
    };
    content.querySelector("#timetableClass").addEventListener("change", load); content.querySelector("#timetableTerm").addEventListener("change", load); if (selected) load();
  }

  /* =========================== ATTENDANCE ============================== */
  function termOptions(sessions) { return allTerms(sessions || []); }
  async function pageAttendanceStudents(content) {
    const base = await catalogue();
    const selected = state.cache.attendanceClassId || (base.classes[0] && base.classes[0].id) || "";
    const terms = termOptions(base.sessions);
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Attendance</div><h2>Student Attendance</h2><p>Select a class and date, mark the register quickly, then save a persistent attendance record.</p></div></div>
      <div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Academic session</label><select id="attendanceSession"><option value="">All sessions</option>${options(base.sessions)}</select></div><div class="dash-field"><label>Term / semester</label><select id="attendanceTerm"><option value="">Auto-select by date</option>${options(terms, "", (term) => `${term.session_label} — ${term.name_en}`)}</select></div><div class="dash-field"><label>Class</label><select id="attendanceClass"><option value="">Select class</option>${options(base.classes, selected)}</select></div><div class="dash-field"><label>Date</label><input id="attendanceDate" type="date" value="${todayIso()}"></div></div><div id="studentAttendanceBody" style="margin-top:18px"></div></div></div>`;
    const sessionSelect = content.querySelector("#attendanceSession");
    sessionSelect.addEventListener("change", () => { const sid = sessionSelect.value; const term = content.querySelector("#attendanceTerm"); term.innerHTML = `<option value="">Auto-select by date</option>${options(terms.filter((row) => !sid || String(row.session_id) === String(sid)), "", (row) => `${row.session_label} — ${row.name_en}`)}`; });
    const load = async () => {
      const classId = content.querySelector("#attendanceClass").value; const date = content.querySelector("#attendanceDate").value; const termId = content.querySelector("#attendanceTerm").value; const sessionId = content.querySelector("#attendanceSession").value; const out = content.querySelector("#studentAttendanceBody");
      if (!classId || !date) { out.innerHTML = `<p class="hint">Choose a class and date to open the attendance register.</p>`; return; }
      state.cache.attendanceClassId = Number(classId);
      try {
        const register = await window.API.get(`/attendance?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}${termId ? `&termId=${termId}` : ""}${sessionId ? `&sessionId=${sessionId}` : ""}`);
        const statuses = ["present", "absent", "late", "excused"];
        out.innerHTML = `<div class="dash-card-head" style="padding:0 0 12px"><h3>${esc(register.class?.name_en || "Class")} · ${esc(date)}</h3><span class="hint">${register.students.length} learner(s) · ${register.students.filter((row) => row.status).length} marked</span></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Admission No.</th><th>Student</th><th>Status</th><th>Attendance note</th></tr></thead><tbody>${register.students.length ? register.students.map((student) => `<tr><td>${esc(student.admission_no)}</td><td><strong>${esc(student.first_name)} ${esc(student.last_name)}</strong>${student.name_ar ? `<small class="dash-ar">${esc(student.name_ar)}</small>` : ""}</td><td><select data-attendance-student="${student.id}"><option value="">— Not marked —</option>${statuses.map((status) => `<option value="${status}" ${student.status === status ? "selected" : ""}>${status.charAt(0).toUpperCase() + status.slice(1)}</option>`).join("")}</select></td><td><input data-attendance-note="${student.id}" value="${esc(student.attendance_note || "")}" maxlength="2000" placeholder="Optional note"></td></tr>`).join("") : emptyRow(4, "No active students are assigned to this class.")}</tbody></table></div><div class="dash-actions" style="margin-top:16px"><button id="markAllPresent" class="dash-btn dash-btn-ghost">Mark all present</button><button id="markAllAbsent" class="dash-btn dash-btn-ghost">Mark all absent</button><button id="saveStudentAttendance" class="dash-btn dash-btn-primary">${I.check} Save attendance</button><button id="viewAttendanceHistory" class="dash-btn dash-btn-ghost">${I.activity} View history</button></div><div id="attendanceHistory" style="margin-top:16px"></div>`;
        const selectAll = (status) => out.querySelectorAll("[data-attendance-student]").forEach((select) => { select.value = status; });
        out.querySelector("#markAllPresent").addEventListener("click", () => selectAll("present")); out.querySelector("#markAllAbsent").addEventListener("click", () => selectAll("absent"));
        out.querySelector("#saveStudentAttendance").addEventListener("click", async () => { const values = {}; out.querySelectorAll("[data-attendance-student]").forEach((select) => { if (select.value) values[select.dataset.attendanceStudent] = { status: select.value, note: out.querySelector(`[data-attendance-note="${select.dataset.attendanceStudent}"]`)?.value || "" }; }); try { const result = await window.API.post("/attendance/mark", { classId: Number(classId), date, termId: register.termId || (termId ? Number(termId) : undefined), sessionId: register.sessionId || (sessionId ? Number(sessionId) : undefined), statuses: values }); toast(`${result.saved} attendance record(s) saved.`, "success"); await load(); } catch (err) { toast(err.message || "Could not save attendance.", "error"); } });
        out.querySelector("#viewAttendanceHistory").addEventListener("click", async () => { const history = out.querySelector("#attendanceHistory"); try { const rows = (await window.API.get(`/attendance/history?classId=${classId}&from=${encodeURIComponent(date.slice(0, 7) + "-01")}&to=${encodeURIComponent(date)}`)).records || []; history.innerHTML = `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Date</th><th>Student</th><th>Status</th><th>Note</th><th>Recorded by</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${esc(row.day)}</td><td>${esc(`${row.first_name} ${row.last_name}`.trim())}</td><td><span class="dash-pill ${pillFor(row.status)}">${esc(row.status)}</span></td><td>${esc(row.attendance_note || "—")}</td><td>${esc(row.recorded_by_name || "—")}</td></tr>`).join("") : emptyRow(5, "No attendance history for this period.")}</tbody></table></div>`; } catch (err) { toast(err.message || "Could not load attendance history.", "error"); } });
      } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not load the attendance register.")}</p>`; }
    };
    content.querySelector("#attendanceClass").addEventListener("change", load); content.querySelector("#attendanceDate").addEventListener("change", load); content.querySelector("#attendanceTerm").addEventListener("change", load); if (selected) load();
  }

  async function pageTeacherAttendance(content) {
    const base = await catalogue(); const terms = termOptions(base.sessions);
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Attendance</div><h2>Teacher Attendance</h2><p>Record present, absent, late, on leave or excused staff attendance with optional check-in, check-out and notes.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Academic session</label><select id="teacherAttendanceSession"><option value="">All sessions</option>${options(base.sessions)}</select></div><div class="dash-field"><label>Term / semester</label><select id="teacherAttendanceTerm"><option value="">Auto-select by date</option>${options(terms, "", (term) => `${term.session_label} — ${term.name_en}`)}</select></div><div class="dash-field"><label>Date</label><input id="teacherAttendanceDate" type="date" value="${todayIso()}"></div></div><div id="teacherAttendanceBody" style="margin-top:18px"></div></div></div>`;
    const load = async () => { const date = content.querySelector("#teacherAttendanceDate").value; const out = content.querySelector("#teacherAttendanceBody"); if (!date) return; try { const data = await window.API.get(`/attendance/teachers?date=${encodeURIComponent(date)}`); const statuses = ["present", "absent", "late", "on_leave", "excused"]; out.innerHTML = `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Teacher</th><th>Department</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Notes</th></tr></thead><tbody>${data.teachers.length ? data.teachers.map((teacher) => `<tr><td><strong>${esc(teacher.full_name)}</strong><small>${esc(teacher.phone || teacher.email || "")}</small></td><td>${esc(teacher.department || "—")}</td><td><select data-teacher-status="${teacher.id}"><option value="">— Not marked —</option>${statuses.map((status) => `<option value="${status}" ${teacher.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select></td><td><input data-teacher-in="${teacher.id}" type="time" value="${esc(teacher.check_in || "")}"></td><td><input data-teacher-out="${teacher.id}" type="time" value="${esc(teacher.check_out || "")}"></td><td><input data-teacher-note="${teacher.id}" value="${esc(teacher.notes || "")}" placeholder="Optional note"></td></tr>`).join("") : emptyRow(6, "No teacher accounts yet.")}</tbody></table></div><div class="dash-actions" style="margin-top:16px"><button id="markAllTeacherPresent" class="dash-btn dash-btn-ghost">Mark all present</button><button id="markAllTeacherAbsent" class="dash-btn dash-btn-ghost">Mark all absent</button><button id="saveTeacherAttendance" class="dash-btn dash-btn-primary">${I.check} Save attendance</button></div>`; const mark = (status) => out.querySelectorAll("[data-teacher-status]").forEach((select) => { select.value = status; }); out.querySelector("#markAllTeacherPresent").addEventListener("click", () => mark("present")); out.querySelector("#markAllTeacherAbsent").addEventListener("click", () => mark("absent")); out.querySelector("#saveTeacherAttendance").addEventListener("click", async () => { const statuses = {}; out.querySelectorAll("[data-teacher-status]").forEach((select) => { if (select.value) statuses[select.dataset.teacherStatus] = { status: select.value, check_in: out.querySelector(`[data-teacher-in="${select.dataset.teacherStatus}"]`)?.value || "", check_out: out.querySelector(`[data-teacher-out="${select.dataset.teacherStatus}"]`)?.value || "", notes: out.querySelector(`[data-teacher-note="${select.dataset.teacherStatus}"]`)?.value || "" }; }); try { const result = await window.API.post("/attendance/teachers/mark", { date, termId: content.querySelector("#teacherAttendanceTerm").value || undefined, sessionId: content.querySelector("#teacherAttendanceSession").value || undefined, statuses }); toast(`${result.saved} teacher attendance record(s) saved.`, "success"); await load(); } catch (err) { toast(err.message || "Could not save teacher attendance.", "error"); } }); } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not load teacher attendance.")}</p>`; } };
    content.querySelector("#teacherAttendanceDate").addEventListener("change", load); load();
  }

  async function pageAttendanceReport(content) {
    const base = await catalogue(); const now = new Date(); const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Attendance</div><h2>Attendance Reports</h2><p>Daily, weekly, monthly, term, individual, class and department reporting from the same persisted registers.</p></div><button id="printAttendanceReport" class="dash-btn dash-btn-ghost">${I.external} Print</button></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Report type</label><select id="attendanceReportType"><option value="student">Student reports</option><option value="teacher">Teacher reports</option></select></div><div class="dash-field"><label>Academic session</label><select id="reportAttendanceSession"><option value="">All sessions</option>${options(base.sessions)}</select></div><div class="dash-field"><label>Term / semester</label><select id="reportAttendanceTerm"><option value="">All terms</option>${options(termOptions(base.sessions), "", (term) => `${term.session_label} — ${term.name_en}`)}</select></div><div class="dash-field"><label>Class</label><select id="reportAttendanceClass"><option value="">All classes</option>${options(base.classes)}</select></div><div class="dash-field"><label>Education track</label><select id="reportAttendanceTrack"><option value="">All tracks</option><option value="islamic">Islamic</option><option value="western">Western</option><option value="both">Both</option></select></div><div class="dash-field"><label>Program / category</label><input id="reportAttendanceProgram" placeholder="Program or subject category"></div><div class="dash-field"><label>From</label><input id="reportAttendanceFrom" type="date" value="${monthStart}"></div><div class="dash-field"><label>To</label><input id="reportAttendanceTo" type="date" value="${todayIso()}"></div><div class="dash-field"><label>Student / teacher id (optional)</label><input id="reportAttendancePerson" type="number" min="1" placeholder="Filter individual record"></div><div class="dash-field"><label>Department (teacher reports)</label><input id="reportAttendanceDepartment" placeholder="e.g. Sciences"></div></div><button id="loadAttendanceReport" class="dash-btn dash-btn-primary" style="margin-top:14px">Generate report</button><div id="attendanceReportResult" style="margin-top:18px"></div></div></div>`;
    content.querySelector("#printAttendanceReport").addEventListener("click", () => window.print());
    content.querySelector("#loadAttendanceReport").addEventListener("click", async () => { const type = content.querySelector("#attendanceReportType").value; const classId = content.querySelector("#reportAttendanceClass").value; const from = content.querySelector("#reportAttendanceFrom").value; const to = content.querySelector("#reportAttendanceTo").value; const person = content.querySelector("#reportAttendancePerson").value; const department = content.querySelector("#reportAttendanceDepartment").value; const sessionId = content.querySelector("#reportAttendanceSession").value; const termId = content.querySelector("#reportAttendanceTerm").value; const track = content.querySelector("#reportAttendanceTrack").value; const program = content.querySelector("#reportAttendanceProgram").value; const out = content.querySelector("#attendanceReportResult"); if (!from || !to || from > to) return out.innerHTML = `<p class="dash-error">Choose a valid date range.</p>`; try { const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${classId ? `&classId=${classId}` : ""}${sessionId ? `&sessionId=${sessionId}` : ""}${termId ? `&termId=${termId}` : ""}${track ? `&educationTrack=${encodeURIComponent(track)}` : ""}${program ? `&program=${encodeURIComponent(program)}` : ""}${person ? `&${type === "student" ? "studentId" : "teacherId"}=${person}` : ""}${department ? `&department=${encodeURIComponent(department)}` : ""}${type === "teacher" ? "&type=teacher" : ""}`; const r = await window.API.get(`/attendance/report?${query}`); const stats = type === "teacher" ? r.stats : r.totals; const exportPath = type === "teacher" ? `/exports/teacher-attendance.csv?${query.replace("&type=teacher", "")}` : `/exports/attendance.csv?${query}`; const rows = type === "teacher" ? (r.teachers || []).map((row) => `<tr><td>${esc(row.full_name)}</td><td>${esc(row.department || "—")}</td><td>${row.present}</td><td>${row.absent}</td><td>${row.late}</td><td>${row.on_leave}</td><td>${row.excused}</td><td>${row.attendancePercentage}%</td></tr>`).join("") : (r.students || []).map((row) => `<tr><td>${esc(row.first_name)} ${esc(row.last_name)}</td><td>${esc(row.class_en || "—")}</td><td>${row.present}</td><td>${row.absent}</td><td>${row.late}</td><td>${row.excused}</td><td>${row.attendance_percentage}%</td></tr>`).join(""); out.innerHTML = `<div class="dash-stats-grid">${statCard("check", stats.present || 0, "Total present")}${statCard("close", stats.absent || 0, "Total absent")}${statCard("clock", stats.late || 0, "Total late")}${statCard("activity", stats.attendancePercentage || 0, "Attendance %")}</div><div class="dash-actions" style="margin:16px 0"><a class="dash-btn dash-btn-ghost dash-btn-sm" href="${window.API.url(exportPath)}" target="_blank" rel="noopener">${I.download} Export CSV</a></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr>${type === "teacher" ? "<th>Teacher</th><th>Department</th><th>Present</th><th>Absent</th><th>Late</th><th>On leave</th><th>Excused</th><th>Rate</th>" : "<th>Student</th><th>Class</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Rate</th>"}</tr></thead><tbody>${rows || emptyRow(type === "teacher" ? 8 : 7, "No attendance records match these filters.")}</tbody></table></div>`; } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not generate report.")}</p>`; } });
  }

  /* ============================= ACADEMIC ============================== */
  async function pageHomework(content, route) {
    const [data, base] = await Promise.all([window.API.get(`/homework?kind=${route.endsWith("lessons") ? "lesson" : "assignment"}`), catalogue()]); const label = route.endsWith("lessons") ? "Lessons" : "Assignments";
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>${label}</h2><p>Post classroom work with optional subject, due date and instructions.</p></div><button id="addHomework" class="dash-btn dash-btn-primary">${I.plus} Add ${label.slice(0, -1)}</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Due</th><th>Posted by</th><th></th></tr></thead><tbody>${(data.homework || []).length ? data.homework.map((h) => `<tr><td><strong>${esc(h.title)}</strong><small>${esc((h.details || "").slice(0, 120))}</small></td><td>${esc(h.class_en || "All classes")}</td><td>${esc(h.subject_en || "—")}</td><td>${fmtDate(h.due_date)}</td><td>${esc(h.author || "—")}</td><td><button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-homework="${h.id}">${I.trash}</button></td></tr>`).join("") : emptyRow(6, `No ${label.toLowerCase()} have been posted yet.`)}</tbody></table></div></div>`;
    content.querySelector("#addHomework").addEventListener("click", () => { const modal = openModal(`Add ${label.slice(0, -1)}`, `<form id="homeworkForm"><div class="dash-form-grid"><div class="dash-field" style="grid-column:1/-1"><label>Title</label><input name="title" required></div><div class="dash-field"><label>Class</label><select name="class_id"><option value="">All classes</option>${options(base.classes)}</select></div><div class="dash-field"><label>Subject</label><select name="subject_id"><option value="">Not specified</option>${options(base.subjects)}</select></div><div class="dash-field"><label>Due date</label><input name="due_date" type="date"></div><div class="dash-field" style="grid-column:1/-1"><label>Instructions</label><textarea name="details"></textarea></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Post</button></form>`); modal.querySelector("#homeworkForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post("/homework", Object.assign(Object.fromEntries(new FormData(e.target)), { kind: route.endsWith("lessons") ? "lesson" : "assignment" })); toast(`${label.slice(0, -1)} posted.`, "success"); closeModal(); pageHomework(content, route); } catch (err) { toast(err.message || "Could not post work.", "error"); } }); });
    content.querySelectorAll("[data-delete-homework]").forEach((b) => b.addEventListener("click", async () => { if (!window.confirm("Remove this item?")) return; try { await window.API.del(`/homework/${b.dataset.deleteHomework}`); toast("Item removed.", "success"); pageHomework(content, route); } catch (err) { toast(err.message || "Could not remove item.", "error"); } }));
  }

  async function pageGrading(content) {
    const data = await window.API.get("/grading"); const bands = data.bands || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>Examinations & Grading</h2><p>Configure CA, examination scores, pass mark, grade bands and promotion rules.</p></div></div><div class="dash-card"><div class="dash-card-pad"><form id="gradingForm"><div class="dash-form-grid"><div class="dash-field"><label>CA maximum</label><input name="ca_max" type="number" min="1" max="100" value="${esc(data.caMax)}"></div><div class="dash-field"><label>Exam maximum</label><input name="exam_max" type="number" min="1" max="100" value="${esc(data.examMax)}"></div><div class="dash-field"><label>Pass mark (%)</label><input name="pass_mark" type="number" min="0" max="100" value="${esc(data.passMark)}"></div><div class="dash-field"><label>Promotion minimum average (%)</label><input name="promotion_min_average" type="number" min="0" max="100" value="${data.promotionMinAverage == null ? "" : esc(data.promotionMinAverage)}"></div><div class="dash-field"><label>Promotion requires passing every subject</label><select name="promotion_require_pass"><option value="true" ${data.promotionRequirePass ? "selected" : ""}>Yes</option><option value="false" ${!data.promotionRequirePass ? "selected" : ""}>No</option></select></div></div><h3 style="margin:22px 0 10px">Grade bands</h3><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Minimum %</th><th>Grade</th><th>Remark</th><th>Arabic Remark</th></tr></thead><tbody id="gradeBandRows">${bands.map((b) => `<tr><td><input type="number" class="band-min" min="0" max="100" value="${esc(b.min)}"></td><td><input class="band-grade" maxlength="5" value="${esc(b.grade)}"></td><td><input class="band-remark" value="${esc(b.remark)}"></td><td><input class="band-remark-ar" dir="rtl" value="${esc(b.remark_ar)}"></td></tr>`).join("")}</tbody></table></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save grading configuration</button></form></div></div>`;
    content.querySelector("#gradingForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); const bandsOut = [...content.querySelectorAll("#gradeBandRows tr")].map((tr) => ({ min: tr.querySelector(".band-min").value, grade: tr.querySelector(".band-grade").value, remark: tr.querySelector(".band-remark").value, remark_ar: tr.querySelector(".band-remark-ar").value })).filter((x) => x.grade); try { await window.API.put("/grading", { ca_max: fd.get("ca_max"), exam_max: fd.get("exam_max"), pass_mark: fd.get("pass_mark"), promotion_min_average: fd.get("promotion_min_average"), promotion_require_pass: fd.get("promotion_require_pass") === "true", bands: bandsOut }); toast("Grading configuration saved.", "success"); } catch (err) { toast(err.message || "Could not save grading configuration.", "error"); } });
  }

  async function pageResultsWorkbook(content) {
    const base = await catalogue(); const terms = allTerms(base.sessions);
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>Results</h2><p>Enter scores, calculate class summaries, then publish results when they are ready.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Class</label><select id="resultClass"><option value="">Select class</option>${options(base.classes)}</select></div><div class="dash-field"><label>Term</label><select id="resultTerm"><option value="">Select term</option>${options(terms, "", (t) => `${t.session_label} — ${t.name_en}`)}</select></div><div class="dash-field"><label>Subject</label><select id="resultSubject"><option value="">Select subject</option>${options(base.subjects)}</select></div></div><div id="resultWorkbook" style="margin-top:18px"></div></div></div>`;
    const load = async () => { const classId = content.querySelector("#resultClass").value; const termId = content.querySelector("#resultTerm").value; const subjectId = content.querySelector("#resultSubject").value; const out = content.querySelector("#resultWorkbook"); if (!classId || !termId || !subjectId) return out.innerHTML = `<p class="hint">Choose a class, term and subject to open its gradebook.</p>`; try { const data = await window.API.get(`/results/roster?classId=${classId}&termId=${termId}&subjectId=${subjectId}`); out.innerHTML = `<div class="dash-info-line">CA max: <b>${data.config.caMax}</b> · Exam max: <b>${data.config.examMax}</b> · Pass mark: <b>${data.config.passMark}%</b></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Admission No.</th><th>Student</th><th>CA</th><th>Exam</th><th>Total</th></tr></thead><tbody>${data.students.length ? data.students.map((s) => `<tr data-result-student="${s.student_id}"><td>${esc(s.admission_no)}</td><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td><input class="score-ca" type="number" min="0" max="${data.config.caMax}" step="0.5" value="${esc(s.ca)}"></td><td><input class="score-exam" type="number" min="0" max="${data.config.examMax}" step="0.5" value="${esc(s.exam)}"></td><td class="score-total">${s.total === "" ? "—" : esc(s.total)}</td></tr>`).join("") : emptyRow(5, "No active students in this class.")}</tbody></table></div><div class="dash-actions" style="margin-top:16px"><button id="saveResults" class="dash-btn dash-btn-primary">${I.check} Save Scores</button><button id="computeResults" class="dash-btn dash-btn-ghost">${I.refresh} Calculate summaries</button><button id="publishResults" class="dash-btn dash-btn-ghost">Publish results</button><a class="dash-btn dash-btn-ghost" href="${window.API.url(`/exports/results.csv?classId=${classId}&termId=${termId}`)}" target="_blank" rel="noopener">${I.download} Export</a></div>`; const updateTotals = () => out.querySelectorAll("[data-result-student]").forEach((r) => { const ca = Number(r.querySelector(".score-ca").value || 0), ex = Number(r.querySelector(".score-exam").value || 0); r.querySelector(".score-total").textContent = ca || ex ? String(ca + ex) : "—"; }); out.querySelectorAll(".score-ca,.score-exam").forEach((i) => i.addEventListener("input", updateTotals)); out.querySelector("#saveResults").addEventListener("click", async () => { const entries = [...out.querySelectorAll("[data-result-student]")].map((r) => ({ studentId: Number(r.dataset.resultStudent), ca: r.querySelector(".score-ca").value || 0, exam: r.querySelector(".score-exam").value || 0 })); try { await window.API.put("/results", { classId: Number(classId), termId: Number(termId), subjectId: Number(subjectId), entries }); toast("Scores saved.", "success"); } catch (err) { toast(err.message || "Could not save scores.", "error"); } }); out.querySelector("#computeResults").addEventListener("click", async () => { try { const r = await window.API.post("/results/compute", { classId: Number(classId), termId: Number(termId) }); toast(`${r.computed || r.count || "Class"} summaries calculated.`, "success"); } catch (err) { toast(err.message || "Could not calculate summaries.", "error"); } }); out.querySelector("#publishResults").addEventListener("click", async () => { if (!window.confirm("Publish this class’s calculated results? Students and parents will be able to view them.")) return; try { const r = await window.API.put("/results/summaries/publish", { classId: Number(classId), termId: Number(termId), publish: true }); toast(`${r.count} result(s) published.`, "success"); } catch (err) { toast(err.message || "Could not publish results.", "error"); } }); } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not load gradebook.")}</p>`; } };
    ["#resultClass", "#resultTerm", "#resultSubject"].forEach((id) => content.querySelector(id).addEventListener("change", load));
  }


  async function pageReportCards(content) {
    const base = await catalogue(); const terms = allTerms(base.sessions);
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>Report Cards</h2><p>Review calculated term summaries, add comments and open printable report cards.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid"><div class="dash-field"><label>Class</label><select id="reportClass"><option value="">Select class</option>${options(base.classes)}</select></div><div class="dash-field"><label>Term</label><select id="reportTerm"><option value="">Select term</option>${options(terms, "", (t) => `${t.session_label} — ${t.name_en}`)}</select></div></div><div id="reportCardsList" style="margin-top:18px"></div></div></div>`;
    const load = async () => { const cls = content.querySelector("#reportClass").value, term = content.querySelector("#reportTerm").value, out = content.querySelector("#reportCardsList"); if (!cls || !term) return out.innerHTML = `<p class="hint">Select class and term to see calculated report cards.</p>`; try { const r = await window.API.get(`/results/summary?classId=${cls}&termId=${term}`); out.innerHTML = `<div class="dash-actions" style="margin-bottom:10px"><button id="calculateReportCards" class="dash-btn dash-btn-ghost dash-btn-sm">${I.refresh} Recalculate all</button><button id="publishReportCards" class="dash-btn dash-btn-primary dash-btn-sm">Publish class results</button><a class="dash-btn dash-btn-ghost dash-btn-sm" target="_blank" rel="noopener" href="${window.API.url(`/exports/summary.csv?classId=${cls}&termId=${term}`)}">${I.download} Export CSV</a></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Student</th><th>Average</th><th>Grade</th><th>Position</th><th>Promotion</th><th>Publication</th><th></th></tr></thead><tbody>${r.students.length ? r.students.map((s) => `<tr><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td>${esc(s.average)}%</td><td>${esc(s.overall_grade)}</td><td>${esc(s.position || "—")}</td><td>${esc(s.promotion_status)}</td><td><span class="dash-pill ${s.published_at ? "ok" : "warn"}">${s.published_at ? "published" : "draft"}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-summary-student="${s.student_id}">Comments</button> <a class="dash-btn dash-btn-ghost dash-btn-sm" target="_blank" rel="noopener" href="${window.API.reportCardUrl(s.student_id, term)}">${I.external} Card</a></td></tr>`).join("") : emptyRow(7, "No calculated summaries. Enter subject scores, then calculate the class term.")}</tbody></table></div>`; out.querySelector("#calculateReportCards").addEventListener("click", async () => { try { await window.API.post("/results/compute", { classId: Number(cls), termId: Number(term) }); toast("Term summaries calculated.", "success"); load(); } catch (err) { toast(err.message || "Could not calculate summaries.", "error"); } }); out.querySelector("#publishReportCards").addEventListener("click", async () => { if (!window.confirm("Publish all calculated report cards in this class?")) return; try { const x = await window.API.put("/results/summaries/publish", { classId: Number(cls), termId: Number(term), publish: true }); toast(`${x.count} report card(s) published.`, "success"); load(); } catch (err) { toast(err.message || "Could not publish report cards.", "error"); } }); out.querySelectorAll("[data-summary-student]").forEach((b) => b.addEventListener("click", () => { const s = r.students.find((x) => Number(x.student_id) === Number(b.dataset.summaryStudent)); openSummaryModal(s, Number(term), load); })); } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not load report cards.")}</p>`; } };
    content.querySelector("#reportClass").addEventListener("change", load); content.querySelector("#reportTerm").addEventListener("change", load);
  }
  function openSummaryModal(summary, termId, done) {
    const modal = openModal(`Report comments — ${summary.first_name} ${summary.last_name}`, `<form id="summaryForm"><div class="dash-form-grid"><div class="dash-field"><label>Teacher Comment</label><textarea name="teacher_comment">${esc(summary.teacher_comment || "")}</textarea></div><div class="dash-field"><label>Head / Administrator Comment</label><textarea name="head_comment">${esc(summary.head_comment || "")}</textarea></div><div class="dash-field"><label>Attendance days</label><input name="attendance_days" type="number" min="0" value="${esc(summary.attendance_days || 0)}"></div><div class="dash-field"><label>Promotion decision</label><select name="promotion_status">${["pending", "promoted", "repeating", "graduated"].map((x) => `<option value="${x}" ${summary.promotion_status === x ? "selected" : ""}>${x}</option>`).join("")}</select></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Save comments</button></form>`);
    modal.querySelector("#summaryForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.put(`/results/summary/${summary.student_id}`, { termId, teacher_comment: fd.get("teacher_comment"), head_comment: fd.get("head_comment"), attendance_days: fd.get("attendance_days"), promotion_status: fd.get("promotion_status") }); toast("Report card comments saved.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not save report comments.", "error"); } });
  }

  async function pageSessionsManager(content, route) {
    const data = await window.API.get("/sessions"); const sessions = data.sessions || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>${route.endsWith("terms") ? "Terms" : "Academic Sessions"}</h2><p>Make one session current before entering attendance and results. Each session can have its own terms.</p></div><button class="dash-btn dash-btn-primary" id="addSession">${I.plus} Add Session</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Session</th><th>Dates</th><th>Terms</th><th>Current</th><th></th></tr></thead><tbody>${sessions.length ? sessions.map((s) => `<tr><td><strong>${esc(s.label)}</strong></td><td>${fmtDate(s.start_date)} — ${fmtDate(s.end_date)}</td><td>${esc((s.terms || []).map((t) => t.name_en).join(", ") || "No terms")}</td><td>${s.is_current ? `<span class="dash-pill ok">Current</span>` : "—"}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-session="${s.id}">Manage terms</button>${s.is_current ? "" : ` <button class="dash-btn dash-btn-ghost dash-btn-sm" data-current-session="${s.id}">Set current</button>`}</td></tr>`).join("") : emptyRow(5, "No academic sessions yet.")}</tbody></table></div></div>`;
    content.querySelector("#addSession").addEventListener("click", () => { const modal = openModal("Add academic session", `<form id="newSessionForm"><div class="dash-form-grid"><div class="dash-field"><label>Session label</label><input name="label" required placeholder="2026/2027" pattern="[0-9]{4}([/ -]?[0-9]{0,4})?"></div><div class="dash-field"><label>Start date</label><input name="start_date" type="date"></div><div class="dash-field"><label>End date</label><input name="end_date" type="date"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Create session with 3 terms</button></form>`); modal.querySelector("#newSessionForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post("/sessions", Object.fromEntries(new FormData(e.target))); toast("Session and its standard terms created.", "success"); closeModal(); pageSessionsManager(content, route); } catch (err) { toast(err.message || "Could not create session.", "error"); } }); });
    content.querySelectorAll("[data-current-session]").forEach((b) => b.addEventListener("click", async () => { try { await window.API.patch(`/sessions/${b.dataset.currentSession}`, { is_current: true }); toast("Current session updated.", "success"); pageSessionsManager(content, route); } catch (err) { toast(err.message || "Could not change current session.", "error"); } }));
    content.querySelectorAll("[data-session]").forEach((b) => b.addEventListener("click", () => openSessionTermsModal(sessions.find((x) => Number(x.id) === Number(b.dataset.session)), () => pageSessionsManager(content, route))));
  }
  function openSessionTermsModal(session, done) {
    const renderTerms = () => (session.terms || []).map((t) => `<tr><td>${t.position}</td><td>${esc(t.name_en)}</td><td>${esc(t.name_ar || "")}</td><td>${fmtDate(t.start_date)} — ${fmtDate(t.end_date)}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-edit-term="${t.id}">${I.edit}</button></td></tr>`).join("") || emptyRow(5, "No terms yet.");
    const modal = openModal(`${session.label} — terms`, `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>#</th><th>English</th><th>Arabic</th><th>Dates</th><th></th></tr></thead><tbody>${renderTerms()}</tbody></table></div><hr class="dash-rule"><form id="newTermForm"><div class="dash-form-grid"><div class="dash-field"><label>Position</label><input name="position" type="number" min="1" required value="${(session.terms || []).length + 1}"></div><div class="dash-field"><label>English name</label><input name="name_en" required></div><div class="dash-field"><label>Arabic name</label><input name="name_ar" dir="rtl"></div><div class="dash-field"><label>Start date</label><input name="start_date" type="date"></div><div class="dash-field"><label>End date</label><input name="end_date" type="date"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.plus} Add term</button></form>`);
    modal.querySelector("#newTermForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post(`/sessions/${session.id}/terms`, Object.fromEntries(new FormData(e.target))); toast("Term added.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not add term.", "error"); } });
    modal.querySelectorAll("[data-edit-term]").forEach((b) => b.addEventListener("click", () => { const t = session.terms.find((x) => Number(x.id) === Number(b.dataset.editTerm)); const edit = openModal(`Edit ${t.name_en}`, `<form id="editTermForm"><div class="dash-form-grid"><div class="dash-field"><label>English name</label><input name="name_en" value="${esc(t.name_en)}"></div><div class="dash-field"><label>Arabic name</label><input name="name_ar" dir="rtl" value="${esc(t.name_ar)}"></div><div class="dash-field"><label>Start date</label><input name="start_date" type="date" value="${esc(t.start_date || "")}"></div><div class="dash-field"><label>End date</label><input name="end_date" type="date" value="${esc(t.end_date || "")}"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Save term</button></form>`); edit.querySelector("#editTermForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.patch(`/terms/${t.id}`, Object.fromEntries(new FormData(e.target))); toast("Term saved.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not save term.", "error"); } }); }));
  }

  /* ============================ ADMISSIONS ============================== */
  const applicationStatusLabels = { pending: "Pending", under_review: "Under review", accepted: "Accepted", approved: "Converted", rejected: "Rejected", waitlisted: "Waitlisted", needs_info: "More information", on_hold: "On hold" };
  function applicationStatus(status) { return applicationStatusLabels[status] || String(status || "Pending"); }
  async function pageAdmissionApplications(content) {
    const base = await catalogue(); let page = 1; const perPage = 15;
    const values = () => ({ search: content.querySelector("#applicationSearch")?.value.trim() || "", status: content.querySelector("#applicationStatus")?.value || "", sessionId: content.querySelector("#applicationSession")?.value || "", program: content.querySelector("#applicationProgram")?.value.trim() || "" });
    const qs = () => Object.entries(Object.assign({}, values(), { page, perPage })).filter(([, v]) => v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students · admissions</div><h2>Student applications</h2><p>Review applications, keep a complete decision history, and convert accepted applicants without re-entering their details.</p></div><a class="dash-btn dash-btn-ghost" target="_blank" rel="noopener" href="${window.API.url("/exports/admissions.csv")}">${I.download} Export</a></div><div class="dash-stats-grid application-stat-grid">${statCard("admissions", 0, "Pending")}${statCard("clock", 0, "Under review")}${statCard("check", 0, "Accepted")}${statCard("users", 0, "Converted")}${statCard("close", 0, "Rejected")}</div><div class="dash-card student-filter-card"><div class="dash-card-pad"><div class="student-filter-grid application-filter-grid"><div class="dash-field"><label>Search</label><input id="applicationSearch" type="search" placeholder="Name, reference, guardian or phone"></div><div class="dash-field"><label>Status</label><select id="applicationStatus"><option value="">All statuses</option>${Object.entries(applicationStatusLabels).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div><div class="dash-field"><label>Desired session</label><select id="applicationSession"><option value="">All sessions</option>${options(base.sessions, null, (x) => x.label)}</select></div><div class="dash-field"><label>Program</label><input id="applicationProgram" placeholder="Program"></div></div></div></div><div id="applicationTableCard" class="dash-card"><div class="student-loading" id="applicationLoading" hidden>Loading applications…</div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Application</th><th>Applicant</th><th>Desired placement</th><th>Contact</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody id="applicationRows"></tbody></table></div><div class="student-pagination"><span id="applicationCount">—</span><span id="applicationPage">Page 1</span><button class="dash-btn dash-btn-ghost dash-btn-sm" id="applicationPrev">Previous</button><button class="dash-btn dash-btn-ghost dash-btn-sm" id="applicationNext">Next</button></div></div>`;
    const load = async () => { content.querySelector("#applicationLoading").hidden = false; try { const d = await window.API.get(`/admissions?${qs()}`); const rows = d.requests || []; content.querySelector("#applicationRows").innerHTML = rows.length ? rows.map((r) => `<tr><td><strong>${esc(r.reference)}</strong><small>${r.fee_status ? `Fee: ${esc(r.fee_status)}` : "Application"}</small></td><td><strong>${esc([r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" "))}</strong><small>${esc(r.parent_name || "No guardian name")}</small></td><td>${esc(r.class_name || "Class not selected")}<small>${esc([r.program, r.session_label].filter(Boolean).join(" · ") || "Not specified")}</small></td><td>${esc(r.parent_phone || "—")}<small>${esc(r.parent_email || "")}</small></td><td>${fmtDate(r.created_at)}</td><td><span class="dash-pill ${pillFor(r.status)}">${esc(applicationStatus(r.status))}</span></td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-application="${r.id}">Review</button></td></tr>`).join("") : emptyRow(7, "No applications match these filters."); content.querySelector("#applicationCount").textContent = `${d.total || 0} application${Number(d.total || 0) === 1 ? "" : "s"}`; const pages = Math.max(1, d.totalPages || Math.ceil(Number(d.total || 0) / perPage)); content.querySelector("#applicationPage").textContent = `Page ${page} of ${pages}`; content.querySelector("#applicationPrev").disabled = page <= 1; content.querySelector("#applicationNext").disabled = page >= pages; const c = d.statusCounts || d.byStatus || {}; const cards = content.querySelectorAll(".application-stat-grid .dash-stat-value"); [c.pending || 0, c.under_review || 0, (c.accepted || 0) + (c.approved || 0), c.approved || 0, c.rejected || 0].forEach((v, i) => { if (cards[i]) cards[i].childNodes[0].textContent = v; }); content.querySelectorAll("[data-application]").forEach((b) => b.addEventListener("click", () => openApplicationReview(Number(b.dataset.application), base, () => load()))); } catch (e) { content.querySelector("#applicationRows").innerHTML = emptyRow(7, e.message || "Could not load applications."); } finally { content.querySelector("#applicationLoading").hidden = true; } };
    ["applicationSearch", "applicationStatus", "applicationSession", "applicationProgram"].forEach((id) => { const el = content.querySelector(`#${id}`); el.addEventListener(el.tagName === "INPUT" ? "input" : "change", () => { page = 1; clearTimeout(el._timer); el._timer = setTimeout(load, el.tagName === "INPUT" ? 300 : 0); }); });
    content.querySelector("#applicationPrev").addEventListener("click", () => { if (page > 1) { page--; load(); } }); content.querySelector("#applicationNext").addEventListener("click", () => { page++; load(); }); await load();
  }
  async function openApplicationReview(id, base, done) {
    const data = await window.API.get(`/admissions/${id}`); const r = data.request; const status = r.status; const canConvert = ["accepted", "approved"].includes(status) && !data.student;
    const modal = openModal(`Application · ${r.reference}`, `<div class="application-hero"><div><span class="dash-pill ${pillFor(r.status)}">${esc(applicationStatus(r.status))}</span><h3>${esc([r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" "))}</h3><p>Submitted ${fmtDate(r.created_at)} · ${esc(r.parent_phone || "No phone")}</p></div><div class="dash-actions">${canConvert ? `<button id="convertApplication" class="dash-btn dash-btn-primary">${I.check} Convert to student</button>` : ""}${data.student ? `<button id="viewConvertedStudent" class="dash-btn dash-btn-ghost">View student</button>` : ""}</div></div><div class="dash-info-grid application-info"><div><b>Applicant</b><br>${esc([r.first_name, r.last_name].filter(Boolean).join(" "))}<br>${esc(r.gender || "Gender not specified")} · ${fmtDate(r.date_of_birth)}</div><div><b>Desired placement</b><br>${esc(r.class_name || "Class not selected")}<br>${esc([r.program, r.session_label, r.education_track].filter(Boolean).join(" · ") || "Not specified")}</div><div><b>Parent / guardian</b><br>${esc(r.parent_name || "—")}<br>${esc(r.parent_phone || "—")} · ${esc(r.parent_email || "")}</div><div><b>Payment</b><br>${esc(r.fee_status || "unpaid")}${r.fee_reference ? ` · ${esc(r.fee_reference)}` : ""}<br>Interview: ${esc(r.interview_date || "Not scheduled")}</div></div><div class="student-profile-tabs application-tabs"><button class="active" data-app-tab="review">Review</button><button data-app-tab="details">Full details</button><button data-app-tab="history">History</button><button data-app-tab="documents">Documents</button></div><div id="applicationPanel"></div>`);
    modal.querySelector(".dash-modal").style.width = "min(900px, 100%)"; const panel = modal.querySelector("#applicationPanel");
    const renderTab = (name) => { if (name === "review") panel.innerHTML = `<form id="applicationReviewForm"><div class="dash-form-grid"><div class="dash-field"><label>Decision</label><select name="status">${Object.entries(applicationStatusLabels).map(([v, l]) => `<option value="${v}" ${status === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="dash-field"><label>Interview date</label><input name="interview_date" type="date" value="${esc(r.interview_date || "")}"></div><div class="dash-field"><label>Payment status</label><select name="fee_status"><option value="unpaid" ${r.fee_status === "unpaid" ? "selected" : ""}>Unpaid</option><option value="pending" ${r.fee_status === "pending" ? "selected" : ""}>Pending</option><option value="paid" ${r.fee_status === "paid" ? "selected" : ""}>Paid</option><option value="waived" ${r.fee_status === "waived" ? "selected" : ""}>Waived</option></select></div><div class="dash-field"><label>Class if accepted</label><select name="class_id"><option value="">Use requested class</option>${options(base.classes, r.class_id)}</select></div><div class="dash-field" style="grid-column:1/-1"><label>Review notes</label><textarea name="review_note" rows="4" placeholder="Record the decision, interview findings or request for more information">${esc(r.review_note || "")}</textarea></div><div class="dash-field" style="grid-column:1/-1"><label>Interview notes</label><textarea name="interview_notes">${esc(r.interview_notes || "")}</textarea></div></div><div class="dash-actions" style="margin-top:15px"><button class="dash-btn dash-btn-primary">${I.check} Save review</button><button type="button" class="dash-btn dash-btn-danger" id="rejectApplication">Reject</button><button type="button" class="dash-btn dash-btn-ghost" id="waitlistApplication">Waitlist</button><button type="button" class="dash-btn dash-btn-ghost" id="requestInfoApplication">Request information</button></div></form>`; else if (name === "details") panel.innerHTML = `<div class="dash-info-grid application-info"><div><b>Personal</b><br>Nationality: ${esc(r.nationality || "—")}<br>State/LGA: ${esc([r.state_of_origin, r.lga].filter(Boolean).join(" / ") || "—")}<br>Religion: ${esc(r.religion || "—")}</div><div><b>Previous school</b><br>${esc(r.previous_school || "—")}<br>Qur'an level: ${esc(r.quran_level || "—")}</div><div><b>Family contacts</b><br>Father: ${esc(r.father_name || "—")}<br>Mother: ${esc(r.mother_name || "—")}<br>Guardian: ${esc(r.guardian_name || "—")}</div><div><b>Applicant message</b><br>${esc(r.message || r.additional_info || "—")}</div></div>`; else if (name === "history") panel.innerHTML = `<div class="student-history-list">${(data.history || []).length ? data.history.map((h) => `<p class="student-history-line"><span class="dash-pill info">${esc(applicationStatus(h.to_status))}</span><small>${fmtDate(h.created_at)}${h.note ? ` · ${esc(h.note)}` : ""}</small></p>`).join("") : `<p class="hint">No review history yet.</p>`}</div>`; else panel.innerHTML = `<div class="dash-card"><div class="dash-card-head"><h3>Uploaded documents</h3><label class="dash-btn dash-btn-primary dash-btn-sm">${I.plus} Upload<input id="applicationDocUpload" type="file" hidden></label></div><div class="dash-card-pad">${(data.documents || []).length ? data.documents.map((d) => `<p class="student-history-line">${I.file}<strong>${esc(d.document_name)}</strong><a class="dash-btn dash-btn-ghost dash-btn-sm" href="/api/admissions/${id}/documents/${d.id}" target="_blank">Download</a></p>`).join("") : `<p class="hint">No documents uploaded.</p>`}</div></div>`; const form = panel.querySelector("#applicationReviewForm"); if (form) { form.addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(form); try { await window.API.patch(`/admissions/${id}/review`, { status: fd.get("status"), review_note: fd.get("review_note"), interview_date: fd.get("interview_date"), interview_notes: fd.get("interview_notes"), fee_status: fd.get("fee_status") }); toast("Application review saved.", "success"); closeModal(); done(); } catch (e2) { toast(e2.message || "Could not save review.", "error"); } }); ["rejectApplication", "waitlistApplication", "requestInfoApplication"].forEach((buttonId) => { const b = panel.querySelector(`#${buttonId}`); if (b) b.addEventListener("click", async () => { const action = buttonId === "rejectApplication" ? "rejected" : buttonId === "waitlistApplication" ? "waitlisted" : "needs_info"; try { await window.API.post(`/admissions/${id}/${action === "rejected" ? "reject" : action === "waitlisted" ? "waitlist" : "request-info"}`, { note: form.querySelector("[name=review_note]").value }); toast("Application updated.", "success"); closeModal(); done(); } catch (e3) { toast(e3.message || "Could not update application.", "error"); } }); }); } const up = panel.querySelector("#applicationDocUpload"); if (up) up.addEventListener("change", async () => { const file = up.files[0]; if (!file) return; const fd = new FormData(); fd.append("document", file); fd.append("document_name", file.name); try { await window.API.post(`/admissions/${id}/documents`, fd); toast("Document uploaded.", "success"); renderTab("documents"); } catch (e) { toast(e.message || "Could not upload document.", "error"); } }); };
    modal.querySelectorAll("[data-app-tab]").forEach((b) => b.addEventListener("click", () => { modal.querySelectorAll("[data-app-tab]").forEach((x) => x.classList.remove("active")); b.classList.add("active"); renderTab(b.dataset.appTab); })); renderTab("review");
    const convert = modal.querySelector("#convertApplication"); if (convert) convert.addEventListener("click", async () => { if (!window.confirm("Convert this accepted application into a student? Existing applicant and guardian information will be transferred.")) return; try { const out = await window.API.post(`/admissions/${id}/convert`, {}); toast(`Converted — ${out.admissionNo}.`, "success"); closeModal(); go("students/profiles"); } catch (e) { toast(e.message || "Could not convert application.", "error"); } }); const view = modal.querySelector("#viewConvertedStudent"); if (view) view.addEventListener("click", () => { closeModal(); openStudentProfile(Number(data.student.id)); });
  }
  async function pageAdmissionRequirements(content) { return pageWebsiteContent(content, "website/admissions"); }
  async function pageAdmissionSettings(content) {
    const [site, profile] = await Promise.all([window.API.get("/madrasa/public-site"), window.API.get("/madrasa/profile")]); const s = site.settings || {}; const slug = profile.madrasa.slug;
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Admissions</div><h2>Admission Settings</h2><p>Control which parts of your online admission journey are visible to the public.</p></div></div><div class="dash-card"><div class="dash-card-pad"><form id="admissionSettingsForm"><label class="dash-toggle"><input name="public_listing" type="checkbox" ${s.public_listing ? "checked" : ""}><span>Show this institution in the BELLO directory</span></label><label class="dash-toggle"><input name="public_admissions" type="checkbox" ${s.public_admissions ? "checked" : ""}><span>Accept online applications</span></label><label class="dash-toggle"><input name="public_results" type="checkbox" ${s.public_results ? "checked" : ""}><span>Enable public result checking for published results</span></label><div class="dash-form-grid" style="margin-top:16px"><div class="dash-field"><label>Founded year</label><input name="founded_year" pattern="[0-9]{4}" value="${esc(s.founded_year || "")}"></div><div class="dash-field"><label>Public website URL</label><input name="website" type="url" value="${esc(s.website || "")}"></div><div class="dash-field" style="grid-column:1/-1"><label>Public introduction</label><textarea name="description_en">${esc(s.description_en || "")}</textarea></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save admission settings</button></form><p class="dash-info-line" style="margin-top:16px">Your public application link: <a href="/schools/${esc(slug)}" target="_blank" rel="noopener">/schools/${esc(slug)}</a></p></div></div>`;
    content.querySelector("#admissionSettingsForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.put("/madrasa/public-site", { public_listing: fd.get("public_listing") === "on", public_admissions: fd.get("public_admissions") === "on", public_results: fd.get("public_results") === "on", founded_year: fd.get("founded_year"), website: fd.get("website"), description_en: fd.get("description_en") }); toast("Admission settings saved.", "success"); } catch (err) { toast(err.message || "Could not save admission settings.", "error"); } });
  }


  /* ========================== COMMUNICATION ============================ */
  async function pageAnnouncements(content) {
    const data = await window.API.get("/announcements"); const rows = data.announcements || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Communication</div><h2>Announcements</h2><p>Create notices for everyone, students or parents; choose which ones are public.</p></div><button class="dash-btn dash-btn-primary" id="newAnnouncement">${I.plus} New Announcement</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Announcement</th><th>Audience</th><th>Public</th><th>Status</th><th>Published</th><th></th></tr></thead><tbody>${rows.length ? rows.map((a) => `<tr><td><strong>${esc(a.title)}</strong><small>${esc((a.body || "").slice(0, 130))}</small></td><td>${esc(a.audience)}</td><td>${a.publish_public ? "Yes" : "No"}</td><td><span class="dash-pill ${a.is_active ? "ok" : "danger"}">${a.is_active ? "active" : "archived"}</span></td><td>${fmtDate(a.created_at)}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-announcement="${a.id}">${I.edit}</button></td></tr>`).join("") : emptyRow(6, "No announcements yet.")}</tbody></table></div></div>`;
    const open = (a) => openAnnouncementModal(a, () => pageAnnouncements(content)); content.querySelector("#newAnnouncement").addEventListener("click", () => open(null)); content.querySelectorAll("[data-announcement]").forEach((b) => b.addEventListener("click", () => open(rows.find((a) => Number(a.id) === Number(b.dataset.announcement)))));
  }
  function openAnnouncementModal(a, done) {
    const isNew = !a; const modal = openModal(isNew ? "New announcement" : "Edit announcement", `<form id="announcementForm"><div class="dash-form-grid"><div class="dash-field" style="grid-column:1/-1"><label>Title</label><input name="title" required maxlength="200" value="${esc(a && a.title)}"></div><div class="dash-field" style="grid-column:1/-1"><label>Message</label><textarea name="body" required maxlength="5000">${esc(a && a.body)}</textarea></div><div class="dash-field"><label>Target audience</label><select name="target_type">${[["all","Entire institution"],["islamic_section","Islamic section"],["western_section","Western section"],["students","Students"],["teachers","Teachers"],["parents","Parents"],["specific_class","Specific class"],["specific_student_group","Specific student group"],["specific_teacher_group","Specific teacher group"],["individual_users","Individual users"]].map(([x,label]) => `<option value="${x}" ${(a && (a.target_type === x || (!a.target_type && a.audience === x))) ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="dash-field"><label>Publish / schedule date</label><input name="scheduled_at" type="date" value="${esc(a && a.scheduled_at || "")}"></div><div class="dash-field"><label>Add image (optional)</label><input name="image_file" type="file" accept="image/png,image/jpeg,image/webp">${a && a.image_path ? `<small class="dash-field-hint">Current: ${esc(a.image_path)}</small>` : ""}</div><div class="dash-field"><label>Add document / file (optional)</label><input name="attachment_file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/png,image/jpeg,image/webp">${a && a.attachment_path ? `<small class="dash-field-hint">Current: ${esc(a.attachment_name || a.attachment_path)}</small>` : ""}</div><div class="dash-field"><label>Publication status</label><select name="status">${["draft","scheduled","published","archived"].map((x) => `<option value="${x}" ${a && a.status === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div class="dash-field"><label>Public website expiry (optional)</label><input name="publish_until" type="date" value="${esc(a && a.publish_until || "")}"></div></div><label class="dash-checkbox"><input name="publish_public" type="checkbox" ${a && a.publish_public ? "checked" : ""}> Publish on public website</label><div class="dash-actions" style="margin-top:16px"><button class="dash-btn dash-btn-primary" type="submit">${I.check} ${isNew ? "Post" : "Save"}</button>${!isNew ? `<button class="dash-btn dash-btn-danger" type="button" id="archiveAnnouncement">Archive</button>` : ""}</div></form>`);
    const form = modal.querySelector("#announcementForm"); form.addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(form); const body = { title: fd.get("title"), body: fd.get("body"), target_type: fd.get("target_type"), target_ids: fd.get("target_ids"), status: fd.get("status") || "published", scheduled_at: fd.get("scheduled_at"), image_path: fd.get("image_path"), attachment_path: fd.get("attachment_path"), publish_public: fd.get("publish_public") === "on", publish_until: fd.get("publish_until") }; try { const saved = isNew ? await window.API.post("/announcements", body) : await window.API.patch(`/announcements/${a.id}`, body); const id = saved.id || (a && a.id); if (id && fd.get("image_file") && fd.get("image_file").size) { const image = new FormData(); image.append("image", fd.get("image_file")); await window.API.post(`/announcements/${id}/image`, image); } if (id && fd.get("attachment_file") && fd.get("attachment_file").size) { const attachment = new FormData(); attachment.append("attachment", fd.get("attachment_file")); await window.API.post(`/announcements/${id}/attachment`, attachment); } toast(isNew ? "Announcement posted." : "Announcement saved.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not save announcement.", "error"); } });
    const archive = modal.querySelector("#archiveAnnouncement"); if (archive) archive.addEventListener("click", async () => { if (!window.confirm("Archive this announcement?")) return; try { await window.API.del(`/announcements/${a.id}`); toast("Announcement archived.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not archive announcement.", "error"); } });
  }
  async function pageMessages(content) {
    const [inbox, sent, users] = await Promise.all([window.API.get("/communication/messages?folder=inbox"), window.API.get("/communication/messages?folder=sent"), window.API.get("/users").catch(() => ({ users: [] }))]);
    const rows = inbox.messages || []; const recipients = (users.users || []).filter((u) => Number(u.id) !== Number(state.me.user.id) && ["madrasa_admin", "teacher", "student", "parent"].includes(u.role));
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Communication</div><h2>Messages</h2><p>Private conversations between administrators, teachers, students and parents. Access is limited to conversation participants.</p></div><button id="newPrivateMessage" class="dash-btn dash-btn-primary">${I.plus} New message</button></div><div class="dash-stats-grid">${statCard("mail", rows.filter((m) => !m.read_at).length, "Unread")}${statCard("mail", rows.length, "Inbox")}${statCard("external", sent.messages ? sent.messages.length : 0, "Sent")}</div><div class="dash-card" style="margin-top:18px"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>From</th><th>Subject</th><th>Message</th><th>Date</th><th>Status</th></tr></thead><tbody>${rows.length ? rows.map((m) => `<tr><td>${esc(m.sender_name || "—")}</td><td>${esc(m.subject || "No subject")}</td><td>${esc((m.body || "").slice(0, 140))}</td><td>${fmtDate(m.created_at)}</td><td><span class="dash-pill ${m.read_at ? "info" : "warn"}">${m.read_at ? "Read" : "Unread"}</span></td></tr>`).join("") : emptyRow(5, "Your inbox is empty.")}</tbody></table></div></div>`;
    content.querySelector("#newPrivateMessage").addEventListener("click", () => { const modal = openModal("New message", `<form id="privateMessageForm"><div class="dash-form-grid"><div class="dash-field"><label>Recipient(s)</label><select name="recipient_user_ids" multiple required size="5">${recipients.map((u) => `<option value="${u.id}">${esc(u.full_name || u.username)} · ${esc(u.role)}</option>`).join("")}</select><small class="dash-field-hint">Hold Ctrl/Cmd to select several recipients for a group message.</small></div><div class="dash-field"><label>Subject</label><input name="subject" maxlength="200"></div><div class="dash-field" style="grid-column:1/-1"><label>Message</label><textarea name="body" required maxlength="10000" rows="7"></textarea></div></div><button class="dash-btn dash-btn-primary" type="submit">${I.check} Send message</button></form>`); modal.querySelector("#privateMessageForm").addEventListener("submit", async (e) => { e.preventDefault(); const f=e.target; const selected=[...f.elements.recipient_user_ids.selectedOptions].map((o)=>Number(o.value)); try { await window.API.post("/communication/messages", { recipient_user_ids:selected, subject:f.elements.subject.value, body:f.elements.body.value }); toast("Message sent.", "success"); closeModal(); pageMessages(content); } catch (err) { toast(err.message || "Could not send message.", "error"); } }); });
  }
  async function pageNotifications(content) {
    const data = await window.API.get("/communication/notifications"); const rows = data.notifications || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Communication</div><h2>Notifications</h2><p>Relevant academic, attendance, finance, admissions and school notices for your account.</p></div><button id="markAllNotifications" class="dash-btn dash-btn-ghost">${I.check} Mark all as read</button></div><div class="dash-stats-grid">${statCard("bell", data.unread || 0, "Unread notifications")}${statCard("activity", rows.length, "Notification history")}</div><div class="dash-card" style="margin-top:18px"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Notification</th><th>Type</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>${rows.length ? rows.map((n) => `<tr class="${n.read_at ? "" : "dash-notification-unread"}"><td><strong>${esc(n.title)}</strong><small>${esc(n.body)}</small></td><td>${esc(String(n.type || "notice").replace(/_/g, " "))}</td><td>${fmtDate(n.created_at)}</td><td><span class="dash-pill ${n.read_at ? "info" : "warn"}">${n.read_at ? "Read" : "Unread"}</span></td><td>${n.read_at ? "" : `<button class="dash-btn dash-btn-ghost dash-btn-sm" data-read-notification="${n.id}">Mark read</button>`}</td></tr>`).join("") : emptyRow(5, "No notifications yet.")}</tbody></table></div></div>`;
    content.querySelector("#markAllNotifications").addEventListener("click", async () => { try { await window.API.post("/communication/notifications/read-all", {}); toast("Notifications marked as read.", "success"); pageNotifications(content); } catch (e) { toast(e.message || "Could not update notifications.", "error"); } });
    content.querySelectorAll("[data-read-notification]").forEach((b) => b.addEventListener("click", async () => { try { await window.API.patch(`/communication/notifications/${b.dataset.readNotification}/read`, {}); pageNotifications(content); } catch (e) { toast(e.message || "Could not update notification.", "error"); } }));
  }
  async function pageParentCommunication(content) {
    const [directory, students] = await Promise.all([window.API.get("/communication/parents"), window.API.get("/students?perPage=200")]); const parents = directory.parents || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Communication</div><h2>Parent Communication</h2><p>Use the existing parent/guardian links to contact one family, a class or a student. Every delivery is recorded in communication history.</p></div><button class="dash-btn dash-btn-primary" id="messageParents">${I.plus} Contact parents</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Parent / guardian</th><th>Contact</th><th>Linked student(s)</th><th></th></tr></thead><tbody>${parents.length ? parents.map((p) => `<tr><td><strong>${esc(p.full_name || p.username)}</strong><small>@${esc(p.username)}</small></td><td>${esc(p.phone || p.email || "—")}</td><td>${esc((p.children || []).map((c) => `${c.first_name} ${c.last_name}`.trim()).join(", ") || "No linked students")}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-parent-id="${p.id}">History</button></td></tr>`).join("") : emptyRow(4, "No parent portal accounts yet. Use the existing student-parent relationship workflow to link families.")}</tbody></table></div></div><p class="hint" style="margin-top:12px">${students.total || 0} student record(s) are available for parent linking. Email, SMS and WhatsApp delivery remain provider-controlled; in-app delivery is recorded now.</p>`;
    content.querySelector("#messageParents").addEventListener("click", async () => { const modal=openModal("Contact parents", `<form id="parentMessageForm"><div class="dash-form-grid"><div class="dash-field"><label>Parent(s)</label><select name="parent_ids" multiple size="5">${parents.map((p)=>`<option value="${p.id}">${esc(p.full_name||p.username)}</option>`).join("")}</select></div><div class="dash-field"><label>Class (optional)</label><select name="class_id"><option value="">Choose a class</option></select></div><div class="dash-field"><label>Student (optional)</label><select name="student_id"><option value="">Choose a student</option>${(students.students||[]).map((s)=>`<option value="${s.id}">${esc(s.admission_no)} — ${esc(s.first_name)} ${esc(s.last_name)}</option>`).join("")}</select></div><div class="dash-field"><label>Type</label><select name="message_type"><option value="parent_message">General message</option><option value="attendance_alert">Attendance alert</option><option value="fee_reminder">Fee reminder</option><option value="result_notification">Result notification</option><option value="admission_update">Admission update</option></select></div><div class="dash-field" style="grid-column:1/-1"><label>Message</label><textarea name="message" required rows="6"></textarea></div></div><button class="dash-btn dash-btn-primary" type="submit">${I.check} Send and record</button></form>`); const classes=await window.API.get("/classes").catch(()=>({classes:[]})); modal.querySelector("[name=class_id]").innerHTML='<option value="">Choose a class</option>'+options(classes.classes||[]); modal.querySelector("#parentMessageForm").addEventListener("submit",async(e)=>{e.preventDefault();const f=e.target;try{await window.API.post("/communication/parents/send",{parent_ids:[...f.elements.parent_ids.selectedOptions].map((x)=>Number(x.value)),class_id:f.elements.class_id.value,student_id:f.elements.student_id.value,message_type:f.elements.message_type.value,message:f.elements.message.value});toast("Parent communication sent and recorded.","success");closeModal();pageParentCommunication(content);}catch(err){toast(err.message||"Could not contact parents.","error");}}); });
    content.querySelectorAll("[data-parent-id]").forEach((b)=>b.addEventListener("click",async()=>{try{const d=await window.API.get(`/communication/parents/${b.dataset.parentId}/history`);openModal("Communication history",`<div class="dash-message-list">${(d.history||[]).map((h)=>`<article class="dash-note"><strong>${esc(h.subject||h.message_type)}</strong><p>${esc(h.message)}</p><small>${esc(h.channel)} · ${fmtDate(h.created_at)}</small></article>`).join("")||'<p class="hint">No communication recorded.</p>'}</div>`);}catch(err){toast(err.message||"Could not load history.","error");}}));
  }

  /* ============================== FINANCE =============================== */
  async function pageFees(content) {
    const [data, base] = await Promise.all([window.API.get("/fees/items"), catalogue()]); const items = data.items || []; const terms = allTerms(base.sessions);
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>${T().feesLabel}</h2><p>Set amounts billed to each active student for a term.</p></div><button id="addFeeItem" class="dash-btn dash-btn-primary">${I.plus} Add Fee</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Fee</th><th>Term</th><th>Amount</th><th></th></tr></thead><tbody>${items.length ? items.map((f) => `<tr><td>${esc(f.name_en)}${f.name_ar ? `<small class="dash-ar">${esc(f.name_ar)}</small>` : ""}</td><td>${esc((terms.find((t) => Number(t.id) === Number(f.term_id)) || {}).name_en || "All terms")}</td><td>${fmtMoney(f.amount_ngn)}</td><td><button class="dash-btn dash-btn-ghost dash-btn-sm" data-fee-item="${f.id}">${I.edit}</button></td></tr>`).join("") : emptyRow(4, "No fee items yet.")}</tbody></table></div></div>`;
    const open = (f) => openFeeItemModal(f, terms, () => pageFees(content)); content.querySelector("#addFeeItem").addEventListener("click", () => open(null)); content.querySelectorAll("[data-fee-item]").forEach((b) => b.addEventListener("click", () => open(items.find((x) => Number(x.id) === Number(b.dataset.feeItem)))));
  }
  function openFeeItemModal(item, terms, done) { const modal = openModal(item ? "Edit fee item" : "Add fee item", `<form id="feeItemForm"><div class="dash-form-grid"><div class="dash-field"><label>Fee name</label><input name="name_en" required value="${esc(item && item.name_en)}"></div><div class="dash-field"><label>Arabic name</label><input name="name_ar" dir="rtl" value="${esc(item && item.name_ar)}"></div><div class="dash-field"><label>Term</label><select name="term_id"><option value="">All / no term</option>${options(terms, item && item.term_id, (t) => `${t.session_label} — ${t.name_en}`)}</select></div><div class="dash-field"><label>Amount (₦)</label><input name="amount_ngn" type="number" min="0" step="0.01" required value="${esc(item && item.amount_ngn || 0)}"></div></div><div class="dash-actions" style="margin-top:14px"><button class="dash-btn dash-btn-primary" type="submit">${I.check} Save fee</button>${item ? `<button id="deleteFeeItem" type="button" class="dash-btn dash-btn-danger">${I.trash}</button>` : ""}</div></form>`); const form = modal.querySelector("#feeItemForm"); form.addEventListener("submit", async (e) => { e.preventDefault(); try { const body = Object.fromEntries(new FormData(form)); if (item) await window.API.patch(`/fees/items/${item.id}`, body); else await window.API.post("/fees/items", body); toast("Fee item saved.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not save fee item.", "error"); } }); const del = modal.querySelector("#deleteFeeItem"); if (del) del.addEventListener("click", async () => { if (!window.confirm("Delete this fee item?")) return; try { await window.API.del(`/fees/items/${item.id}`); toast("Fee item deleted.", "success"); closeModal(); done(); } catch (err) { toast(err.message || "Could not delete fee item.", "error"); } }); }
  async function pagePayments(content) {
    const [data, students, items] = await Promise.all([window.API.get("/fees/payments"), window.API.get("/students?perPage=200"), window.API.get("/fees/items")]); const payments = data.payments || [];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>Payments & Fee Records</h2><p>Record verified payments; this dashboard does not process public payments.</p></div><button id="recordPayment" class="dash-btn dash-btn-primary">${I.plus} Record Payment</button></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Date</th><th>Student</th><th>Fee</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead><tbody>${payments.length ? payments.map((p) => `<tr><td>${fmtDate(p.payment_date)}</td><td>${esc(p.first_name)} ${esc(p.last_name)}<small>${esc(p.admission_no)}</small></td><td>${esc(p.item_en || "General payment")}</td><td>${fmtMoney(p.amount_ngn)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || "—")}</td><td><button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-payment="${p.id}">${I.trash}</button></td></tr>`).join("") : emptyRow(7, "No payments recorded yet.")}</tbody></table></div></div>`;
    content.querySelector("#recordPayment").addEventListener("click", () => { const modal = openModal("Record payment", `<form id="paymentForm"><div class="dash-form-grid"><div class="dash-field"><label>Student</label><select name="student_id" required><option value="">Select student</option>${options(students.students || [], null, (s) => `${s.admission_no} — ${s.first_name} ${s.last_name}`)}</select></div><div class="dash-field"><label>Fee item</label><select name="fee_item_id"><option value="">General payment</option>${options(items.items || [], null, (x) => x.name_en)}</select></div><div class="dash-field"><label>Amount (₦)</label><input name="amount_ngn" type="number" min="1" step="0.01" required></div><div class="dash-field"><label>Payment date</label><input name="payment_date" type="date" required value="${todayIso()}"></div><div class="dash-field"><label>Method</label><select name="method"><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="pos">POS</option><option value="other">Other</option></select></div><div class="dash-field"><label>Reference</label><input name="reference"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${I.check} Record Payment</button></form>`); modal.querySelector("#paymentForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.post("/fees/payments", Object.fromEntries(new FormData(e.target))); toast("Payment recorded.", "success"); closeModal(); pagePayments(content); } catch (err) { toast(err.message || "Could not record payment.", "error"); } }); });
    content.querySelectorAll("[data-delete-payment]").forEach((b) => b.addEventListener("click", async () => { if (!window.confirm("Delete this payment record?")) return; try { await window.API.del(`/fees/payments/${b.dataset.deletePayment}`); toast("Payment removed.", "success"); pagePayments(content); } catch (err) { toast(err.message || "Could not delete payment.", "error"); } }));
  }


  async function pageOutstandingFees(content) {
    const base = await catalogue(); const terms = allTerms(base.sessions); const selected = state.cache.feeTermId || (terms[0] && terms[0].id) || "";
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>Outstanding Fees</h2><p>Balances compare the active students’ term fees with payments allocated to those fee items.</p></div></div><div class="dash-card"><div class="dash-card-pad"><div class="dash-field" style="max-width:420px"><label>Term</label><select id="outstandingTerm"><option value="">Select a term</option>${options(terms, selected, (t) => `${t.session_label} — ${t.name_en}`)}</select></div><div id="outstandingRows" style="margin-top:18px"></div></div></div>`;
    const load = async () => { const term = content.querySelector("#outstandingTerm").value; const out = content.querySelector("#outstandingRows"); if (!term) return out.innerHTML = ""; state.cache.feeTermId = Number(term); try { const r = await window.API.get(`/fees/balance?termId=${term}`); out.innerHTML = `<div class="dash-info-line">Billed per active student: <b>${fmtMoney(r.billed)}</b></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Student</th><th>Billed</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>${r.students.length ? r.students.map((s) => `<tr><td>${esc(s.admission_no)} — ${esc(s.first_name)} ${esc(s.last_name)}</td><td>${fmtMoney(s.billed)}</td><td>${fmtMoney(s.paid)}</td><td>${fmtMoney(s.balance)}</td><td><span class="dash-pill ${s.settled ? "ok" : "warn"}">${s.settled ? "settled" : "outstanding"}</span></td></tr>`).join("") : emptyRow(5, "No active students.")}</tbody></table></div>`; } catch (err) { out.innerHTML = `<p class="dash-error">${esc(err.message || "Could not calculate balances.")}</p>`; } };
    content.querySelector("#outstandingTerm").addEventListener("change", load); if (selected) load();
  }
  async function pageFinanceReport(content) {
    const data = await window.API.get("/madrasa/analytics?months=12&attendanceDays=30"); const a = data.analytics || {};
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>Financial Reports</h2><p>Collection totals are based on recorded payments only.</p></div><a class="dash-btn dash-btn-ghost" href="${window.API.url("/exports/fees.csv")}" target="_blank" rel="noopener">${I.download} Export fee report</a></div><div class="dash-stats-grid">${statCard("money", fmtMoney(a.fees ? a.fees.collected : 0), "Recorded payments (all time)")}${statCard("money", fmtMoney(a.fees ? a.fees.thisMonth : 0), "Collected this month")}${statCard("activity", `${a.fees ? a.fees.collectionRate : 0}%`, "Collection rate")}${statCard("users", fmtMoney(a.fees ? a.fees.outstanding : 0), "Estimated outstanding")}</div><div class="dash-grid-2" style="margin-top:18px"><div class="dash-card"><div class="dash-card-head"><h3>Payment methods</h3></div><div class="dash-card-pad">${(a.fees && a.fees.byMethod || []).length ? `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Method</th><th>Payments</th><th>Amount</th></tr></thead><tbody>${a.fees.byMethod.map((m) => `<tr><td>${esc(m.key || "Other")}</td><td>${esc(m.payments || 0)}</td><td>${fmtMoney(m.value || 0)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No payment methods recorded in this window.</p>`}</div></div><div class="dash-card"><div class="dash-card-head"><h3>Students needing attention</h3></div><div class="dash-card-pad"><p class="dash-big-number">${a.fees ? a.fees.studentsInDebt : 0}</p><p class="hint">Active students with unpaid term balances. Use Outstanding Fees for the student-level report.</p><button class="dash-btn dash-btn-ghost" data-nav-route="finance/outstanding">Open outstanding fees</button></div></div></div>`; bindRouteButtons(content);
  }

  /* ============================== SETTINGS ============================== */
  async function pageRoles(content) {
    const rows = [["Madrasa Administrator", "Full control of this institution: staff, students, academics, admissions, finance, public website and tenant settings."], ["Teacher", "Only assigned classes and subjects: class rosters, attendance and results entry."], ["Student", "Own profile, homework, announcements, timetable, published results and report cards."], ["Parent", "Linked children only: profiles, homework, announcements, timetables, published results and report cards."]];
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Settings</div><h2>Roles & Permissions</h2><p>Permissions are enforced by the server; they cannot be changed from the browser.</p></div></div><div class="dash-card"><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Role</th><th>Access</th></tr></thead><tbody>${rows.map(([role, access]) => `<tr><td><strong>${esc(role)}</strong></td><td>${esc(access)}</td></tr>`).join("")}</tbody></table></div></div><div class="dash-card" style="margin-top:18px"><div class="dash-card-pad"><h3>Manage accounts</h3><p class="hint">Teacher, student and parent logins are created in their respective management screens. You can activate or deactivate existing accounts below.</p><button class="dash-btn dash-btn-primary" data-nav-route="settings/staff">Manage staff accounts</button></div></div>`; bindRouteButtons(content);
  }
  async function pageNotificationSettings(content) {
    const data = await window.API.get("/madrasa/settings"); const s = data.settings || {};
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Settings</div><h2>Notification Settings</h2><p>Choose administrator notification preferences. The system always keeps in-dashboard notices available.</p></div></div><div class="dash-card"><div class="dash-card-pad"><form id="notificationSettings"><label class="dash-toggle"><input type="checkbox" name="notify_admissions" ${s.notify_admissions === "1" ? "checked" : ""}><span>Show new admission alerts in the dashboard</span></label><label class="dash-toggle"><input type="checkbox" name="notify_results" ${s.notify_results === "1" ? "checked" : ""}><span>Show unpublished-result alerts in the dashboard</span></label><label class="dash-toggle"><input type="checkbox" name="notify_email" ${s.notify_email === "1" ? "checked" : ""}><span>Use the institution email as the notification contact</span></label><div class="dash-field" style="margin-top:16px"><label>Notification contact email</label><input type="email" name="notification_email" value="${esc(s.notification_email || "")}" placeholder="admin@example.org"></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save preferences</button></form><p class="hint" style="margin-top:14px">Email or SMS delivery is not connected until an operator configures a provider. These preferences are saved safely now and do not claim a message was sent.</p></div></div>`;
    content.querySelector("#notificationSettings").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.put("/madrasa/settings", { notify_admissions: fd.get("notify_admissions") === "on" ? "1" : "0", notify_results: fd.get("notify_results") === "on" ? "1" : "0", notify_email: fd.get("notify_email") === "on" ? "1" : "0", notification_email: fd.get("notification_email") }); toast("Notification preferences saved.", "success"); } catch (err) { toast(err.message || "Could not save notification preferences.", "error"); } });
  }


  async function pageAccountSettings(content) {
    const data = await window.API.get("/auth/account"); const a = data.account || {};
    content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Settings</div><h2>Administrator Account & Security</h2><p>Update your own contact details and change your password securely.</p></div></div><div class="dash-grid-2"><div class="dash-card"><div class="dash-card-head"><h3>Account details</h3></div><div class="dash-card-pad"><form id="accountForm"><div class="dash-form-grid"><div class="dash-field"><label>Username</label><input disabled value="${esc(a.username)}"></div><div class="dash-field"><label>Role</label><input disabled value="${esc(a.role)}"></div><div class="dash-field"><label>Full name</label><input name="full_name" value="${esc(a.full_name)}"></div><div class="dash-field"><label>Arabic name</label><input name="full_name_ar" dir="rtl" value="${esc(a.full_name_ar)}"></div><div class="dash-field"><label>Email</label><input name="email" type="email" value="${esc(a.email)}"></div><div class="dash-field"><label>Phone</label><input name="phone" value="${esc(a.phone)}"></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Save account details</button></form></div></div><div class="dash-card"><div class="dash-card-head"><h3>Change password</h3></div><div class="dash-card-pad"><form id="pwForm"><div class="dash-form-grid"><div class="dash-field" style="grid-column:1/-1"><label>Current Password</label><input name="currentPassword" autocomplete="current-password" type="password" required></div><div class="dash-field" style="grid-column:1/-1"><label>New Password</label><input name="newPassword" autocomplete="new-password" type="password" minlength="8" required></div></div><button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px">${I.check} Update password</button></form><p class="hint" style="margin-top:14px">Use at least eight characters and keep your password private.</p></div></div></div>`;
    content.querySelector("#accountForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await window.API.put("/auth/account", Object.fromEntries(new FormData(e.target))); toast("Account details saved.", "success"); } catch (err) { toast(err.message || "Could not update account.", "error"); } });
    content.querySelector("#pwForm").addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await window.API.post("/auth/change-password", { currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") }); toast("Password updated.", "success"); e.target.reset(); } catch (err) { toast(err.message || "Could not update password.", "error"); } });
  }

  /* ============================ SUPER ADMIN ============================== */
  /* Every page below talks only to the /api/platform/* endpoints, which the
     backend mounts behind requireSuperAdmin. The super admin has no tenant,
     so none of these call the /api/madrasa or /api/students families. */

  function catPill(cat) {
    return cat === "western"
      ? `<span class="dash-pill info">Western Academy</span>`
      : `<span class="dash-pill warn">Islamic School</span>`;
  }
  function statusPill(status) {
    const s = String(status || "").toLowerCase();
    if (s === "active") return "ok";
    if (s === "suspended") return "danger";
    return "info";
  }
  function fmtLimit(n) {
    return Number(n) < 0 ? "Unlimited" : String(n);
  }
  function shortLabel(label) {
    const s = String(label || "");
    let m = s.match(/^(\d{4})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-GB", { month: "short" });
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Number(m[3]);
    return s;
  }
  /** Hand-rolled bar chart over [{label, value}] — CSP forbids chart libs. */
  function saBars(series, height) {
    const vals = (series || []).map((s) => Number(s.value) || 0);
    const max = Math.max(1, ...vals);
    return `<div class="dash-bars" style="height:${height || 140}px;">
      ${(series || []).map((s) => {
        const v = Number(s.value) || 0;
        return `<div class="dash-bar-col" title="${esc(s.label)}: ${v}">
          <div class="dash-bar" style="height:${Math.max(4, Math.round((v / max) * 100))}px;"></div>
          <div class="dash-bar-label">${esc(shortLabel(s.label))}</div>
        </div>`;
      }).join("")}
    </div>`;
  }
  function planOptions(plans, selected) {
    return (plans || []).map((p) => `<option value="${p.id}" ${Number(p.id) === Number(selected) ? "selected" : ""}>${esc(p.name || p.code)}</option>`).join("");
  }

  function openModal(title, bodyHtml) {
    let wrap = document.querySelector(".dash-modal-backdrop");
    if (wrap) wrap.remove();
    wrap = document.createElement("div");
    wrap.className = "dash-modal-backdrop";
    wrap.innerHTML = `
      <div class="dash-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="dash-modal-head"><h3>${esc(title)}</h3><button class="dash-modal-close" type="button" aria-label="Close">${I.close}</button></div>
        <div class="dash-modal-body">${bodyHtml}</div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
    wrap.querySelector(".dash-modal-close").addEventListener("click", closeModal);
    return wrap;
  }
  function closeModal() {
    const w = document.querySelector(".dash-modal-backdrop");
    if (w) w.remove();
  }

  async function renderSuperRoute(content, route) {
    if (route === "platform" || route === "dashboard") return await pageSuperOverview(content);
    if (route === "platform/madaris") return await pageSuperMadaris(content);
    if (route.startsWith("platform/madaris/")) return await pageSuperMadarisDetail(content, decodeURIComponent(route.slice("platform/madaris/".length)));
    if (route === "platform/registrations") return await pageSuperRegistrations(content);
    if (route === "platform/plans") return await pageSuperPlans(content);
    if (route === "platform/analytics") return await pageSuperAnalytics(content);
    if (route === "platform/activity") return await pageSuperActivity(content);
    if (route === "platform/backups") return await pageSuperBackups(content);
    if (route === "platform/settings") return await pageSuperSettings(content);
    return pageComingSoon(content, "Platform", route);
  }

  /* ------------------------- Overview ---------------------------- */
  async function pageSuperOverview(content) {
    // Settled independently: a failing /stats call used to abandon the whole
    // destructuring, so the pending-registrations badge silently read 0 even
    // when applications were waiting.
    const [data, regs] = await Promise.all([
      window.API.get("/platform/stats").catch(() => null),
      window.API.get("/platform/registrations?status=Pending").catch(() => ({ registrations: [] })),
    ]);
    const pendingRegs = (regs.registrations || []).length;
    const act = (data && data.recentActivity) || [];
    const planMax = Math.max(1, ...((data && data.byPlan) || []).map((p) => Number(p.n) || 0));

    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Platform Overview</h2><p>Every institution on BELLO, at a glance.</p></div>
        <button class="dash-btn dash-btn-primary" data-nav-route="platform/madaris">${I.plus} Add Madrasa / Academy</button></div>

      ${pendingRegs ? `<div class="dash-alert" role="status">
        <span class="dash-alert-icon">${I.admissions}</span>
        <div class="dash-alert-body">
          <strong>${pendingRegs} registration${pendingRegs === 1 ? "" : "s"} waiting for review</strong>
          <span>Madrasas and academies that signed up are held here until you approve them.</span>
        </div>
        <button class="dash-btn dash-btn-primary dash-btn-sm" data-nav-route="platform/registrations">Review now</button>
      </div>` : ""}

      ${data ? `<div class="dash-stats-grid">
        ${statCard("building", Number(data.activeMadaris), "Active Madrasas / Total", false, " / " + Number(data.madaris))}
        ${statCard("users", data.students, "Students")}
        ${statCard("teacher", data.teachers, "Teachers")}
        ${statCard("shield", data.madrasaAdmins, "Institution Admins")}
        ${statCard("mail", data.parents, "Parents")}
        ${statCard("admissions", pendingRegs, "Registrations Pending", true)}
      </div>` : `<div class="dash-card" style="margin-bottom:22px;"><div class="dash-coming-soon">
          <div class="icon">${I.close}</div><h3>Could not load platform statistics</h3>
          <p>The counters above are unavailable right now. Everything else on this page still works.</p>
        </div></div>`}

      <div class="dash-grid-2">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Institutions by Plan</h3><span class="hint">Tenant mix</span></div>
          <div class="dash-card-pad">
            ${data && data.byPlan && data.byPlan.length
              ? `<div class="dash-bars" style="height:150px;">
                  ${data.byPlan.map((p) => `<div class="dash-bar-col" title="${esc(p.code)}: ${Number(p.n) || 0}">
                    <div class="dash-bar" style="height:${Math.max(4, Math.round(((Number(p.n) || 0) / planMax) * 100))}px;"></div>
                    <div class="dash-bar-label">${esc(p.code)}</div>
                  </div>`).join("")}
                </div>`
              : `<div class="dash-coming-soon"><p>No plans configured.</p></div>`}
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Recent Activity</h3><a class="dash-btn dash-btn-ghost dash-btn-sm" data-nav-route="platform/activity">View all</a></div>
          <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>Action</th><th>Who</th></tr></thead>
            <tbody>
              ${act.length ? act.slice(0, 8).map((a) => `<tr><td>${esc(a.action)}</td><td>${esc(a.username || "—")}${a.madrasa_slug ? ` · ${esc(a.madrasa_slug)}` : ""}</td></tr>`).join("")
                : `<tr class="dash-empty-row"><td colspan="2">No activity yet.</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  /* ------------------------- Madrasas list ---------------------------- */
  async function pageSuperMadaris(content) {
    const [data, plansData] = await Promise.all([
      window.API.get("/platform/madaris"),
      window.API.get("/platform/plans").catch(() => ({ plans: [] })),
    ]);
    const plans = plansData.plans || [];
    const rows = data.madaris || [];

    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Madrasas & Academies</h2><p>${rows.length} institution(s) on the platform.</p></div>
        <button class="dash-btn dash-btn-primary" id="saAddMadrasa">${I.plus} Add Madrasa / Academy</button></div>

      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Institution</th><th>Category</th><th>Plan</th><th>Students</th><th>Teachers</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((m) => `
            <tr>
              <td><strong>${esc(m.name_en)}</strong><div style="font-size:.74rem;color:var(--d-muted);">/${esc(m.slug)}</div></td>
              <td>${catPill(m.category)}</td>
              <td><select class="dash-select" data-plan="${m.id}" aria-label="Plan for ${esc(m.name_en)}">${planOptions(plans, m.plan_id)}</select></td>
              <td>${Number(m.student_count) || 0}</td>
              <td>${Number(m.teacher_count) || 0}</td>
              <td><span class="dash-pill ${statusPill(m.status)}">${esc(m.status)}</span></td>
              <td style="white-space:nowrap;text-align:right;">
                <button class="dash-btn dash-btn-ghost dash-btn-sm" data-view="${m.id}">${I.external} View</button>
                <button class="dash-btn dash-btn-sm ${m.status === "active" ? "dash-btn-danger" : "dash-btn-primary"}" data-status="${m.id}" data-to="${m.status === "active" ? "suspended" : "active"}">${m.status === "active" ? "Suspend" : "Activate"}</button>
              </td>
            </tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="7">No institutions yet — add the first one.</td></tr>`}
        </tbody>
      </table></div></div>
    `;

    content.querySelector("#saAddMadrasa").addEventListener("click", () => renderAddMadrasaModal(plans, content));
    content.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => go("platform/madaris/" + b.getAttribute("data-view"))));
    content.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-status");
      const to = b.getAttribute("data-to");
      b.disabled = true;
      try {
        await window.API.patch("/platform/madaris/" + id, { status: to });
        toast(to === "suspended" ? "Institution suspended." : "Institution activated.", "success");
        pageSuperMadaris(content);
      } catch (err) { toast(err.message || "Could not update status.", "error"); b.disabled = false; }
    }));
    content.querySelectorAll("[data-plan]").forEach((sel) => sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-plan");
      try {
        await window.API.patch("/platform/madaris/" + id, { plan_id: Number(sel.value) });
        toast("Plan updated.", "success");
      } catch (err) { toast(err.message || "Could not update plan.", "error"); pageSuperMadaris(content); }
    }));
  }

  function renderAddMadrasaModal(plans, content) {
    const wrap = openModal("Add Madrasa / Academy", `
      <form id="saMadrasaForm">
        <div class="dash-form-grid">
          <div class="dash-field" style="grid-column:1/-1;"><label>Category</label>
            <select name="category"><option value="islamic">Islamic School</option><option value="western">Western Academy</option></select>
          </div>
          <div class="dash-field"><label>English Name <span class="req">*</span></label><input name="name_en" required></div>
          <div class="dash-field"><label>Arabic Name</label><input name="name_ar"></div>
          <div class="dash-field"><label>Slug <span class="req">*</span></label><input name="slug" placeholder="noor-ul-islam" required></div>
          <div class="dash-field"><label>Plan</label><select name="plan_id">${planOptions(plans, "")}</select></div>
          <div class="dash-field"><label>City</label><input name="city"></div>
          <div class="dash-field"><label>State</label><input name="state_name"></div>
          <div class="dash-field"><label>Phone</label><input name="phone"></div>
          <div class="dash-field"><label>Email</label><input name="email" type="email"></div>
        </div>
        <div style="margin:16px 0 4px;font-size:.8rem;font-weight:800;color:var(--d-text);">Administrator account (optional but recommended)</div>
        <div class="dash-form-grid">
          <div class="dash-field"><label>Admin Username</label><input name="admin_username" autocomplete="off"></div>
          <div class="dash-field"><label>Admin Password</label><input name="admin_password" type="password" autocomplete="new-password" minlength="8"></div>
          <div class="dash-field"><label>Admin Full Name</label><input name="admin_full_name"></div>
        </div>
        <div class="dash-modal-foot" style="margin:18px -22px -20px;border-top:1px solid var(--d-line);">
          <button class="dash-btn dash-btn-ghost" type="button" id="saMadrasaCancel">Cancel</button>
          <button class="dash-btn dash-btn-primary" type="submit">${I.check} Create Institution</button>
        </div>
      </form>`);
    wrap.querySelector("#saMadrasaCancel").addEventListener("click", closeModal);
    wrap.querySelector("#saMadrasaForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      ["category", "name_en", "name_ar", "slug", "plan_id", "city", "state_name", "phone", "email", "admin_username", "admin_password", "admin_full_name"].forEach((k) => { const v = fd.get(k); if (v) body[k] = v; });
      body.plan_id = Number(body.plan_id || 1);
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        const r = await window.API.post("/platform/madaris", body);
        toast(r.adminCreated ? "Institution created with an administrator account." : "Institution created (no admin account).", "success");
        closeModal();
        pageSuperMadaris(content);
      } catch (err) {
        toast(err.message || "Could not create institution.", "error");
        btn.disabled = false; btn.textContent = "Create Institution";
      }
    });
  }

  /* ------------------------- Madrasa detail ---------------------------- */
  async function pageSuperMadarisDetail(content, id) {
    const num = Number(id);
    let data;
    try { data = await window.API.get("/platform/madaris/" + num); }
    catch (e) {
      content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Madrasa / Academy</h2></div></div>
        <div class="dash-card"><div class="dash-coming-soon"><div class="icon">${I.close}</div><h3>Not found</h3><p>${esc(e.message || "This institution does not exist.")}</p></div></div>`;
      return;
    }
    const [plansData] = await Promise.all([window.API.get("/platform/plans").catch(() => ({ plans: [] }))]);
    const m = data.madrasa;
    const admin = data.admin;
    const plans = plansData.plans || [];

    content.innerHTML = `
      <div class="dash-page-head">
        <div><div class="dash-crumb"><a href="#/app/platform/madaris">Platform / Madrasas & Academies</a></div><h2>${esc(m.name_en)}</h2>
          <p>/${esc(m.slug)} · ${catPill(m.category)} · <span class="dash-pill ${statusPill(m.status)}">${esc(m.status)}</span></p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="dash-btn dash-btn-ghost" data-nav-route="platform/madaris">${I.chev} Back</button>
          <button class="dash-btn ${m.status === "active" ? "dash-btn-danger" : "dash-btn-primary"}" id="saToggleStatus">${m.status === "active" ? "Suspend" : "Activate"}</button>
        </div>
      </div>

      <div class="dash-grid-2">
        <div class="dash-card"><div class="dash-card-head"><h3>Profile</h3></div><div class="dash-card-pad">
          <form id="saEditForm">
            <div class="dash-form-grid">
              <div class="dash-field"><label>Name (English)</label><input name="name_en" value="${esc(m.name_en)}"></div>
              <div class="dash-field"><label>Name (Arabic)</label><input name="name_ar" value="${esc(m.name_ar || "")}"></div>
              <div class="dash-field"><label>Motto / Tagline</label><input name="motto_en" value="${esc(m.motto_en || "")}"></div>
              <div class="dash-field"><label>City</label><input name="city" value="${esc(m.city || "")}"></div>
              <div class="dash-field"><label>State</label><input name="state_name" value="${esc(m.state_name || "")}"></div>
              <div class="dash-field"><label>Phone</label><input name="phone" value="${esc(m.phone || "")}"></div>
              <div class="dash-field"><label>Email</label><input name="email" value="${esc(m.email || "")}"></div>
              <div class="dash-field"><label>Website</label><input name="website" value="${esc(m.website || "")}"></div>
              <div class="dash-field"><label>Plan</label><select name="plan_id">${planOptions(plans, m.plan_id)}</select></div>
              <div class="dash-field" style="grid-column:1/-1;"><label>Address</label><input name="address" value="${esc(m.address || "")}"></div>
              <div class="dash-field" style="grid-column:1/-1;"><label>Description (English)</label><textarea name="description_en">${esc(m.description_en || "")}</textarea></div>
            </div>
            <div style="margin:16px 0 0;display:flex;gap:12px;flex-wrap:wrap;">
              <label class="dash-checkbox-row"><input type="checkbox" name="public_listing" ${Number(m.public_listing) ? "checked" : ""}> Public directory listing</label>
              <label class="dash-checkbox-row"><input type="checkbox" name="public_results" ${Number(m.public_results) ? "checked" : ""}> Public result checking</label>
              <label class="dash-checkbox-row"><input type="checkbox" name="public_admissions" ${Number(m.public_admissions) ? "checked" : ""}> Online admissions</label>
            </div>
            <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px;">${I.check} Save Changes</button>
          </form>
        </div></div>

        <div class="dash-stack">
          <div class="dash-card">
            <div class="dash-card-head"><h3>Administrator Account</h3></div>
            <div class="dash-card-pad">
              ${admin ? `<p style="margin:0 0 12px;font-size:.85rem;color:var(--d-muted);">Current: <strong>${esc(admin.username)}</strong>${admin.full_name ? ` · ${esc(admin.full_name)}` : ""}</p>`
                        : `<p style="margin:0 0 12px;font-size:.85rem;color:var(--d-warn);">No administrator account yet.</p>`}
              <form id="saAdminForm">
                <div class="dash-form-grid">
                  <div class="dash-field"><label>Username</label><input name="username" value="${esc(admin ? admin.username : "")}" required></div>
                  <div class="dash-field"><label>New Password</label><input name="password" type="password" minlength="8" required></div>
                  <div class="dash-field"><label>Full Name</label><input name="full_name" value="${esc(admin ? admin.full_name || "" : "")}"></div>
                  <div class="dash-field"><label>Email</label><input name="email" value="${esc(admin ? admin.email || "" : "")}"></div>
                  <div class="dash-field"><label>Phone</label><input name="phone" value="${esc(admin ? admin.phone || "" : "")}"></div>
                </div>
                <button class="dash-btn dash-btn-ghost" type="submit" style="margin-top:14px;">${I.refresh} ${admin ? "Reset Admin Credentials" : "Create Admin Account"}</button>
              </form>
            </div>
          </div>
          <div class="dash-card">
            <div class="dash-card-head"><h3>Facts</h3></div>
            <div class="dash-card-pad" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.85rem;">
              <div><small class="dash-field-hint">Students</small><div style="font-weight:800;">${Number(m.student_count) || 0}</div></div>
              <div><small class="dash-field-hint">Teachers</small><div style="font-weight:800;">${Number(m.teacher_count) || 0}</div></div>
              <div><small class="dash-field-hint">Plan</small><div style="font-weight:800;">${esc(m.plan_code || "—")}</div></div>
              <div><small class="dash-field-hint">Created</small><div style="font-weight:800;">${fmtDate(m.created_at)}</div></div>
            </div>
          </div>
        </div>
      </div>
    `;

    content.querySelector("#saToggleStatus").addEventListener("click", async () => {
      try {
        await window.API.patch("/platform/madaris/" + num, { status: m.status === "active" ? "suspended" : "active" });
        toast("Status updated.", "success");
        pageSuperMadarisDetail(content, id);
      } catch (err) { toast(err.message || "Could not update status.", "error"); }
    });
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
    content.querySelector("#saEditForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { plan_id: Number(fd.get("plan_id")) };
      ["name_en", "name_ar", "motto_en", "city", "state_name", "phone", "email", "website", "address", "description_en"].forEach((k) => { const v = fd.get(k); if (v) body[k] = v; });
      ["public_listing", "public_results", "public_admissions"].forEach((k) => { body[k] = fd.get(k) === "on"; });
      try { await window.API.patch("/platform/madaris/" + num, body); toast("Saved.", "success"); pageSuperMadarisDetail(content, id); }
      catch (err) { toast(err.message || "Could not save.", "error"); }
    });
    content.querySelector("#saAdminForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await window.API.post("/platform/madaris/" + num + "/admin", {
          username: fd.get("username"), password: fd.get("password"),
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
        });
        toast("Administrator credentials saved.", "success");
        pageSuperMadarisDetail(content, id);
      } catch (err) { toast(err.message || "Could not save administrator.", "error"); }
    });
  }

  /* ------------------------- Registrations ---------------------------- */
  async function pageSuperRegistrations(content) {
    // The filter lives in app state, not on the #dashContent element: every
    // hashchange rebuilds the shell, so an attribute stored there was wiped
    // and the list silently snapped back to "All".
    const statusFilter = state.regStatusFilter || "";
    const q = statusFilter ? ("?status=" + encodeURIComponent(statusFilter)) : "";
    const data = await window.API.get("/platform/registrations" + q).catch(() => ({ registrations: [] }));
    const rows = data.registrations || [];

    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Registrations</h2><p>Public sign-ups awaiting review — approving promotes an application into a live institution with its own admin login.</p></div></div>

      <div class="dash-card" style="margin-bottom:16px;"><div class="dash-card-pad" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${[["", "All"], ["Pending", "Pending"], ["Approved", "Approved"], ["Rejected", "Rejected"]].map(([v, label]) =>
          `<button class="dash-btn dash-btn-sm ${statusFilter === v ? "dash-btn-primary" : "dash-btn-ghost"}" data-sa-reg-filter="${v}">${label}</button>`).join("")}
      </div></div>

      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Institution</th><th>Category</th><th>Type</th><th>Location</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => `
            <tr>
              <td><strong>${esc(r.name)}</strong>${r.adminFullName ? `<div style="font-size:.74rem;color:var(--d-muted);">${esc(r.adminFullName)}</div>` : ""}</td>
              <td>${catPill(r.category)}</td>
              <td>${esc(r.institutionType || "—")}</td>
              <td>${esc(r.city || "—")}</td>
              <td>${fmtDate(r.submittedAt)}</td>
              <td><span class="dash-pill ${pillFor(r.status)}">${esc(r.status)}</span></td>
              <td style="white-space:nowrap;text-align:right;">
                <button class="dash-btn dash-btn-ghost dash-btn-sm" data-reg-view="${r.id}">${I.external} Review</button>
                ${r.status === "Pending" ? `<button class="dash-btn dash-btn-sm dash-btn-primary" data-reg-approve="${r.id}">${I.check} Approve</button>
                <button class="dash-btn dash-btn-sm dash-btn-danger" data-reg-reject="${r.id}">Reject</button>` : ""}
              </td>
            </tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="7">No registrations${statusFilter ? " in this state" : ""} yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;

    content.querySelectorAll("[data-sa-reg-filter]").forEach((b) => b.addEventListener("click", async () => {
      state.regStatusFilter = b.getAttribute("data-sa-reg-filter");
      await pageSuperRegistrations(content);
    }));
    content.querySelectorAll("[data-reg-view]").forEach((b) => b.addEventListener("click", () => openRegistrationModal(b.getAttribute("data-reg-view"), content)));
    content.querySelectorAll("[data-reg-approve]").forEach((b) => b.addEventListener("click", () => openRegistrationModal(b.getAttribute("data-reg-approve"), content, "approve")));
    content.querySelectorAll("[data-reg-reject]").forEach((b) => b.addEventListener("click", () => openRegistrationModal(b.getAttribute("data-reg-reject"), content, "reject")));
  }

  async function openRegistrationModal(id, content, focusAction) {
    const detail = await window.API.get("/platform/registrations/" + id).catch(() => null);
    const plansData = await window.API.get("/platform/plans").catch(() => ({ plans: [] }));
    const raw = detail ? detail.registration : null;
    if (!raw) { toast("Could not load this registration.", "error"); return; }
    // The detail endpoint returns the raw DB row (snake_case) plus category.
    const r = {
      registrationId: raw.registration_id,
      status: raw.status,
      name: raw.name,
      officialName: raw.official_name,
      description: raw.description,
      institutionType: raw.institution_type,
      stateName: raw.state_name,
      city: raw.city,
      address: raw.address,
      phone: raw.phone,
      email: raw.email,
      website: raw.website,
      adminFullName: raw.admin_full_name,
      adminEmail: raw.admin_email,
      adminPhone: raw.admin_phone,
      category: raw.category,
      subjects: raw.subjects || [],
      ageGroups: raw.ageGroups || [],
    };
    const subjects = r.subjects;
    const ageGroups = r.ageGroups;
    const isPending = r.status === "Pending";

    openModal(`Registration ${r.registrationId || id}`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;font-size:.85rem;">
        <div><small class="dash-field-hint">Institution</small><div><strong>${esc(r.name)}</strong></div></div>
        <div><small class="dash-field-hint">Official Name</small><div>${esc(r.officialName || "—")}</div></div>
        <div><small class="dash-field-hint">Category</small><div>${catPill(r.category)} ${esc(r.institutionType || "")}</div></div>
        <div><small class="dash-field-hint">Location</small><div>${esc([r.city, r.stateName].filter(Boolean).join(", ") || "—")}</div></div>
        <div><small class="dash-field-hint">Contact</small><div>${esc(r.adminEmail || r.email || "—")}<br>${esc(r.adminPhone || r.phone || "—")}</div></div>
        <div><small class="dash-field-hint">Status</small><div><span class="dash-pill ${pillFor(r.status)}">${esc(r.status)}</span></div></div>
        <div style="grid-column:1/-1;"><small class="dash-field-hint">Description</small><div>${esc(r.description || "—")}</div></div>
        <div style="grid-column:1/-1;"><small class="dash-field-hint">Subjects / programs</small><div>${subjects.length ? subjects.map((s) => `<span class="dash-pill muted">${esc(typeof s === "string" ? s : s.name || s.label || JSON.stringify(s))}</span>`).join(" ") : "—"}</div></div>
        <div style="grid-column:1/-1;"><small class="dash-field-hint">Age groups</small><div>${ageGroups.length ? ageGroups.map((a) => esc(typeof a === "string" ? a : a.label || JSON.stringify(a))).join(", ") : "—"}</div></div>
      </div>

      ${isPending ? `
        <div id="saRegActions" style="margin-top:18px;border-top:1px solid var(--d-line);padding-top:16px;">
          <div class="dash-form-grid" style="margin-bottom:14px;">
            <div class="dash-field"><label>Slug (optional)</label><input id="saRegSlug" placeholder="Leave blank to derive from the name"></div>
            <div class="dash-field"><label>Plan</label><select id="saRegPlan">${planOptions(plansData.plans || [], "")}</select></div>
          </div>
          <div class="dash-field" style="margin-bottom:14px;"><label>Rejection note</label><textarea id="saRegNote" placeholder="Required only when rejecting"></textarea></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="dash-btn dash-btn-danger" id="saRegRejectBtn">Reject</button>
            <button class="dash-btn dash-btn-primary" id="saRegApproveBtn">${I.check} Approve &amp; Create Institution</button>
          </div>
        </div>` : ""}
    `);

    if (!isPending) return;
    const slug = document.getElementById("saRegSlug");
    const plan = document.getElementById("saRegPlan");
    const note = document.getElementById("saRegNote");
    document.getElementById("saRegApproveBtn").addEventListener("click", async () => {
      const btn = document.getElementById("saRegApproveBtn");
      btn.disabled = true; btn.textContent = "Approving…";
      try {
        const body = { plan_id: Number(plan.value || 1) };
        if (slug.value.trim()) body.slug = slug.value.trim();
        const res = await window.API.post("/platform/registrations/" + id + "/approve", body);
        toast(`Approved — ${res.slug} is live (admin: ${res.username}).`, "success");
        closeModal();
        pageSuperRegistrations(content);
      } catch (err) { toast(err.message || "Could not approve.", "error"); btn.disabled = false; btn.textContent = "Approve & Create Institution"; }
    });
    document.getElementById("saRegRejectBtn").addEventListener("click", async () => {
      const btn = document.getElementById("saRegRejectBtn");
      btn.disabled = true; btn.textContent = "Rejecting…";
      try {
        await window.API.post("/platform/registrations/" + id + "/reject", { note: note.value.trim() });
        toast("Registration rejected.", "success");
        closeModal();
        pageSuperRegistrations(content);
      } catch (err) { toast(err.message || "Could not reject.", "error"); btn.disabled = false; btn.textContent = "Reject"; }
    });
    if (focusAction === "approve") setTimeout(() => { const b = document.getElementById("saRegApproveBtn"); if (b) b.focus(); }, 0);
    if (focusAction === "reject") setTimeout(() => { const b = document.getElementById("saRegRejectBtn"); if (b) b.focus(); }, 0);
  }

  /* ------------------------- Plans ---------------------------- */
  async function pageSuperPlans(content) {
    const data = await window.API.get("/platform/plans").catch(() => ({ plans: [] }));
    const plans = data.plans || [];
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Subscription Plans</h2><p>Limits and pricing applied to institutions. −1 means unlimited.</p></div>
        <button class="dash-btn dash-btn-primary" id="saAddPlan">${I.plus} New Plan</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Code</th><th>Name</th><th>Price / month</th><th>Student limit</th><th>Teacher limit</th><th>Madrasas</th><th></th></tr></thead>
        <tbody>
          ${plans.length ? plans.map((p) => `
            <tr>
              <td><strong>${esc(p.code)}</strong></td>
              <td>${esc(p.name)}${p.name_ar ? ` · <span lang="ar" dir="rtl">${esc(p.name_ar)}</span>` : ""}</td>
              <td>${fmtMoney(p.price_ngn)}</td>
              <td>${fmtLimit(p.student_limit)}</td>
              <td>${fmtLimit(p.teacher_limit)}</td>
              <td>${Number(p.madaris_count) || 0}</td>
              <td style="text-align:right;"><button class="dash-btn dash-btn-ghost dash-btn-sm" data-plan-edit="${p.id}">${I.edit} Edit</button></td>
            </tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="7">No plans yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
    content.querySelector("#saAddPlan").addEventListener("click", () => openPlanModal(null, content, plans));
    content.querySelectorAll("[data-plan-edit]").forEach((b) => b.addEventListener("click", () => {
      const p = plans.find((x) => String(x.id) === b.getAttribute("data-plan-edit"));
      openPlanModal(p, content, plans);
    }));
  }

  function openPlanModal(plan, content, plans) {
    const isNew = !plan;
    const features = (plan && plan.features && typeof plan.features === "object") ? JSON.stringify(plan.features) : "";
    const wrap = openModal(isNew ? "New Plan" : "Edit Plan", `
      <form id="saPlanForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Code <span class="req">*</span></label><input name="code" value="${esc(plan ? plan.code : "")}" ${isNew ? "" : "readonly"} required></div>
          <div class="dash-field"><label>Name <span class="req">*</span></label><input name="name" value="${esc(plan ? plan.name : "")}" required></div>
          <div class="dash-field"><label>Name (Arabic)</label><input name="name_ar" value="${esc(plan ? plan.name_ar || "" : "")}"></div>
          <div class="dash-field"><label>Price (₦ / month)</label><input name="price_ngn" type="number" min="0" step="0.01" value="${plan ? Number(plan.price_ngn) : 0}"></div>
          <div class="dash-field"><label>Student limit</label><input name="student_limit" type="number" value="${plan ? Number(plan.student_limit) : -1}"></div>
          <div class="dash-field"><label>Teacher limit</label><input name="teacher_limit" type="number" value="${plan ? Number(plan.teacher_limit) : -1}"></div>
          <div class="dash-field"><label>Sort order</label><input name="sort_order" type="number" value="${plan ? Number(plan.sort_order) : 99}"></div>
          <div class="dash-field" style="grid-column:1/-1;"><label>Features (JSON)</label><textarea name="features" placeholder='{"portal": true, "exports": true}'>${esc(features)}</textarea></div>
        </div>
        <div class="dash-modal-foot" style="margin:18px -22px -20px;border-top:1px solid var(--d-line);">
          <button class="dash-btn dash-btn-ghost" type="button" id="saPlanCancel">Cancel</button>
          <button class="dash-btn dash-btn-primary" type="submit">${I.check} ${isNew ? "Create Plan" : "Save Plan"}</button>
        </div>
      </form>`);
    wrap.querySelector("#saPlanCancel").addEventListener("click", closeModal);
    wrap.querySelector("#saPlanForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      let features = {};
      const rawFeatures = String(fd.get("features") || "").trim();
      if (rawFeatures) { try { features = JSON.parse(rawFeatures); } catch (err) { toast("Features must be valid JSON (or blank).", "error"); return; } }
      const body = {
        code: fd.get("code"), name: fd.get("name"), name_ar: fd.get("name_ar"),
        price_ngn: Number(fd.get("price_ngn") || 0),
        student_limit: Number(fd.get("student_limit") === "" ? -1 : fd.get("student_limit")),
        teacher_limit: Number(fd.get("teacher_limit") === "" ? -1 : fd.get("teacher_limit")),
        sort_order: Number(fd.get("sort_order") || 0),
        features,
      };
      try {
        if (isNew) await window.API.post("/platform/plans", body);
        else await window.API.patch("/platform/plans/" + plan.id, body);
        toast(isNew ? "Plan created." : "Plan saved.", "success");
        closeModal();
        pageSuperPlans(content);
      } catch (err) { toast(err.message || "Could not save plan.", "error"); }
    });
  }

  /* ------------------------- Analytics ---------------------------- */
  async function pageSuperAnalytics(content) {
    const data = await window.API.get("/platform/analytics?months=12").catch(() => null);
    const a = data ? data.analytics : null;
    if (!a) {
      content.innerHTML = `<div class="dash-card"><div class="dash-coming-soon"><div class="icon">${I.close}</div><h3>Could not load analytics</h3></div></div>`;
      return;
    }
    const t = a.totals;
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Platform Analytics</h2><p>Platform-wide aggregates — no student-level data.</p></div></div>

      <div class="dash-stats-grid">
        ${statCard("building", t.madaris, "Institutions", true)}
        ${statCard("users", t.students, "Students")}
        ${statCard("teacher", t.teachers, "Teachers")}
        ${statCard("mail", t.parents, "Parents")}
        ${statCard("shield", t.madrasaAdmins, "Institution Admins")}
        ${statCard("money", fmtMoney(t.feesCollected), "Fees Collected")}
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Institution Growth</h3><span class="hint">New institutions / month</span></div>
          <div class="dash-card-pad">${saBars(a.madrasaTrend, 150)}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Enrolment Growth</h3><span class="hint">New students / month</span></div>
          <div class="dash-card-pad">${saBars(a.studentTrend, 150)}</div>
        </div>
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Top Institutions</h3><span class="hint">By enrolment</span></div>
          <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>Institution</th><th>Students</th><th>Fees</th><th>Status</th></tr></thead>
            <tbody>
              ${a.topMadaris.length ? a.topMadaris.slice(0, 10).map((m) => `<tr><td>${esc(m.label)}</td><td>${m.students}</td><td>${fmtMoney(m.fees)}</td><td><span class="dash-pill ${statusPill(m.status)}">${esc(m.status)}</span></td></tr>`).join("")
                : `<tr class="dash-empty-row"><td colspan="4">No institutions yet.</td></tr>`}
            </tbody>
          </table></div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Plan Mix</h3></div>
          <div class="dash-card-pad">
            ${a.byPlan.length ? a.byPlan.map((p) => `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:4px;"><span>${esc(p.label)}</span><strong>${p.madaris} · ${p.students} students</strong></div>
                <div style="height:8px;border-radius:6px;background:var(--d-surface-2);overflow:hidden;"><div style="height:100%;width:${Math.round((p.madaris / Math.max(1, t.madaris)) * 100)}%;background:var(--d-primary-700);"></div></div>
              </div>`).join("") : `<div class="dash-coming-soon"><p>No plans.</p></div>`}
          </div>
        </div>
      </div>

      <div class="dash-grid-2">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Fee Collections</h3><span class="hint">₦ / month</span></div>
          <div class="dash-card-pad">${saBars(a.feeTrend, 150)}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Top Actions</h3><span class="hint">All time</span></div>
          <div class="dash-card-pad">
            ${a.activity && a.activity.topActions.length ? a.activity.topActions.map((x) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--d-line-soft);font-size:.84rem;"><span>${esc(x.action)}</span><strong>${x.value}</strong></div>`).join("") : `<div class="dash-coming-soon"><p>No activity.</p></div>`}
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------- Activity log ---------------------------- */
  async function pageSuperActivity(content) {
    const data = await window.API.get("/platform/activity?limit=200").catch(() => ({ activity: [] }));
    const rows = data.activity || [];
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Activity Log</h2><p>The last ${rows.length} events across the whole platform.</p></div>
        <button class="dash-btn dash-btn-ghost" id="saActivityRefresh">${I.refresh} Refresh</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>When</th><th>Action</th><th>User</th><th>Institution</th><th>Entity</th><th>IP</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((a) => `<tr>
              <td>${fmtDate(a.created_at)}</td>
              <td><strong>${esc(a.action)}</strong></td>
              <td>${esc(a.username || "—")}</td>
              <td>${a.madrasa_name ? `<a href="#/app/platform/madaris/${a.madrasa_id}" style="font-weight:700;">${esc(a.madrasa_name)}</a>` : "—"}</td>
              <td>${esc(a.entity || "—")}${a.entity_id ? ` #${esc(a.entity_id)}` : ""}</td>
              <td style="font-family:ui-monospace,monospace;font-size:.76rem;">${esc(a.ip || "—")}</td>
            </tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="6">No activity recorded yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
    content.querySelector("#saActivityRefresh").addEventListener("click", () => pageSuperActivity(content));
  }

  /* ------------------------- Backups & storage ---------------------------- */
  async function pageSuperBackups(content) {
    const [bk, diag] = await Promise.all([
      window.API.get("/platform/backups").catch(() => null),
      window.API.get("/platform/diagnostics").catch(() => null),
    ]);
    const p = diag ? diag.persistence : null;
    const level = p ? p.level : "unknown";
    const levelLabel = level === "critical" ? "Critical" : level === "warn" ? "Warning" : level === "ok" ? "Healthy" : "Unknown";
    const backups = (bk && bk.backups) || [];

    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Backups & Storage</h2><p>Snapshots of the whole database, plus a plain-language verdict on whether this host keeps its data.</p></div>
        <button class="dash-btn dash-btn-primary" id="saBackupNow">${I.plus} Create Snapshot Now</button></div>

      ${p ? `<div class="dash-card" style="margin-bottom:16px;border-color:${level === "critical" ? "var(--d-danger)" : level === "warn" ? "var(--d-warn)" : "var(--d-line)"};">
        <div class="dash-card-head"><h3>Storage Verdict</h3><span class="dash-pill ${level === "ok" ? "ok" : level === "critical" ? "danger" : "warn"}">${levelLabel}</span></div>
        <div class="dash-card-pad">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;font-size:.84rem;margin-bottom:14px;">
            <div><small class="dash-field-hint">Database</small><div style="font-weight:750;">${p.externalDatabase ? "External MySQL" : esc(p.databaseFile || "SQLite")}</div></div>
            <div><small class="dash-field-hint">Data dir</small><div style="font-weight:750;">${esc(p.dataDir && p.dataDir.dir ? p.dataDir.dir : "—")}</div></div>
            <div><small class="dash-field-hint">Madrasas now</small><div style="font-weight:750;">${p.counts ? p.counts.madaris : "—"}</div></div>
            <div><small class="dash-field-hint">Backups kept</small><div style="font-weight:750;">${diag && diag.backups ? diag.backups.count : backups.length} · every ${diag && diag.backups ? diag.backups.intervalMinutes : 0} min</div></div>
          </div>
          ${(p.warnings && p.warnings.length) ? p.warnings.map((w) => `<div style="padding:10px 14px;border-radius:10px;background:var(--d-surface-2);margin-bottom:8px;font-size:.82rem;"><strong>${esc(w.code)}</strong> — ${esc(w.message)}</div>`).join("") : `<p style="margin:0;font-size:.84rem;color:var(--d-ok);font-weight:650;">${I.check} No storage warnings.</p>`}
        </div>
      </div>` : ""}

      <div class="dash-card"><div class="dash-card-head"><h3>Snapshots</h3><span class="hint">Newest first</span></div>
        <div class="dash-table-wrap"><table class="dash-table">
          <thead><tr><th>Created</th><th>File</th><th>Size</th><th>Madrasas</th><th></th></tr></thead>
          <tbody>
            ${backups.length ? backups.map((b) => `<tr>
                <td>${fmtDate(b.createdAt)}</td>
                <td style="font-family:ui-monospace,monospace;font-size:.76rem;">${esc(b.name)}</td>
                <td>${Math.round((Number(b.bytes) || 0) / 1024)} KB</td>
                <td>${b.counts && b.counts.madaris != null ? b.counts.madaris : "—"}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <a class="dash-btn dash-btn-ghost dash-btn-sm" href="${window.API.url("/platform/backups/" + encodeURIComponent(b.name) + "/download")}">${I.download} Download</a>
                  <button class="dash-btn dash-btn-sm dash-btn-danger" data-sa-backup-del="${esc(b.name)}">${I.trash}</button>
                </td>
              </tr>`).join("")
              : `<tr class="dash-empty-row"><td colspan="5">No snapshots yet — create one now, or start the server with BACKUP_INTERVAL_MINUTES &gt; 0 for automatic snapshots.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    content.querySelector("#saBackupNow").addEventListener("click", async () => {
      const btn = content.querySelector("#saBackupNow");
      btn.disabled = true; btn.textContent = "Snapshotting…";
      try { await window.API.post("/platform/backups", {}); toast("Snapshot created.", "success"); pageSuperBackups(content); }
      catch (err) { toast(err.message || "Could not create snapshot.", "error"); btn.disabled = false; btn.textContent = "Create Snapshot Now"; }
    });
    content.querySelectorAll("[data-sa-backup-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!window.confirm("Delete this snapshot? This cannot be undone.")) return;
      try { await window.API.del("/platform/backups/" + encodeURIComponent(b.getAttribute("data-sa-backup-del"))); toast("Snapshot deleted.", "success"); pageSuperBackups(content); }
      catch (err) { toast(err.message || "Could not delete snapshot.", "error"); }
    }));
  }

  /* ------------------------- Platform settings ---------------------------- */
  async function pageSuperSettings(content) {
    const data = await window.API.get("/platform/settings").catch(() => ({ settings: {} }));
    const s = data.settings || {};
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Platform</div><h2>Platform Settings</h2><p>Global defaults and the public-directory kill switch.</p></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="saSettingsForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>Public site title</label><input name="public_site_title" value="${esc(s.public_site_title || "")}"></div>
            <div class="dash-field"><label>Public site tagline</label><input name="public_site_tagline" value="${esc(s.public_site_tagline || "")}"></div>
            <div class="dash-field" style="grid-column:1/-1;"><label>Public site intro</label><textarea name="public_site_intro">${esc(s.public_site_intro || "")}</textarea></div>
            <div class="dash-field"><label>Contact email</label><input name="public_contact_email" value="${esc(s.public_contact_email || "")}"></div>
            <div class="dash-field"><label>Contact phone</label><input name="public_contact_phone" value="${esc(s.public_contact_phone || "")}"></div>
            <div class="dash-field"><label>Public apply URL</label><input name="public_apply_url" value="${esc(s.public_apply_url || "")}"></div>
          </div>
          <label class="dash-checkbox-row" style="margin-top:16px;"><input type="checkbox" name="public_directory_enabled" ${s.public_directory_enabled ? "checked" : ""}> Public directory enabled</label>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:16px;">${I.check} Save Settings</button>
        </form>
      </div></div>
    `;
    content.querySelector("#saSettingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      ["public_site_title", "public_site_tagline", "public_site_intro", "public_contact_email", "public_contact_phone", "public_apply_url"].forEach((k) => { body[k] = fd.get(k); });
      body.public_directory_enabled = fd.get("public_directory_enabled") === "on";
      try { await window.API.put("/platform/settings", body); toast("Settings saved.", "success"); }
      catch (err) { toast(err.message || "Could not save settings.", "error"); }
    });
  }

  /* --------------------------------------------------------------------
     Public entry point: mounted by index.html whenever #/app/... or the
     dashboard container is present. Also exposed so app.js can invoke it
     after redirecting a freshly-logged-in institution admin.
     -------------------------------------------------------------------- */
  window.BelloDashboard = { boot, go };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeBoot);
  } else {
    maybeBoot();
  }
  function maybeBoot() {
    if (document.getElementById(ROOT_ID)) boot();
  }
})();
