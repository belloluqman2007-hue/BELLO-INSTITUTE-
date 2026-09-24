"use strict";

/* Desktop UI screens for the EduSphere promotional video. */

const { C, icon, text, rrect, pill, btn, browserChrome, dashShell, statCard, card, cardHead, table, LOGO_B64 } = require("./lib");

/* Shared full-frame backdrop for app-window plates */
function backdrop(accent2) {
    return `
  <defs>
    <radialGradient id="glowA" cx="18%" cy="12%" r="60%">
      <stop offset="0%" stop-color="#3d1472"/><stop offset="100%" stop-color="#17062d"/>
    </radialGradient>
    <radialGradient id="glowB" cx="85%" cy="95%" r="55%">
      <stop offset="0%" stop-color="${accent2 || "#5a2d91"}" stop-opacity=".55"/><stop offset="100%" stop-color="#17062d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="winShadow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".35"/>
    </linearGradient>
  </defs>
  ${rrect(0, 0, 1920, 1080, 0, "url(#glowA)")}
  ${rrect(0, 0, 1920, 1080, 0, "url(#glowB)")}
  <circle cx="1760" cy="130" r="260" fill="${C.gold}" opacity=".08"/>
  <circle cx="120" cy="950" r="300" fill="${C.gold}" opacity=".05"/>`;
}

function appWindow(w, h, inner, o) {
    o = o || {};
    const x = (1920 - w) / 2;
    const y = o.y !== undefined ? o.y : (1080 - h) / 2 + 10;
    return {
        x, y,
        svg: `
      <defs><clipPath id="winClip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r || 26}"/></clipPath></defs>
      ${rrect(x - 14, y + 22, w + 28, h, o.r || 26, "rgba(5,0,12,.55)")}
      <g clip-path="url(#winClip)">
        ${rrect(x, y, w, h, o.r || 26, o.bg || C.paper)}
        <g transform="translate(${x},${y})">${inner}</g>
        ${rrect(x, y, w, h, o.r || 26, "none", ` stroke="rgba(255,255,255,.16)" stroke-width="1.5"`)}
      </g>`,
    };
}

/* ------------------------------------------------------------------ */
/* 1. EduSphere public homepage hero (real homepage structure)         */
/* ------------------------------------------------------------------ */
function homeScreen() {
    const W = 1660, H = 940;
    let s = rrect(0, 0, W, H, 0, C.canvas);
    s += `<circle cx="1350" cy="150" r="330" fill="#eadcb8" opacity=".5"/><circle cx="1180" cy="620" r="220" fill="#e5d6f2" opacity=".55"/>`;
    /* header */
    s += rrect(0, 0, W, 92, 0, "rgba(251,250,252,.9)");
    s += rrect(0, 91, W, 1, 0, C.line);
    s += `<image href="${LOGO_B64}" x="64" y="24" width="46" height="46"/>`;
    s += text(122, 46, "EduSphere", { size: 23, weight: 700, color: C.ink950 });
    s += text(122, 66, "Education Platform", { size: 13.5, color: C.muted });
    const nav = ["Home", "Islamic Schools", "Western Academies", "How EduSphere Works"];
    let nx = 620;
    nav.forEach((n, i) => {
        s += text(nx, 56, n, { size: 17.5, weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink950 : C.inkSoft });
        if (i === 0) s += rrect(nx, 66, n.length * 9.8, 3, 1.5, C.gold);
        nx += n.length * 10.2 + 40;
    });
    s += text(1330, 56, "Sign In", { size: 17.5, weight: 700, color: C.ink950 });
    s += btn(1420, 26, 178, 44, "Get Started", { fill: C.brand });
    /* hero */
    s += `<image href="${LOGO_B64}" x="120" y="158" width="76" height="76"/>`;
    s += `<g>${rrect(120, 252, 560, 34, 17, "#f2e8d8")}<circle cx="140" cy="269" r="5" fill="${C.gold700}"/>${text(156, 275, "EDUSPHERE — EDUCATION MANAGEMENT PLATFORM", { size: 13.5, weight: 700, color: C.gold700, spacing: ".06em" })}</g>`;
    s += text(120, 372, "Smarter Management for", { size: 64, weight: 700, color: C.ink950 });
    s += `<text x="120" y="446" font-family="'DejaVu Serif', serif" font-style="italic" font-size="64" font-weight="700" fill="${C.gold700}">Modern Education</text>`;
    s += text(120, 502, "EduSphere helps schools and educational institutions manage their operations,", { size: 20.5, color: C.inkSoft });
    s += text(120, 530, "academics, communication and digital presence in one platform — so every", { size: 20.5, color: C.inkSoft });
    s += text(120, 558, "institution can focus on teaching, and every family stays connected.", { size: 20.5, color: C.inkSoft });
    s += btn(120, 600, 210, 58, "Get Started", { fill: C.brand, size: 21 });
    s += btn(350, 600, 160, 58, "Sign In", { fill: "transparent", color: C.ink950, stroke: "#c9c2d4", size: 21 });
    s += icon("check", 124, 700, 22, C.green, 2.4);
    s += text(156, 706, "One secure platform for institution administrators, teachers, students and parents.", { size: 16.5, color: C.inkSoft });
    /* hero visual: floating module chips around a glass panel */
    s += rrect(980, 168, 560, 640, 28, "rgba(255,255,255,.55)", ` stroke="rgba(255,255,255,.9)" stroke-width="1.5"`);
    const chips = [
        ["users", "Students", 1030, 250], ["teacher", "Teachers", 1310, 224], ["calendar", "Attendance", 1046, 430],
        ["academic", "Academics", 1322, 408], ["money", "Finance", 1022, 620], ["chat", "Communication", 1320, 596],
        ["admissions", "Admissions", 1160, 330], ["building", "Public Websites", 1146, 516],
    ];
    for (const [ic, label, cx, cy] of chips) {
        s += rrect(cx, cy, 190, 60, 18, "#ffffff", ` stroke="${C.line}" stroke-width="1.5"`);
        s += rrect(cx + 14, cy + 14, 32, 32, 10, C.surface);
        s += icon(ic, cx + 20, cy + 20, 20, C.ink800);
        s += text(cx + 56, cy + 38, label, { size: 16.5, weight: 700, color: C.ink });
    }
    s += `<g transform="translate(1152,690)">${rrect(0, 0, 236, 58, 29, C.ink950)}${icon("spark", 22, 16, 26, C.gold)}${text(60, 30, "One platform", { size: 17, weight: 700, color: "#fff" })}${text(60, 48, "everything connected", { size: 11.5, color: "rgba(255,255,255,.7)" })}</g>`;
    return { name: "home", w: W, h: H, inner: s, winBg: C.canvas };
}

/* ------------------------------------------------------------------ */
/* 2. Super Admin — platform overview (real platform.* screens)        */
/* ------------------------------------------------------------------ */
function superAdminScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Overview", icon: "dashboard", active: true },
        { label: "Madrasas & Academies", icon: "building", count: d.platform.madaris },
        { label: "Registrations", icon: "admissions", count: d.platform.pending },
        { label: "Subscription Plans", icon: "money" },
        { label: "Support Tickets", icon: "shield" },
        { label: "Platform Analytics", icon: "chart" },
        { label: "Activity Log", icon: "activity" },
        { label: "Backups & Storage", icon: "file" },
        { label: "Platform Settings", icon: "settings" },
    ];
    let c = "";
    c += text(6, 8, "Platform Overview", { size: 30, weight: 700, color: C.ink });
    c += text(6, 38, "Every institution on EduSphere, in one place", { size: 16, color: C.muted });
    const stats = [
        ["building", "Institutions", String(d.platform.madaris), true],
        ["check", "Active Schools", String(d.platform.active), false],
        ["users", "Students", String(d.platform.students), false],
        ["teacher", "Teachers", String(d.platform.teachers), false],
        ["shield", "Parents", String(d.platform.parents), false],
    ];
    let x = 0;
    stats.forEach(([ic, label, v, acc]) => { c += statCard(x, 62, 250, label, v, { icon: ic, accent: acc, h: 118, vsize: 32 }); x += 262; });
    /* institutions table card */
    c += card(0, 212, 816, 330);
    c += cardHead(0, 212, 816, "Madrasas & Academies", "2 institutions");
    c += table(26, 282, 764,
        [{ label: "INSTITUTION", w: 330 }, { label: "CATEGORY", w: 150 }, { label: "PLAN", w: 120 }, { label: "STATUS", w: 90, align: "right" }],
        [
            { cells: [d.institution.nameEn, "Islamic School", { pill: "basic", fill: C.navySoft, color: C.navy }, { pill: "Active" }] },
            { cells: [d.institution2.nameEn, "Islamic School", { pill: "free", fill: C.surface, color: C.inkSoft }, { pill: "Active" }] },
            { cells: ["Your institution", "Islamic or Western", { pill: "any plan", fill: C.surface, color: C.inkSoft }, { pill: "—", fill: C.surface, color: C.muted }] },
        ], { rowH: 66 });
    /* plans + activity */
    c += card(840, 212, 468, 330);
    c += cardHead(840, 212, 468, "Subscription plans", "3 plans");
    const plans = [["free", "#8a8296", 1], ["basic", "#4d7bd1", 1], ["premium", "#b78318", 0]];
    let py = 300;
    plans.forEach(([name, col]) => {
        c += text(866, py + 24, name[0].toUpperCase() + name.slice(1), { size: 17, weight: 700, color: C.ink });
        c += rrect(866, py + 36, 300, 10, 5, C.surface);
        c += rrect(866, py + 36, name === "premium" ? 40 : 180, 10, 5, col);
        py += 66;
    });
    c += card(0, 562, 1308, 240);
    c += cardHead(0, 562, 1308, "Recent platform activity", "Activity Log");
    const act = [
        ["shield", "demo-quraniyya-admin signed in", "Madrasa Admin · demo-quraniyya", "13:30"],
        ["dashboard", "admin signed in", "Super Admin · platform", "13:32"],
        ["building", "Fatihah Islamic Studies College published its website", "Institution · demo-fatihah", "09:12"],
    ];
    let ay = 636;
    act.forEach(([ic, a, b, tm]) => {
        c += rrect(26, ay, 44, 44, 12, C.surface) + icon(ic, 36, ay + 10, 24, C.ink800);
        c += text(90, ay + 20, a, { size: 17, weight: 700, color: C.ink });
        c += text(90, ay + 40, b, { size: 14, color: C.muted });
        c += text(1262, ay + 28, tm, { size: 14, color: C.muted, anchor: "end" });
        ay += 56;
    });
    const shell = dashShell({
        w: W, h: H, sidebar, brandSub: "Platform Operator", title: "", chip: "SA", user: "Super Admin", topActions: true,
        content: c,
    });
    return { name: "superadmin", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 3. Institution Admin dashboard (real schema, islamic category)      */
/* ------------------------------------------------------------------ */
function adminDashScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard", active: true },
        { label: "My Institution", icon: "building" },
        { label: "Students", icon: "users", count: d.stats.students },
        { label: "Documents", icon: "file" },
        { label: "Teachers", icon: "teacher" },
        { label: "Classes", icon: "classes", count: d.stats.classes },
        { label: "Attendance", icon: "calendar" },
        { label: "Academic", icon: "academic" },
        { label: "Admissions", icon: "admissions", count: d.stats.pending },
        { label: "Library", icon: "book" },
        { label: "Communication", icon: "chat" },
        { label: "Finance", icon: "money" },
        { label: "Payroll", icon: "payroll" },
        { label: "Staff Leave", icon: "leave" },
        { label: "Settings", icon: "settings" },
        { label: "Platform Support", icon: "shield" },
    ];
    let cm = "";
    /* website banner card (real dashboard component) */
    cm += rrect(0, 0, 1308, 96, 18, C.ink900);
    cm += rrect(0, 0, 6, 96, 3, C.gold);
    cm += text(32, 34, "YOUR INSTITUTION WEBSITE", { size: 12.5, weight: 700, color: C.gold, spacing: ".08em" });
    cm += icon("globe", 32, 48, 24, "rgba(255,255,255,.8)");
    cm += text(66, 62, `https://edusphere.site/schools/${d.institution.slug}`, { size: 20, weight: 700, color: "#fff" });
    cm += text(66, 84, "Your public page is live and updates automatically as you edit your institution.", { size: 14, color: "rgba(255,255,255,.65)" });
    cm += btn(1010, 26, 138, 44, "Visit Website", { fill: C.gold, color: C.ink950, size: 16 });
    cm += btn(1160, 26, 124, 44, "Edit Website", { fill: "rgba(255,255,255,.1)", color: "#fff", stroke: "rgba(255,255,255,.35)", size: 16 });
    /* stat cards */
    const stats = [
        ["users", "Total Students", String(d.stats.students)],
        ["teacher", "Total Teachers", String(d.stats.teachers)],
        ["classes", "Total Classes", String(d.stats.classes)],
        ["book", "Total Subjects", String(d.stats.subjects)],
        ["calendar", "Attendance Today", `${d.stats.present}/${d.stats.marked}`, true],
        ["admissions", "Pending Applications", String(d.stats.pending), true],
        ["money", "Fees Collected", `₦${d.stats.fees.toLocaleString("en-NG")}`],
        ["money", "Expenses", `₦${d.stats.expenses.toLocaleString("en-NG")}`],
    ];
    let sx = 0, sy = 116;
    stats.forEach(([ic, label, v, acc], i) => {
        cm += statCard(sx, sy, 315, label, v, { icon: ic, accent: acc, h: 112, vsize: 28 });
        sx += 331;
        if ((i + 1) % 4 === 0) { sx = 0; sy += 128; }
    });
    /* today's classes + hifz card */
    cm += card(0, 384, 816, 420);
    cm += cardHead(0, 384, 816, "Today's classes", "Thursday");
    d.timetable.slice(0, 4).forEach(([a, b, subj], i) => {
        const ry = 456 + i * 84;
        cm += rrect(26, ry, 764, 68, 14, i === 0 ? "#f7f0dd" : C.surface);
        cm += rrect(26, ry, 4, 68, 2, i === 0 ? C.gold : "#cbb8e0");
        cm += text(48, ry + 30, `Period ${i + 1}`, { size: 14, weight: 700, color: C.muted });
        cm += text(48, ry + 52, `${a} – ${b}`, { size: 15, color: C.inkSoft });
        cm += icon("book", 220, ry + 20, 22, C.ink800);
        cm += text(254, ry + 30, subj, { size: 17.5, weight: 700, color: C.ink });
        cm += text(254, ry + 52, d.classes[i % d.classes.length], { size: 14.5, color: C.muted });
        cm += text(770, ry + 42, d.teacher, { size: 14.5, color: C.inkSoft, anchor: "end" });
    });
    cm += card(840, 384, 468, 420);
    cm += cardHead(840, 384, 468, "Qur'an & Hifz Progress", "Tracker");
    cm += `<circle cx="1074" cy="560" r="74" fill="none" stroke="${C.surface}" stroke-width="16"/>`;
    cm += `<path d="M 1074 486 A 74 74 0 0 1 1140 596" fill="none" stroke="${C.gold}" stroke-width="16" stroke-linecap="round"/>`;
    cm += text(1074, 556, "62%", { size: 30, weight: 700, color: C.ink, anchor: "middle" });
    cm += text(1074, 582, "on track", { size: 14, color: C.muted, anchor: "middle" });
    const hq = [["Memorisation active", `${d.stats.students} students`], ["Current surah set", "An-Naba' · An-Nazi'at"], ["Sessions logged", "This week · 3"]];
    let qy = 664;
    hq.forEach(([a, b]) => {
        cm += icon("check", 868, qy, 20, C.green, 2.4);
        cm += text(898, qy + 15, a, { size: 15.5, weight: 700, color: C.ink });
        cm += text(1280, qy + 15, b, { size: 14.5, color: C.muted, anchor: "end" });
        qy += 36;
    });
    const shell = dashShell({
        w: W, h: H, sidebar, brandSub: d.institution.nameEn, title: "", chip: "MA", user: "Madrasa Admin",
        accent: C.gold, content: cm,
    });
    return { name: "admindash", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 4. Students > All Students (real columns, real demo students)       */
/* ------------------------------------------------------------------ */
function studentsScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" },
        { label: "My Institution", icon: "building" },
        {
            label: "Students", icon: "users", active: true,
            sub: [{ label: "All Students", active: true }, { label: "Add Student" }, { label: "Student Applications" }, { label: "Student Groups" }, { label: "Student Profiles" }, { label: "Health Reports" }, { label: "ID Cards" }],
        },
        { label: "Teachers", icon: "teacher" },
        { label: "Classes", icon: "classes" },
        { label: "Attendance", icon: "calendar" },
        { label: "Academic", icon: "academic" },
        { label: "Admissions", icon: "admissions" },
        { label: "Finance", icon: "money" },
        { label: "Library", icon: "book" },
        { label: "Communication", icon: "chat" },
    ];
    let cm = "";
    cm += text(6, 8, "All Students", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, `${d.stats.students} students · ${d.stats.classes} classes · ${d.institution.session}`, { size: 16, color: C.muted });
    cm += btn(1090, -6, 218, 50, "Add Student", { fill: C.brand, icon: "plus", size: 18 });
    cm += card(0, 62, 1308, 690);
    cm += rrect(26, 88, 380, 44, 22, C.surface, ` stroke="${C.line}" stroke-width="1.5"`);
    cm += icon("search", 44, 100, 20, C.muted);
    cm += text(74, 116, "Search students…", { size: 16, color: C.muted });
    const rows = d.students.map((st) => ({
        cells: [
            { html: (x, y, h) => `<circle cx="${x + 16}" cy="${y + h / 2}" r="19" fill="${C.ink800}"/>${text(x + 16, y + h / 2 + 5.5, (st.first[0] + st.last[0]).toUpperCase(), { size: 14, weight: 700, color: "#fff", anchor: "middle" })}${text(x + 48, y + h / 2 + 5.5, `${st.first} ${st.last}`, { size: 17, weight: 700, color: C.ink })}` },
            st.adm, st.cls, st.gender === "F" ? "Female" : "Male",
            { pill: "Active" }, { pill: "Fees paid", fill: C.navySoft, color: C.navy },
        ],
    }));
    cm += table(26, 152, 1256,
        [{ label: "STUDENT", w: 330 }, { label: "ADMISSION NO", w: 190 }, { label: "CLASS", w: 230 }, { label: "GENDER", w: 130 }, { label: "STATUS", w: 160 }, { label: "FEES", w: 150, align: "right" }],
        rows, { rowH: 72 });
    cm += text(26, 726, `Showing ${rows.length} of ${d.stats.students} students`, { size: 14.5, color: C.muted });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "MA", user: "Madrasa Admin", content: cm });
    return { name: "students", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 5. Teacher workspace — Attendance register                          */
/* ------------------------------------------------------------------ */
function teacherAttendanceScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" },
        { label: "My Classes", icon: "classes" },
        { label: "Timetable", icon: "calendar" },
        { label: "Attendance", icon: "check", active: true },
        { label: "Lesson Plans", icon: "book" },
        { label: "Assignments", icon: "file" },
        { label: "Examinations", icon: "academic" },
        { label: "Results", icon: "chart" },
        { label: "Calendar", icon: "calendar" },
        { label: "Messages", icon: "chat" },
        { label: "Notifications", icon: "bell" },
        { label: "My Leave", icon: "leave" },
        { label: "My Library", icon: "book" },
        { label: "My Account", icon: "settings" },
    ];
    let cm = "";
    cm += text(6, 8, "Attendance Register", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, "Thursday 24 September 2026 · 2026/2027 — First Term", { size: 16, color: C.muted });
    cm += rrect(700, -10, 380, 50, 14, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    cm += text(726, 22, d.classes[0], { size: 18, weight: 700, color: C.ink });
    cm += icon("chevron", 1040, 4, 22, C.muted);
    cm += btn(1100, -6, 208, 50, "Save attendance", { fill: C.brand, size: 18 });
    cm += card(0, 62, 1308, 106);
    cm += icon("academic", 40, 88, 40, C.ink800);
    cm += text(104, 100, "Qur'an (Tajwid)", { size: 22, weight: 700, color: C.ink });
    cm += text(104, 128, `${d.classes[0]} · Period 2 · 08:50 – 09:40`, { size: 15.5, color: C.muted });
    cm += pill(1060, 92, `${d.students.length} of ${d.students.length} marked`, { size: 15, h: 38, fill: C.greenSoft, color: C.green });
    cm += card(0, 184, 1308, 568);
    const marks = d.students.slice(0, 5);
    marks.forEach((st, i) => {
        const ry = 210 + i * 106;
        cm += rrect(26, ry, 1256, 88, 16, i % 2 ? "rgba(31,8,59,.022)" : "transparent");
        cm += `<circle cx="${76}" cy="${ry + 44}" r="26" fill="${C.ink800}"/>${text(76, ry + 51, (st.first[0] + st.last[0]).toUpperCase(), { size: 17, weight: 700, color: "#fff", anchor: "middle" })}`;
        cm += text(122, ry + 40, `${st.first} ${st.last}`, { size: 19, weight: 700, color: C.ink });
        cm += text(122, ry + 64, st.adm, { size: 14.5, color: C.muted });
        const opts = [["Present", true], ["Absent", false], ["Late", false]];
        let ox = 880;
        opts.forEach(([label, on]) => {
            cm += rrect(ox, ry + 22, 124, 44, 22, on ? C.greenSoft : C.surface, ` stroke="${on ? C.green : C.line}" stroke-width="1.5"`);
            cm += `<circle cx="${ox + 24}" cy="${ry + 44}" r="9" fill="${on ? C.green : "transparent"}" stroke="${on ? C.green : "#b9b1c6"}" stroke-width="2"/>`;
            cm += text(ox + 42, ry + 50, label, { size: 15.5, weight: on ? 700 : 400, color: on ? C.green : C.inkSoft });
            ox += 134;
        });
    });
    cm += text(26, 770, "Register autosaves each mark — attendance reports update instantly.", { size: 15, color: C.muted });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "UI", user: d.teacher.split(" ").slice(0, 2).join(" "), content: cm });
    return { name: "teacher-att", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 6. Teacher workspace — Assignments                                  */
/* ------------------------------------------------------------------ */
function teacherAssignmentsScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" }, { label: "My Classes", icon: "classes" }, { label: "Timetable", icon: "calendar" },
        { label: "Attendance", icon: "check" }, { label: "Lesson Plans", icon: "book" }, { label: "Assignments", icon: "file", active: true },
        { label: "Examinations", icon: "academic" }, { label: "Results", icon: "chart" }, { label: "Calendar", icon: "calendar" },
        { label: "Messages", icon: "chat" }, { label: "Notifications", icon: "bell" }, { label: "My Leave", icon: "leave" },
        { label: "My Library", icon: "book" }, { label: "My Account", icon: "settings" },
    ];
    let cm = "";
    cm += text(6, 8, "Assignments", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, "Create, collect and mark class assignments", { size: 16, color: C.muted });
    cm += btn(1066, -6, 242, 50, "New assignment", { fill: C.brand, icon: "plus", size: 18 });
    const items = [
        ["Qur'an (Tajwid)", `Surah An-Naba' recitation practice`, d.classes[0], "Due Mon 28 Sep", 0],
        ["Fiqh", "Worksheet: Pillars of Salah", d.classes[1] || d.classes[0], "Due Wed 30 Sep", 1],
        ["Arabic Language", "Vocabulary & reading passage", d.classes[2] || d.classes[0], "Due Fri 2 Oct", 2],
        ["Mathematics", "Fractions — problem set 4", d.classes[3] || d.classes[0], "Marked", 3],
    ];
    items.forEach(([subj, title, cls, due, i]) => {
        const ry = 62 + i * 200;
        cm += card(0, ry, 1308, 184);
        cm += rrect(26, ry + 26, 60, 60, 16, C.surface) + icon("file", 40, ry + 40, 32, C.ink800);
        cm += text(110, ry + 52, title, { size: 22, weight: 700, color: C.ink });
        cm += text(110, ry + 82, `${subj} · ${cls}`, { size: 16, color: C.muted });
        cm += pill(110, ry + 108, due === "Marked" ? "Marked" : due, { size: 14, h: 34, fill: due === "Marked" ? C.greenSoft : C.amberSoft, color: due === "Marked" ? C.green : C.amber });
        cm += pill(310, ry + 108, due === "Marked" ? "24 submissions" : "Open for submissions", { size: 14, h: 34, fill: C.surface, color: C.inkSoft });
        cm += btn(1060, ry + 40, 220, 48, due === "Marked" ? "View results" : "View submissions", { fill: "transparent", color: C.ink950, stroke: "#c9c2d4", size: 16.5 });
        cm += text(1282, ry + 120, "Shared with students & parents", { size: 14, color: C.muted, anchor: "end" });
    });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "UI", user: d.teacher.split(" ").slice(0, 2).join(" "), content: cm });
    return { name: "teacher-assign", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 7. Finance — Payments                                               */
/* ------------------------------------------------------------------ */
function financeScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" }, { label: "Students", icon: "users" }, { label: "Attendance", icon: "calendar" },
        { label: "Academic", icon: "academic" },
        {
            label: "Finance", icon: "money", active: true,
            sub: [{ label: "School Fees" }, { label: "Payments", active: true }, { label: "Outstanding Fees" }, { label: "Fee Records" }, { label: "Financial Reports" }, { label: "Expenses" }, { label: "Budget vs Actual" }],
        },
        { label: "Payroll", icon: "payroll" }, { label: "Staff Leave", icon: "leave" }, { label: "Communication", icon: "chat" },
        { label: "Settings", icon: "settings" },
    ];
    let cm = "";
    cm += text(6, 8, "Payments", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, "School fees · receipts · reconciliation", { size: 16, color: C.muted });
    cm += btn(1052, -6, 256, 50, "Record payment", { fill: C.brand, icon: "plus", size: 18 });
    const chips = [
        ["Collected (First Term)", `₦${d.stats.fees.toLocaleString("en-NG")}`, C.green],
        ["Outstanding", "₦0", C.ink],
        ["Expenses", `₦${d.stats.expenses.toLocaleString("en-NG")}`, C.ink],
    ];
    let cx = 0;
    chips.forEach(([a, b, cc]) => {
        cm += card(cx, 62, 424, 96);
        cm += text(cx + 26, 100, a, { size: 15.5, color: C.muted });
        cm += text(cx + 26, 138, b, { size: 27, weight: 700, color: cc });
        cx += 442;
    });
    cm += card(0, 178, 1308, 470);
    cm += cardHead(0, 178, 1308, "Recent payments", "First Term · 2026/2027");
    const payRows = d.students.slice(0, 4).map((st, i) => ({
        cells: [
            `ESP-${1041 + i * 7}`,
            `${st.first} ${st.last}`,
            "School fees — First Term",
            { html: (x, y, h) => text(x, y + h / 2 + 6, `₦${Math.round(d.stats.fees / Math.max(1, d.students.length)).toLocaleString("en-NG")}`, { size: 17, weight: 700, color: C.ink, anchor: "start" }) },
            { pill: "Bank transfer", fill: C.surface, color: C.inkSoft },
            { pill: "Receipt issued" },
        ],
    }));
    cm += table(26, 250, 1256,
        [{ label: "RECEIPT", w: 130 }, { label: "STUDENT", w: 250 }, { label: "FEE", w: 320 }, { label: "AMOUNT", w: 150 }, { label: "METHOD", w: 200 }, { label: "STATUS", w: 190, align: "right" }],
        payRows, { rowH: 82 });
    cm += card(0, 668, 1308, 140);
    cm += cardHead(0, 668, 1308, "Fee collection trend", "Last 6 months");
    const bars = [20, 38, 30, 55, 44, 78];
    let bx = 40;
    const labels = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
    bars.forEach((v, i) => {
        cm += rrect(bx, 848 - v * 1.5, 120, 8 + v * 1.5, 6, i === 5 ? C.gold : "#cbb8e0");
        cm += text(bx + 60, 878, labels[i], { size: 14, color: C.muted, anchor: "middle" });
        bx += 210;
    });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "MA", user: "Madrasa Admin", content: cm });
    return { name: "finance", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 8. Payroll — Payslips                                               */
/* ------------------------------------------------------------------ */
function payrollScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" }, { label: "Teachers", icon: "teacher" }, { label: "Finance", icon: "money" },
        {
            label: "Payroll", icon: "payroll", active: true,
            sub: [{ label: "Salary Structures" }, { label: "Pay Periods" }, { label: "Payslips", active: true }, { label: "Advances & Loans" }],
        },
        {
            label: "Staff Leave", icon: "leave",
            sub: [{ label: "Leave Requests" }, { label: "Leave Calendar" }, { label: "Leave Balances" }, { label: "Leave Types" }],
        },
        { label: "Communication", icon: "chat" }, { label: "Settings", icon: "settings" },
    ];
    let cm = "";
    cm += text(6, 8, "Payslips", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, "September 2026 pay period", { size: 16, color: C.muted });
    cm += btn(1010, -6, 298, 50, "Generate payslips", { fill: C.brand, icon: "plus", size: 18 });
    cm += card(0, 62, 1308, 240);
    cm += cardHead(0, 62, 1308, "September 2026", "1 staff member");
    const pr = [["Gross salaries", "₦120,000"], ["Deductions", "₦4,500"], ["Net payroll", "₦115,500"]];
    let px = 40;
    pr.forEach(([a, b], i) => {
        cm += text(px, 150, a, { size: 15.5, color: C.muted });
        cm += text(px, 190, b, { size: 27, weight: 700, color: i === 2 ? C.green : C.ink });
        px += 260;
    });
    cm += pill(1080, 130, "Period open", { size: 15, h: 38, fill: C.amberSoft, color: C.amber });
    cm += card(0, 322, 1308, 300);
    cm += cardHead(0, 322, 1308, "Staff payslips", "Payslip PDF on demand");
    cm += table(26, 396, 1256,
        [{ label: "STAFF", w: 360 }, { label: "ROLE", w: 220 }, { label: "GROSS", w: 170 }, { label: "DEDUCTIONS", w: 180 }, { label: "NET PAY", w: 160 }, { label: "STATUS", w: 150, align: "right" }],
        [
            { cells: [d.teacher, "Teacher — Qur'an & Arabic", "₦120,000", "₦4,500", { html: (x, y, h) => text(x, y + h / 2 + 6, "₦115,500", { size: 17, weight: 700, color: C.ink }) }, { pill: "Ready" }] },
        ], { rowH: 80 });
    cm += card(0, 642, 1308, 166);
    cm += cardHead(0, 642, 1308, "Staff leave", "This term");
    const lv = [["Leave requests", "0 pending"], ["Approved leave", "1 this term"], ["Leave balances", "Up to date"]];
    let lx = 40;
    lv.forEach(([a, b]) => {
        cm += icon("leave", lx, 716, 24, C.ink800);
        cm += text(lx + 36, 726, a, { size: 16.5, weight: 700, color: C.ink });
        cm += text(lx + 36, 750, b, { size: 14.5, color: C.muted });
        lx += 300;
    });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "MA", user: "Madrasa Admin", content: cm });
    return { name: "payroll", w: W, h: H, inner: shell, winBg: C.surface };
}

/* ------------------------------------------------------------------ */
/* 9. Communication — Announcements                                    */
/* ------------------------------------------------------------------ */
function communicationScreen(d) {
    const W = 1660, H = 940;
    const sidebar = [
        { label: "Dashboard", icon: "dashboard" }, { label: "Students", icon: "users" }, { label: "Teachers", icon: "teacher" },
        { label: "Academic", icon: "academic" },
        {
            label: "Communication", icon: "chat", active: true,
            sub: [{ label: "Announcements", active: true }, { label: "Messages" }, { label: "Notifications" }, { label: "Parent Communication" }, { label: "PTM Sessions" }],
        },
        { label: "Finance", icon: "money" }, { label: "Settings", icon: "settings" },
    ];
    let cm = "";
    cm += text(6, 8, "Announcements", { size: 30, weight: 700, color: C.ink });
    cm += text(6, 38, "School-wide and audience announcements", { size: 16, color: C.muted });
    cm += btn(1044, -6, 264, 50, "New announcement", { fill: C.brand, icon: "plus", size: 18 });
    cm += card(0, 62, 1308, 200);
    cm += rrect(26, 90, 44, 44, 12, C.ink900) + icon("send", 36, 100, 24, C.gold);
    cm += text(90, 110, "First Term resumption — Monday 7 September", { size: 20, weight: 700, color: C.ink });
    cm += text(90, 136, "Assalamu alaikum dear parents — school resumes on Monday. Timetables and fee information are in the portal.", { size: 15.5, color: C.inkSoft });
    cm += pill(26, 166, "Parents", { size: 13.5, h: 30, fill: C.navySoft, color: C.navy });
    cm += pill(120, 166, "Students", { size: 13.5, h: 30, fill: C.navySoft, color: C.navy });
    cm += pill(224, 166, "Teachers", { size: 13.5, h: 30, fill: C.navySoft, color: C.navy });
    cm += text(1282, 186, "Delivered as a portal notification to 8 families", { size: 14, color: C.muted, anchor: "end" });
    cm += card(0, 282, 1308, 200);
    cm += rrect(26, 310, 44, 44, 12, C.surface) + icon("chat", 36, 320, 24, C.ink800);
    cm += text(90, 330, "Parent-Teacher Meetings — book your slot", { size: 20, weight: 700, color: C.ink });
    cm += text(90, 356, "PTM sessions open this Friday. Parents can book from the portal — teachers receive their schedule automatically.", { size: 15.5, color: C.inkSoft });
    cm += pill(26, 386, "Parents", { size: 13.5, h: 30, fill: C.navySoft, color: C.navy });
    cm += text(1282, 406, "Sent 09:41 · read receipts on", { size: 14, color: C.muted, anchor: "end" });
    cm += card(0, 502, 640, 306);
    cm += cardHead(0, 502, 640, "Messages", "Direct · teacher ↔ parent");
    const msgs = [
        ["Parent of Kunle", "JazakAllahu khairan for the update on…", "09:12"],
        ["Ustadh Ibrahim", "Kunle's tajweed is improving well…", "08:47"],
        ["Fatimah's mother", "Please confirm Friday's pickup time", "Yesterday"],
    ];
    let my = 580;
    msgs.forEach(([a, b, t], i) => {
        cm += `<circle cx="${56}" cy="${my + 12}" r="20" fill="${i ? C.ink800 : C.gold700}"/>${text(56, my + 18, a[0], { size: 15, weight: 700, color: "#fff", anchor: "middle" })}`;
        cm += text(90, my + 8, a, { size: 16, weight: 700, color: C.ink });
        cm += text(90, my + 30, b, { size: 14.5, color: C.muted });
        cm += text(600, my + 12, t, { size: 13, color: C.muted, anchor: "end" });
        my += 66;
    });
    cm += card(668, 502, 640, 306);
    cm += cardHead(668, 502, 640, "Notifications", "Delivery log");
    const notifs = [
        ["check", "Result published — First Term CA", "Parents & students notified", C.green],
        ["receipt", "Fee receipt issued — School fees", "Payment recorded · receipt sent", C.ink700],
        ["bell", "Attendance marked — 4 present today", "Register closed 08:56", C.ink700],
    ];
    let ny = 580;
    notifs.forEach(([ic, a, b, col]) => {
        cm += rrect(694, ny - 8, 40, 40, 12, C.surface) + icon(ic, 704, ny + 2, 20, col);
        cm += text(748, ny + 6, a, { size: 15.5, weight: 700, color: C.ink });
        cm += text(748, ny + 28, b, { size: 14, color: C.muted });
        ny += 70;
    });
    const shell = dashShell({ w: W, h: H, sidebar, brandSub: d.institution.nameEn, chip: "MA", user: "Madrasa Admin", content: cm });
    return { name: "comm", w: W, h: H, inner: shell, winBg: C.surface };
}

module.exports = {
    backdrop, appWindow, homeScreen, superAdminScreen, adminDashScreen, studentsScreen,
    teacherAttendanceScreen, teacherAssignmentsScreen, financeScreen, payrollScreen, communicationScreen,
};
