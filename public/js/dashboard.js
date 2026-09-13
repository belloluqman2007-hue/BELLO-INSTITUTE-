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
  function sidebarSchema(cat) {
    const western = cat === "western";
    const inst = western ? "Academy" : "Institution";
    return [
      { key: "dashboard", label: "Dashboard", icon: "dashboard", route: "dashboard" },
      {
        key: "institution", label: western ? "My Academy" : "My Institution", icon: "building",
        items: [
          [`${inst} Profile`, "institution/profile"],
          [`${inst} Information`, "institution/information"],
          ["Public Website", "institution/website"],
          ["Website Appearance", "institution/appearance"],
          ["Website Pages", "institution/pages"],
          ["Gallery", "institution/gallery"],
          ["Contact Information", "institution/contact"],
          ["Settings", "institution/settings"],
        ],
      },
      {
        key: "students", label: "Students", icon: "users",
        items: [
          ["All Students", "students/all"],
          ["Add Student", "students/add"],
          ["Student Applications", "students/applications"],
          ["Student Groups", "students/groups"],
          ["Student Profiles", "students/profiles"],
        ],
      },
      {
        key: "teachers", label: "Teachers", icon: "teacher",
        items: [
          ["All Teachers", "teachers/all"],
          ["Add Teacher", "teachers/add"],
          ["Teacher Applications", "teachers/applications"],
          ["Teacher Profiles", "teachers/profiles"],
        ],
      },
      {
        key: "classes", label: "Classes", icon: "classes",
        items: [
          ["All Classes", "classes/all"],
          ["Add Class", "classes/add"],
          ["Class Timetable", "classes/timetable"],
          ["Class Students", "classes/students"],
          ["Class Teachers", "classes/teachers"],
        ],
      },
      western ? {
        key: "programs", label: "Academic Programs", icon: "book",
        items: [
          ["Mathematics", "subjects/Mathematics"], ["English", "subjects/English"],
          ["Sciences", "subjects/Sciences"], ["Computer Science", "subjects/Computer Science"],
          ["Technology", "subjects/Technology"], ["Business", "subjects/Business"],
          ["Arts", "subjects/Arts"], ["Social Sciences", "subjects/Social Sciences"],
          ["Languages", "subjects/Languages"], ["Other Subjects", "subjects/Other Subjects"],
        ],
      } : {
        key: "subjects", label: "Islamic Subjects", icon: "book",
        items: [
          ["Qur'an", "subjects/Qur'an"], ["Qur'an Memorization", "subjects/Qur'an Memorization"],
          ["Tajweed", "subjects/Tajweed"], ["Hadith", "subjects/Hadith"], ["Fiqh", "subjects/Fiqh"],
          ["Tawheed", "subjects/Tawheed"], ["Aqeedah", "subjects/Aqeedah"], ["Seerah", "subjects/Seerah"],
          ["Arabic", "subjects/Arabic"], ["Nahw", "subjects/Nahw"], ["Sarf", "subjects/Sarf"],
          ["Islamic Studies", "subjects/Islamic Studies"], ["Other Subjects", "subjects/Other Subjects"],
        ],
      },
      {
        key: "attendance", label: "Attendance", icon: "calendar",
        items: [
          ["Student Attendance", "attendance/students"],
          ["Teacher Attendance", "attendance/teachers"],
          ["Attendance Reports", "attendance/reports"],
        ],
      },
      {
        key: "academic", label: "Academic", icon: "academic",
        items: [
          ["Lessons", "academic/lessons"], ["Assignments", "academic/assignments"],
          ["Examinations", "academic/examinations"], ["Results", "academic/results"],
          ["Report Cards", "academic/report-cards"], ["Academic Sessions", "academic/sessions"],
          ["Terms", "academic/terms"],
        ],
      },
      {
        key: "admissions", label: "Admissions", icon: "admissions",
        items: [
          ["Applications", "admissions/applications"],
          ["Admission Status", "admissions/status"],
          ["Admission Requirements", "admissions/requirements"],
          ["Admission Settings", "admissions/settings"],
        ],
      },
      {
        key: "communication", label: "Communication", icon: "chat",
        items: [
          ["Announcements", "communication/announcements"],
          ["Messages", "communication/messages"],
          ["Notifications", "communication/notifications"],
          ["Parent Communication", "communication/parents"],
        ],
      },
      {
        key: "finance", label: "Finance", icon: "money",
        items: [
          [western ? "Academy Fees" : "School Fees", "finance/fees"],
          ["Payments", "finance/payments"],
          ["Outstanding Fees", "finance/outstanding"],
          ["Fee Records", "finance/records"],
          ["Financial Reports", "finance/reports"],
        ],
      },
      {
        key: "website", label: "Website", icon: "globe",
        items: [
          ["Public Website", "website/public"],
          ["Edit Homepage", "website/homepage"],
          [western ? "About Academy" : "About Institution", "website/about"],
          [western ? "Programs" : "Programs/Courses", "website/programs"],
          ["Teachers", "website/teachers"],
          ["Admissions", "website/admissions"],
          ["Gallery", "website/gallery"],
          ["News & Announcements", "website/news"],
          ["Contact Page", "website/contact"],
          ["Website Appearance", "website/appearance"],
        ],
      },
      {
        key: "settings", label: "Settings", icon: "settings",
        items: [
          [western ? "Academy Settings" : "Institution Settings", "settings/institution"],
          ["Administrator Account", "settings/account"],
          ["Staff Accounts", "settings/staff"],
          ["Roles & Permissions", "settings/roles"],
          ["Password & Security", "settings/security"],
          ["Notifications", "settings/notifications"],
        ],
      },
    ];
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

  function T() {
    const w = state.category === "western";
    return {
      institutionLabel: w ? "Academy" : "Institution",
      instNoun: w ? "academy" : "institution",
      websiteCardTitle: w ? "Your Academy Website" : "Your Institution Website",
      addBtnHint: w ? "academy" : "institution",
    };
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
              <small>${session.role === "super_admin" ? "Platform Super Admin" : (session.category === "western" ? "Western Academy Admin" : "Islamic School Admin")}${session.institutionName ? " — " + esc(session.institutionName) : ""}</small>
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
    const map = {
      dashboard: "Dashboard", institution: "My Institution", students: "Students",
      teachers: "Teachers", classes: "Classes", subjects: "Subjects", attendance: "Attendance",
      academic: "Academic", admissions: "Admissions", communication: "Communication",
      finance: "Finance", website: "Website", settings: "Settings",
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
                <small>${state.superAdmin ? "Super Admin" : (cat === "western" ? "Western Academy Admin" : "Islamic School Admin")}</small>
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
     Route dispatch
     -------------------------------------------------------------------- */
  async function renderRoute(root) {
    const content = root.querySelector("#dashContent");
    content.innerHTML = `<div class="dash-coming-soon"><div class="icon">${I.clock}</div><h3>Loading…</h3></div>`;
    const route = state.route;
    try {
      if (state.superAdmin) return await renderSuperRoute(content, route);
      if (route === "dashboard") return await pageDashboard(content);
      if (route === "institution/profile" || route === "institution/information") return await pageInstitutionProfile(content);
      if (route === "institution/website") return await pageWebsiteOverview(content);
      if (route === "institution/appearance" || route === "website/appearance") return await pageAppearance(content);
      if (route === "institution/gallery" || route === "website/gallery") return await pageGallery(content);
      if (route === "institution/contact" || route === "website/contact") return await pageContact(content);
      if (route === "institution/settings" || route === "settings/institution") return await pageInstitutionProfile(content);
      if (route === "institution/pages" || route === "website/homepage" || route === "website/about" || route === "website/programs" || route === "website/news" || route === "website/public" || route === "website/admissions" || route === "website/teachers") {
        return pageWebsiteBuilderStub(content, route);
      }

      if (route === "students/all") return await pageStudentsAll(content);
      if (route === "students/add") return await pageStudentAdd(content);
      if (route === "students/applications") return await pageAdmissionApplications(content);
      if (route === "students/groups" || route === "students/profiles") return pageComingSoon(content, "Students", route);

      if (route === "teachers/all") return await pageTeachersAll(content);
      if (route === "teachers/add") return await pageTeacherAdd(content);
      if (route === "teachers/applications" || route === "teachers/profiles") return pageComingSoon(content, "Teachers", route);

      if (route === "classes/all") return await pageClassesAll(content);
      if (route === "classes/add") return await pageClassAdd(content);
      if (route === "classes/timetable") return await pageTimetable(content);
      if (route === "classes/students" || route === "classes/teachers") return pageComingSoon(content, "Classes", route);

      if (route.startsWith("subjects/")) return await pageSubjectDetail(content, decodeURIComponent(route.slice("subjects/".length)));

      if (route === "attendance/students") return await pageAttendanceStudents(content);
      if (route === "attendance/teachers" || route === "attendance/reports") return pageComingSoon(content, "Attendance", route);

      if (route === "academic/sessions") return await pageSessions(content);
      if (route === "academic/results") return pageComingSoon(content, "Results", route, "Enter and publish results from the Academic → Results workbook — reuse the existing results engine per class and term.");
      if (route.startsWith("academic/")) return pageComingSoon(content, "Academic", route);

      if (route === "admissions/applications" || route === "admissions/status") return await pageAdmissionApplications(content);
      if (route.startsWith("admissions/")) return pageComingSoon(content, "Admissions", route);

      if (route === "communication/announcements") return await pageAnnouncements(content);
      if (route.startsWith("communication/")) return pageComingSoon(content, "Communication", route);

      if (route === "finance/fees") return await pageFeeItems(content);
      if (route === "finance/payments" || route === "finance/records") return await pageFeePayments(content);
      if (route === "finance/outstanding" || route === "finance/reports") return pageComingSoon(content, "Finance", route);

      if (route === "settings/account") return await pageAccountSettings(content);
      if (route === "settings/staff") return await pageTeachersAll(content);
      if (route.startsWith("settings/")) return pageComingSoon(content, "Settings", route);

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
        <p>${esc(note || "This screen is on the roadmap for this section — the sidebar, tenant scoping and data model are already in place, and the workspace will appear here in a coming update.")}</p>
      </div></div>`;
  }
  function routeLabel(route) {
    const last = route.split("/").pop();
    return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function pageWebsiteBuilderStub(content, route) {
    pageComingSoon(content, "Website", route, "Edit this section from Website Appearance — logo, colors and hero image already save to your live public page.");
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
    let data;
    try { data = await window.API.get("/madrasa/dashboard"); } catch (e) { data = null; }
    state.dashboardData = data;
    const m = (state.profile && state.profile.madrasa) || {};
    const t = T();
    const slug = m.slug || "your-institution";
    const url = `${slug}.bello.ng`;
    const s = (data && data.stats) || { totalStudents: 0, totalTeachers: 0, totalClasses: 0, totalSubjects: 0, pendingApplications: 0, attendanceToday: { present: 0, absent: 0, late: 0, unmarked: 0 } };
    const att = s.attendanceToday;

    content.innerHTML = `
      <div class="dash-website-card" style="margin-bottom:22px;">
        <div class="dash-website-info">
          <div class="label">${esc(t.websiteCardTitle)}</div>
          <div class="url">${esc(url)}</div>
          <div class="desc">Your public page is live and updates automatically as you edit your ${esc(t.instNoun)} in this dashboard.</div>
        </div>
        <div class="dash-website-actions">
          <a class="dash-btn dash-btn-accent" href="/s/${esc(slug)}" target="_blank" rel="noopener">${I.external} Visit Website</a>
          <button class="dash-btn dash-btn-ghost" data-nav-route="institution/appearance" style="color:#fff;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.08);">${I.edit} Edit Website</button>
        </div>
      </div>

      <div class="dash-stats-grid">
        ${statCard("users", s.totalStudents, "Total Students")}
        ${statCard("teacher", s.totalTeachers, "Total Teachers")}
        ${statCard("classes", s.totalClasses, "Total Classes")}
        ${statCard("book", s.totalSubjects, "Total Subjects")}
        ${statCard("calendar", att.present + "/" + (att.present + att.absent + att.late + att.unmarked), "Attendance Today", true)}
        ${statCard("admissions", s.pendingApplications, "Pending Applications", true)}
      </div>

      <div class="dash-grid-2" style="margin-bottom:18px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Student Overview</h3><span class="hint">Enrollment</span></div>
          <div class="dash-card-pad">
            <div class="dash-bars">
              ${["Class A", "Class B", "Class C", "Class D"].map((l, i) => `<div class="dash-bar-col"><div class="dash-bar" style="height:${Math.max(10, (i + 1) * 22)}px"></div><div class="dash-bar-label">${l}</div></div>`).join("")}
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

  async function pageInstitutionProfile(content) {
    const profile = await window.API.get("/madrasa/profile");
    state.profile = profile;
    const m = profile.madrasa;
    const t = T();
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">My ${esc(t.institutionLabel)}</div><h2>${esc(t.institutionLabel)} Profile</h2><p>Core details shown across your dashboard and public website.</p></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="profileForm">
          <div class="dash-form-grid">
            ${field("name_en", "Name (English)", m.name_en)}
            ${field("name_ar", "Name (Arabic)", m.name_ar)}
            ${field("motto_en", "Motto / Tagline", m.tagline || m.motto_en)}
            ${field("phone", "Phone", m.phone)}
            ${field("email", "Email", m.email)}
            ${field("city", "City", m.city)}
            ${field("state_name", "State", m.state_name)}
            ${field("address", "Address", m.address, true)}
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;">
            <button class="dash-btn dash-btn-primary" type="submit">${I.check} Save Changes</button>
          </div>
        </form>
      </div></div>
    `;
    function field(name, label, val, full) {
      return `<div class="dash-field"${full ? ' style="grid-column:1/-1;"' : ""}><label>${esc(label)}</label><input name="${name}" value="${esc(val || "")}"></div>`;
    }
    content.querySelector("#profileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { tagline: fd.get("motto_en") };
      ["name_en", "name_ar", "phone", "email", "city", "state_name", "address"].forEach((k) => body[k] = fd.get(k));
      try {
        await window.API.put("/madrasa/profile", body);
        toast("Profile updated.", "success");
        pageInstitutionProfile(content);
      } catch (err) { toast(err.message || "Could not save.", "error"); }
    });
  }

  async function pageWebsiteOverview(content) {
    const m = (state.profile && state.profile.madrasa) || {};
    const site = await window.API.get("/madrasa/public-site").catch(() => null);
    const slug = m.slug || "your-institution";
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Website</div><h2>Public Website</h2><p>Your live, standalone public page.</p></div></div>
      <div class="dash-website-card" style="margin-bottom:20px;">
        <div class="dash-website-info">
          <div class="label">Live URL</div>
          <div class="url">${esc(slug)}.bello.ng</div>
          <div class="desc">Also reachable at /s/${esc(slug)} on this deployment.</div>
        </div>
        <div class="dash-website-actions">
          <a class="dash-btn dash-btn-accent" href="/s/${esc(slug)}" target="_blank" rel="noopener">${I.external} Visit Website</a>
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
              <div class="dash-field"><label>Brand Color</label><input name="brand_color" type="color" value="${esc(m.brand_color || (state.category === "western" ? "#0a2342" : "#200a3d"))}"></div>
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
        </div>` : `<div class="dash-coming-soon"><div class="icon">${I.image}</div><h3>No photos yet</h3><p>Add photos of your ${state.category === "western" ? "academy" : "institution"} — classrooms, events, students at work.</p></div>`}
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

  async function pageContact(content) {
    const m = (state.profile && state.profile.madrasa) || {};
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">My ${esc(T().institutionLabel)}</div><h2>Contact Information</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="contactForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>Phone</label><input name="phone" value="${esc(m.phone || "")}"></div>
            <div class="dash-field"><label>Email</label><input name="email" value="${esc(m.email || "")}"></div>
            <div class="dash-field"><label>WhatsApp</label><input name="whatsapp" value="${esc(m.whatsapp || "")}"></div>
            <div class="dash-field"><label>Facebook</label><input name="facebook" value="${esc(m.facebook || "")}"></div>
            <div class="dash-field"><label>Instagram</label><input name="instagram" value="${esc(m.instagram || "")}"></div>
            <div class="dash-field"><label>Map Link</label><input name="maps_link" value="${esc(m.maps_link || "")}"></div>
            <div class="dash-field" style="grid-column:1/-1;"><label>Address</label><input name="address" value="${esc(m.address || "")}"></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Save Contact Info</button>
        </form>
      </div></div>
    `;
    content.querySelector("#contactForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      ["phone", "email", "whatsapp", "facebook", "instagram", "maps_link", "address"].forEach((k) => body[k] = fd.get(k));
      try { await window.API.put("/madrasa/profile", body); toast("Contact info saved.", "success"); }
      catch (err) { toast(err.message || "Could not save.", "error"); }
    });
  }

  /* ============================= STUDENTS =============================== */

  async function pageStudentsAll(content) {
    const data = await window.API.get("/students?perPage=100");
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>All Students</h2><p>${data.total} student(s) enrolled.</p></div>
        <button class="dash-btn dash-btn-primary" data-nav-route="students/add">${I.plus} Add Student</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Admission No.</th><th>Name</th><th>Class</th><th>Gender</th><th>Status</th></tr></thead>
        <tbody>
          ${data.students.length ? data.students.map((s) => `<tr><td>${esc(s.admission_no)}</td><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td>${esc(s.class_en || "—")}</td><td>${esc(s.gender || "—")}</td><td><span class="dash-pill ${pillFor(s.status)}">${esc(s.status)}</span></td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="5">No students yet — click Add Student to enroll your first one.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  async function pageStudentAdd(content) {
    const classes = await window.API.get("/classes").catch(() => ({ classes: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>Add Student</h2><p>An admission number is generated automatically.</p></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="addStudentForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>First Name <span class="req">*</span></label><input name="first_name" required></div>
            <div class="dash-field"><label>Last Name</label><input name="last_name"></div>
            <div class="dash-field"><label>Gender</label><select name="gender"><option value="">—</option><option value="M">Male</option><option value="F">Female</option></select></div>
            <div class="dash-field"><label>Date of Birth</label><input name="date_of_birth" type="date"></div>
            <div class="dash-field"><label>Class</label><select name="class_id"><option value="">Unassigned</option>${classes.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}</select></div>
            <div class="dash-field"><label>Parent/Guardian Name</label><input name="parent_name"></div>
            <div class="dash-field"><label>Parent Phone</label><input name="parent_phone"></div>
            <div class="dash-field" style="grid-column:1/-1;"><label>Address</label><input name="address"></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Save Student</button>
        </form>
      </div></div>
    `;
    content.querySelector("#addStudentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      ["first_name", "last_name", "gender", "date_of_birth", "class_id", "parent_name", "parent_phone", "address"].forEach((k) => { const v = fd.get(k); if (v) body[k] = v; });
      try {
        const r = await window.API.post("/students", body);
        toast(`Student added — Admission No. ${r.admissionNo}`, "success");
        go("students/all");
      } catch (err) { toast(err.message || "Could not add student.", "error"); }
    });
  }

  /* ============================= TEACHERS ================================ */

  async function pageTeachersAll(content) {
    const data = await window.API.get("/teachers");
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Teachers</div><h2>All Teachers</h2><p>${data.teachers.length} teacher(s) on staff.</p></div>
        <button class="dash-btn dash-btn-primary" data-nav-route="teachers/add">${I.plus} Add Teacher</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Name</th><th>Username</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>
          ${data.teachers.length ? data.teachers.map((t) => `<tr><td>${esc(t.full_name)}</td><td>${esc(t.username)}</td><td>${esc(t.phone || "—")}</td><td><span class="dash-pill ${t.is_active ? "ok" : "muted"}">${t.is_active ? "Active" : "Inactive"}</span></td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="4">No teachers yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  async function pageTeacherAdd(content) {
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Teachers</div><h2>Add Teacher</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="addTeacherForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>Full Name <span class="req">*</span></label><input name="full_name" required></div>
            <div class="dash-field"><label>Username <span class="req">*</span></label><input name="username" required></div>
            <div class="dash-field"><label>Temporary Password <span class="req">*</span></label><input name="password" type="password" minlength="8" required></div>
            <div class="dash-field"><label>Email</label><input name="email" type="email"></div>
            <div class="dash-field"><label>Phone</label><input name="phone"></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Save Teacher</button>
        </form>
      </div></div>
    `;
    content.querySelector("#addTeacherForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      ["full_name", "username", "password", "email", "phone"].forEach((k) => { const v = fd.get(k); if (v) body[k] = v; });
      try { await window.API.post("/teachers", body); toast("Teacher added.", "success"); go("teachers/all"); }
      catch (err) { toast(err.message || "Could not add teacher.", "error"); }
    });
  }

  /* ============================== CLASSES ================================ */

  async function pageClassesAll(content) {
    const data = await window.API.get("/classes");
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>All Classes</h2></div>
        <button class="dash-btn dash-btn-primary" data-nav-route="classes/add">${I.plus} Add Class</button></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Class</th><th>Students</th><th>Subjects</th></tr></thead>
        <tbody>
          ${data.classes.length ? data.classes.map((c) => `<tr><td>${esc(c.name_en)}</td><td>${c.student_count}</td><td>${c.subject_count}</td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="3">No classes yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
    content.querySelectorAll("[data-nav-route]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.getAttribute("data-nav-route")); }));
  }

  async function pageClassAdd(content) {
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Add Class</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="addClassForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>Class Name <span class="req">*</span></label><input name="name_en" required></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Save Class</button>
        </form>
      </div></div>
    `;
    content.querySelector("#addClassForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await window.API.post("/classes", { name_en: fd.get("name_en") }); toast("Class created.", "success"); go("classes/all"); }
      catch (err) { toast(err.message || "Could not create class.", "error"); }
    });
  }

  async function pageTimetable(content) {
    const classes = await window.API.get("/classes").catch(() => ({ classes: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Classes</div><h2>Class Timetable</h2><p>Select a class to view or print its weekly timetable.</p></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <div class="dash-field" style="max-width:320px;"><label>Class</label>
          <select id="ttClass"><option value="">Select a class…</option>${classes.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}</select>
        </div>
        <div id="ttResult" style="margin-top:16px;"></div>
      </div></div>
    `;
    content.querySelector("#ttClass").addEventListener("change", (e) => {
      const id = e.target.value;
      const out = content.querySelector("#ttResult");
      if (!id) { out.innerHTML = ""; return; }
      out.innerHTML = `<a class="dash-btn dash-btn-primary" href="${window.API.url("/timetable/print?classId=" + id)}" target="_blank" rel="noopener">${I.external} Open Printable Timetable</a>`;
    });
  }

  /* ============================== SUBJECTS ================================ */

  async function pageSubjectDetail(content, name) {
    const subs = await window.API.get("/subjects").catch(() => ({ subjects: [] }));
    const existing = subs.subjects.find((s) => s.name_en === name);
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">${state.category === "western" ? "Academic Programs" : "Islamic Subjects"}</div><h2>${esc(name)}</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        ${existing
          ? `<p style="color:var(--d-ok);font-weight:700;display:flex;align-items:center;gap:8px;">${I.check} This subject is active for your ${state.category === "western" ? "academy" : "institution"}.</p>`
          : `<p style="color:var(--d-muted);margin-bottom:14px;">This subject has not been added yet.</p>
             <button class="dash-btn dash-btn-primary" id="addSubjBtn">${I.plus} Add "${esc(name)}"</button>`}
      </div></div>
    `;
    const btn = content.querySelector("#addSubjBtn");
    if (btn) btn.addEventListener("click", async () => {
      try { await window.API.post("/subjects", { name_en: name }); toast("Subject added.", "success"); pageSubjectDetail(content, name); }
      catch (err) { toast(err.message || "Could not add subject.", "error"); }
    });
  }

  /* ============================= ATTENDANCE ================================ */

  async function pageAttendanceStudents(content) {
    const classes = await window.API.get("/classes").catch(() => ({ classes: [] }));
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Attendance</div><h2>Student Attendance</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <div class="dash-form-grid" style="margin-bottom:14px;">
          <div class="dash-field"><label>Class</label><select id="attClass"><option value="">Select a class…</option>${classes.classes.map((c) => `<option value="${c.id}">${esc(c.name_en)}</option>`).join("")}</select></div>
          <div class="dash-field"><label>Date</label><input id="attDate" type="date" value="${today}"></div>
        </div>
        <div id="attBody"></div>
      </div></div>
    `;
    async function load() {
      const classId = content.querySelector("#attClass").value;
      const date = content.querySelector("#attDate").value;
      const body = content.querySelector("#attBody");
      if (!classId || !date) { body.innerHTML = ""; return; }
      const data = await window.API.get(`/attendance?classId=${classId}&date=${date}`);
      body.innerHTML = `
        <table class="dash-table"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>
          ${data.students.map((s) => `
            <tr><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td>
              <select data-sid="${s.id}">
                <option value="">—</option>
                <option value="present" ${s.status === "present" ? "selected" : ""}>Present</option>
                <option value="absent" ${s.status === "absent" ? "selected" : ""}>Absent</option>
                <option value="excused" ${s.status === "excused" ? "selected" : ""}>Excused</option>
              </select>
            </td></tr>`).join("")}
        </tbody></table>
        <button class="dash-btn dash-btn-primary" id="saveAttBtn" style="margin-top:14px;">${I.check} Save Attendance</button>
      `;
      body.querySelector("#saveAttBtn").addEventListener("click", async () => {
        const statuses = {};
        body.querySelectorAll("[data-sid]").forEach((sel) => { if (sel.value) statuses[sel.getAttribute("data-sid")] = sel.value; });
        try { await window.API.post("/attendance/mark", { classId: Number(classId), date, statuses }); toast("Attendance saved.", "success"); }
        catch (err) { toast(err.message || "Could not save.", "error"); }
      });
    }
    content.querySelector("#attClass").addEventListener("change", load);
    content.querySelector("#attDate").addEventListener("change", load);
  }

  /* ============================= ACADEMIC ================================ */

  async function pageSessions(content) {
    const data = await window.API.get("/sessions").catch(() => ({ sessions: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Academic</div><h2>Academic Sessions</h2></div></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Session</th><th>Terms</th><th>Current</th></tr></thead>
        <tbody>
          ${data.sessions.length ? data.sessions.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.terms.length}</td><td>${s.is_current ? I.check : "—"}</td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="3">No sessions yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
  }

  /* ============================= ADMISSIONS ================================ */

  async function pageAdmissionApplications(content) {
    const data = await window.API.get("/admissions").catch(() => ({ requests: [] }));
    const rows = data.requests || data.applications || [];
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Admissions</div><h2>Applications</h2></div></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Reference</th><th>Applicant</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => `<tr><td>${esc(r.reference)}</td><td>${esc(r.first_name || "")} ${esc(r.last_name || "")}</td><td><span class="dash-pill ${pillFor(r.status)}">${esc(r.status)}</span></td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="3">No applications yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
  }

  /* ============================ COMMUNICATION ============================== */

  async function pageAnnouncements(content) {
    const data = await window.API.get("/announcements").catch(() => ({ announcements: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Communication</div><h2>Announcements</h2></div>
        <button class="dash-btn dash-btn-primary" id="newAnnBtn">${I.plus} New Announcement</button></div>
      <div class="dash-card"><div class="dash-card-pad" id="annForm" style="display:none;border-bottom:1px solid var(--d-line);padding-bottom:16px;margin-bottom:16px;">
        <div class="dash-form-grid">
          <div class="dash-field" style="grid-column:1/-1;"><label>Title</label><input id="annTitle"></div>
          <div class="dash-field" style="grid-column:1/-1;"><label>Message</label><textarea id="annBody"></textarea></div>
        </div>
        <button class="dash-btn dash-btn-primary" id="annSaveBtn" style="margin-top:10px;">${I.check} Post</button>
      </div>
      <div class="dash-card-pad">
        ${data.announcements.length ? data.announcements.map((a) => `
          <div style="padding:10px 0;border-bottom:1px solid var(--d-line-soft);"><strong>${esc(a.title)}</strong><div style="font-size:.82rem;color:var(--d-muted);margin-top:2px;">${esc(a.body)}</div></div>`).join("")
          : `<div class="dash-coming-soon"><p>No announcements yet.</p></div>`}
      </div></div>
    `;
    content.querySelector("#newAnnBtn").addEventListener("click", () => {
      const f = content.querySelector("#annForm");
      f.style.display = f.style.display === "none" ? "block" : "none";
    });
    content.querySelector("#annSaveBtn").addEventListener("click", async () => {
      const title = content.querySelector("#annTitle").value.trim();
      const body = content.querySelector("#annBody").value.trim();
      if (!title || !body) return toast("Title and message are required.", "error");
      try { await window.API.post("/announcements", { title, body }); toast("Announcement posted.", "success"); pageAnnouncements(content); }
      catch (err) { toast(err.message || "Could not post.", "error"); }
    });
  }

  /* =============================== FINANCE ================================= */

  async function pageFeeItems(content) {
    const data = await window.API.get("/fees/items").catch(() => ({ items: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>${state.category === "western" ? "Academy" : "School"} Fees</h2></div></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Fee</th><th>Amount</th></tr></thead>
        <tbody>
          ${data.items && data.items.length ? data.items.map((f) => `<tr><td>${esc(f.name_en)}</td><td>${fmtMoney(f.amount_ngn)}</td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="2">No fee items yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
  }

  async function pageFeePayments(content) {
    const data = await window.API.get("/fees/payments").catch(() => ({ payments: [] }));
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Finance</div><h2>Payments</h2></div></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
        <tbody>
          ${data.payments && data.payments.length ? data.payments.map((p) => `<tr><td>${fmtDate(p.payment_date)}</td><td>${fmtMoney(p.amount_ngn)}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td></tr>`).join("")
            : `<tr class="dash-empty-row"><td colspan="4">No payments recorded yet.</td></tr>`}
        </tbody>
      </table></div></div>
    `;
  }

  /* =============================== SETTINGS ================================= */

  async function pageAccountSettings(content) {
    content.innerHTML = `
      <div class="dash-page-head"><div><div class="dash-crumb">Settings</div><h2>Administrator Account</h2></div></div>
      <div class="dash-card"><div class="dash-card-pad">
        <form id="pwForm">
          <div class="dash-form-grid">
            <div class="dash-field"><label>Current Password</label><input name="currentPassword" type="password" required></div>
            <div class="dash-field"><label>New Password</label><input name="newPassword" type="password" minlength="8" required></div>
          </div>
          <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px;">${I.check} Update Password</button>
        </form>
      </div></div>
    `;
    content.querySelector("#pwForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await window.API.post("/auth/change-password", { currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") });
        toast("Password updated.", "success");
        e.target.reset();
      } catch (err) { toast(err.message || "Could not update password.", "error"); }
    });
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
