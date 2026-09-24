"use strict";

/* Phone portals, public websites, diagrams & finale cards. */

const { C, icon, text, rrect, pill, btn, browserChrome, dashShell, card, cardHead, table, LOGO_B64 } = require("./lib");
const { backdrop } = require("./screens-desktop");

/* ------------------------------------------------------------------ */
/* Phone frame + portal content                                        */
/* ------------------------------------------------------------------ */
function phoneFrame(x, y, w, h, inner, o) {
    o = o || {};
    return `
    <defs><clipPath id="ph${x}"><rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="${w * 0.085}"/></clipPath></defs>
    ${rrect(x - 18, y + 26, w + 36, h, w * 0.13, "rgba(5,0,12,.55)")}
    ${rrect(x, y, w, h, w * 0.115, "#0d0616")}
    ${rrect(x + 14, y + 14, w - 28, h - 28, w * 0.085, o.bg || C.canvas)}
    <g clip-path="url(#ph${x})"><g transform="translate(${x + 14},${y + 14})">${inner}</g></g>
    ${rrect(x + w / 2 - 46, y + 26, 92, 22, 11, "#0d0616")}
    ${rrect(x, y, w, h, w * 0.115, "none", ` stroke="rgba(255,255,255,.18)" stroke-width="2"`)}`;
}

/* Student portal — Dashboard (real nav: Timetable, Lessons, Assignments,
   Exam Timetable, Online Exams, Results, Attendance, School Fees, Library,
   Qur'an Progress, Calendar, Messages, Notifications, My Account) */
function studentPortalScreen(d) {
    const W = 1720, H = 1000;
    let bg = backdrop("#43217c");
    /* ambient context chips */
    bg += `<g opacity=".95">${rrect(1176, 210, 330, 92, 20, "rgba(255,255,255,.08)", ` stroke="rgba(255,255,255,.18)" stroke-width="1.5"`)}${icon("calendar", 1204, 232, 26, C.gold)}${text(1244, 244, "Next lesson", { size: 15, color: "rgba(255,255,255,.65)" })}${text(1244, 272, "08:50 · Qur'an (Tajwid)", { size: 17.5, weight: 700, color: "#fff" })}</g>`;
    bg += `<g>${rrect(1196, 340, 330, 92, 20, "rgba(255,255,255,.08)", ` stroke="rgba(255,255,255,.18)" stroke-width="1.5"`)}${icon("check", 1224, 362, 26, "#7fe0b2")}${text(1264, 374, "Result published", { size: 15, color: "rgba(255,255,255,.65)" })}${text(1264, 402, "First Term CA · 86%", { size: 17.5, weight: 700, color: "#fff" })}</g>`;
    bg += `<g transform="translate(170,120)">
      ${rrect(0, 0, 360, 92, 20, "rgba(255,255,255,.08)", ` stroke="rgba(255,255,255,.18)" stroke-width="1.5"`)}
      ${icon("bell", 28, 22, 26, C.gold)}
      ${text(68, 38, "Announcement", { size: 15, color: "rgba(255,255,255,.65)" })}
      ${text(68, 66, "PTM bookings are open", { size: 17.5, weight: 700, color: "#fff" })}
    </g>`;
    bg += text(180, 690, "Student Portal", { size: 40, weight: 700, color: "#fff" });
    bg += text(180, 728, "Timetable · Assignments · Exams", { size: 18, color: "rgba(255,255,255,.72)" });
    bg += text(180, 754, "Results · Qur'an progress", { size: 18, color: "rgba(255,255,255,.72)" });
    bg += pill(180, 782, "Signed in as Adeyemi Kunle", { size: 14, h: 34, fill: "rgba(216,173,66,.16)", color: C.gold });
    /* phone */
    const pw = 430 * 1.28, ph = 880 * 0.98;
    let ui = "";
    const vw = 430 * 1.28 - 28, vh = 880 * 0.98 - 28;
    ui += rrect(0, 0, vw, vh, 40, C.canvas);
    /* portal header */
    ui += rrect(0, 0, vw, 164, 0, C.ink900);
    ui += `<image href="${LOGO_B64}" x="22" y="20" width="34" height="34"/>`;
    ui += text(66, 36, "EduSphere", { size: 17, weight: 700, color: "#fff" });
    ui += text(66, 54, "Student Portal", { size: 12, color: "rgba(255,255,255,.6)" });
    ui += icon("bell", vw - 46, 26, 22, "rgba(255,255,255,.85)");
    ui += `<circle cx="${vw - 31}" cy="28" r="5" fill="${C.red}"/>`;
    ui += text(22, 116, "As-salamu alaykum,", { size: 14, color: "rgba(255,255,255,.75)" });
    ui += text(22, 144, "Adeyemi Kunle", { size: 22, weight: 700, color: "#fff" });
    /* chips: class & session */
    ui += pill(22, 176, d.classes[0], { size: 13, h: 32, fill: C.ink900, color: "#fff" });
    ui += pill(22 + (d.classes[0].length * 7.8 + 44), 176, "2026/2027 · First Term", { size: 13, h: 32, fill: C.surface, color: C.inkSoft });
    /* today card */
    ui += rrect(22, 222, vw - 44, 120, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    ui += text(40, 252, "TODAY · THURSDAY", { size: 12, weight: 700, color: C.gold700, spacing: ".08em" });
    const tdy = [["08:00", "Mathematics"], ["08:50", "Qur'an (Tajwid)"], ["09:40", "Fiqh"]];
    tdy.forEach(([tm, sj], i) => {
        const ry = 266 + i * 24;
        ui += text(40, ry + 8, tm, { size: 13.5, weight: 700, color: C.muted });
        ui += text(112, ry + 8, sj, { size: 14.5, weight: i === 1 ? 700 : 400, color: C.ink });
    });
    ui += pill(vw - 132, 236, "Period 2", { size: 12.5, h: 30, fill: C.greenSoft, color: C.green });
    /* nav grid (real items) */
    const items = [
        ["calendar", "Timetable"], ["book", "Lessons"], ["file", "Assignments"], ["academic", "Exams"],
        ["chart", "Results"], ["check", "Attendance"], ["money", "School Fees"], ["book", "Library"],
        ["spark", "Qur'an Progress"], ["calendar", "Calendar"], ["chat", "Messages"], ["bell", "Notifications"],
    ];
    let gx = 22, gy = 358;
    items.forEach(([ic, label], i) => {
        ui += rrect(gx, gy, (vw - 44 - 20) / 3, 80, 16, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
        ui += icon(ic, gx + 14, gy + 12, 21, C.ink800);
        ui += text(gx + 14, gy + 62, label, { size: 12.5, weight: 700, color: C.ink });
        gx += (vw - 44 - 20) / 3 + 10;
        if ((i + 1) % 3 === 0) { gx = 22; gy += 90; }
    });
    /* assignments ticker */
    ui += rrect(22, gy + 6, vw - 44, 92, 18, C.ink900);
    ui += text(40, gy + 36, "Due soon", { size: 13, weight: 700, color: C.gold, spacing: ".06em" });
    ui += text(40, gy + 58, "Surah An-Naba' recitation practice", { size: 15.5, weight: 700, color: "#fff" });
    ui += text(40, gy + 80, "Qur'an (Tajwid) · due Mon 28 Sep", { size: 13.5, color: "rgba(255,255,255,.7)" });
    return { name: "student-phone", w: W, h: H, inner: bg + phoneFrame(640, 40, pw, ph, ui), full: true };
}

/* Parent portal — Family Dashboard (real nav incl. child switching, fees,
   results, Book a Meeting (PTM)) */
function parentPortalScreen(d, withToast) {
    const W = 1720, H = 1000;
    let bg = backdrop("#43217c");
    bg += `<g opacity=".95">${rrect(1280, 240, 330, 92, 20, "rgba(255,255,255,.08)", ` stroke="rgba(255,255,255,.18)" stroke-width="1.5"`)}${icon("receipt", 1308, 262, 26, C.gold)}${text(1348, 274, "Receipt", { size: 15, color: "rgba(255,255,255,.65)" })}${text(1348, 302, "School fees · paid", { size: 17.5, weight: 700, color: "#fff" })}</g>`;
    bg += text(1616, 700, "Parent Portal", { size: 40, weight: 700, color: "#fff", anchor: "end" });
    bg += text(1616, 738, "Attendance · Results", { size: 18, color: "rgba(255,255,255,.72)", anchor: "end" });
    bg += text(1616, 764, "Fees & receipts · Meetings", { size: 18, color: "rgba(255,255,255,.72)", anchor: "end" });
    bg += pill(1400, 792, "Parent of Kunle", { size: 14, h: 34, fill: "rgba(216,173,66,.16)", color: C.gold });
    const pw = 430 * 1.28, ph = 880 * 0.98;
    let ui = "";
    const vw = 430 * 1.28 - 28, vh = 880 * 0.98 - 28;
    ui += rrect(0, 0, vw, vh, 40, C.canvas);
    ui += rrect(0, 0, vw, 116, 0, C.ink900);
    ui += `<image href="${LOGO_B64}" x="22" y="16" width="32" height="32"/>`;
    ui += text(64, 31, "EduSphere", { size: 16, weight: 700, color: "#fff" });
    ui += text(64, 48, "Parent Portal", { size: 11.5, color: "rgba(255,255,255,.6)" });
    ui += icon("bell", vw - 44, 22, 21, "rgba(255,255,255,.85)");
    ui += `<circle cx="${vw - 30}" cy="24" r="5" fill="${C.red}"/>`;
    ui += text(22, 90, "Family Dashboard", { size: 21, weight: 700, color: "#fff" });
    /* child switcher (multi-child support is a real feature) */
    ui += `<g>${rrect(22, 130, 144, 38, 19, C.ink900)}<circle cx="43" cy="149" r="12" fill="${C.gold}"/>${text(43, 154, "K", { size: 12, weight: 700, color: C.ink950, anchor: "middle" })}${text(62, 154, "Kunle", { size: 14, weight: 700, color: "#fff" })}</g>`;
    ui += `<g>${rrect(174, 130, 144, 38, 19, C.surface, ` stroke="${C.line}" stroke-width="1.5"`)}<circle cx="195" cy="149" r="12" fill="${"#8a8296"}"/>${text(195, 154, "Z", { size: 12, weight: 700, color: "#fff", anchor: "middle" })}${text(214, 154, "Zainab", { size: 14, weight: 400, color: C.inkSoft })}</g>`;
    /* attendance card */
    ui += rrect(22, 184, vw - 44, 100, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    ui += text(40, 213, "ATTENDANCE THIS WEEK", { size: 11.5, weight: 700, color: C.gold700, spacing: ".08em" });
    ui += text(40, 250, "5 / 5 days present", { size: 20, weight: 700, color: C.ink });
    const days = ["M", "T", "W", "T", "F"];
    days.forEach((dd, i) => {
        ui += `<circle cx="${306 + i * 40}" cy="242" r="15" fill="${C.greenSoft}"/>${icon("check", 298 + i * 40, 234, 16, C.green, 2.6)}`;
    });
    /* result card */
    ui += rrect(22, 296, (vw - 56) / 2, 136, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    ui += icon("chart", 40, 312, 21, C.ink800);
    ui += text(40, 348, "Latest result", { size: 13, color: C.muted });
    ui += text(40, 386, "86%", { size: 33, weight: 700, color: C.ink });
    ui += text(40, 410, "Mathematics · CA", { size: 12, color: C.muted });
    /* fees card */
    const fx = 34 + (vw - 56) / 2;
    ui += rrect(fx, 296, (vw - 56) / 2, 136, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    ui += icon("money", fx + 16, 312, 21, C.ink800);
    ui += text(fx + 16, 348, "School fees", { size: 13, color: C.muted });
    ui += text(fx + 16, 386, "Paid", { size: 29, weight: 700, color: C.green });
    ui += text(fx + 16, 410, "₦0 outstanding", { size: 12, color: C.muted });
    /* quick actions (real parent routes) */
    const qa = [["chart", "Results"], ["receipt", "Fees & Receipts"], ["calendar", "Book a Meeting"], ["chat", "Messages"]];
    let qy2 = 444;
    qa.forEach(([ic, label]) => {
        ui += rrect(22, qy2, vw - 44, 58, 15, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
        ui += rrect(35, qy2 + 11, 34, 34, 10, C.surface) + icon(ic, 43, qy2 + 19, 19, C.ink800);
        ui += text(84, qy2 + 37, label, { size: 16, weight: 700, color: C.ink });
        ui += icon("chevron", vw - 58, qy2 + 19, 19, C.muted);
        qy2 += 70;
    });
    /* notifications */
    ui += text(22, qy2 + 24, "RECENT NOTIFICATIONS", { size: 11.5, weight: 700, color: C.muted, spacing: ".08em" });
    ui += rrect(22, qy2 + 38, vw - 44, 66, 15, C.ink900);
    ui += icon("receipt", 38, qy2 + 54, 21, C.gold);
    ui += text(70, qy2 + 68, "Fee payment confirmed", { size: 15, weight: 700, color: "#fff" });
    ui += text(70, qy2 + 87, "School fees · receipt available", { size: 12.5, color: "rgba(255,255,255,.7)" });
    let frame = phoneFrame(560, 40, pw, ph, ui);
    if (withToast) {
        /* a live notification arriving on the parent's phone */
        frame += `
      <g>
        ${rrect(380, 80, 720, 108, 24, "rgba(5,0,12,.45)")}
        ${rrect(400, 60, 680, 104, 22, "#ffffff", ` stroke="${C.line}" stroke-width="1.5"`)}
        ${rrect(420, 78, 68, 68, 18, C.ink900)}
        ${icon("bell", 440, 98, 28, C.gold)}
        ${text(508, 100, "EDUSPHERE · NOW", { size: 13, weight: 700, color: C.gold700, spacing: ".08em" })}
        ${text(508, 126, "Result published — First Term CA", { size: 19, weight: 700, color: C.ink })}
        ${text(508, 148, "Kunle's continuous assessment is available", { size: 14.5, color: C.muted })}
      </g>`;
    }
    return { name: withToast ? "parent-toast" : "parent-phone", w: W, h: H, inner: bg + frame, full: true };
}

/* ------------------------------------------------------------------ */
/* Public school website — Al-Quraniyya (real demo data & branding)    */
/* ------------------------------------------------------------------ */
function publicWebsiteScreen(d) {
    const W = 1660, H = 940;
    const I = d.institution;
    let s = browserChrome(`edusphere.site/schools/${I.slug}`, W, "");
    const top = 64;
    s += rrect(0, top, W, 84, 0, "#ffffff");
    s += rrect(0, top + 83, W, 1, 0, C.line);
    s += rrect(64, top + 18, 48, 48, 12, C.brand) + text(88, top + 50, "Q", { size: 24, weight: 700, color: C.gold, anchor: "middle" });
    s += text(126, top + 42, I.nameEn, { size: 21, weight: 700, color: C.ink950 });
    s += text(126, top + 64, "مدرسة القرونية النموذجية", { size: 14, color: C.muted });
    const nav = ["About", "Admissions", "News & Events", "Gallery", "Contact"];
    let nx = 800;
    nav.forEach((n) => { s += text(nx, top + 52, n, { size: 16.5, color: C.inkSoft }); nx += n.length * 9.2 + 30; });
    s += btn(1400, top + 20, 128, 44, "Check Result", { fill: "transparent", color: C.brand, stroke: "#c9c2d4", size: 15 });
    s += btn(1538, top + 20, 112, 44, "Apply Now", { fill: C.gold, color: C.ink950, size: 15 });
    /* hero */
    s += rrect(0, top + 84, W, 380, 0, C.brand);
    s += `<defs><radialGradient id="scGlow" cx="78%" cy="20%" r="70%"><stop offset="0%" stop-color="#3d1472"/><stop offset="100%" stop-color="${C.brand}" stop-opacity="0"/></radialGradient></defs>`;
    s += rrect(0, top + 84, W, 380, 0, "url(#scGlow)");
    s += pill(64, top + 128, `ADMISSIONS OPEN · ${I.session}`, { size: 13, h: 34, fill: "rgba(216,173,66,.16)", color: C.gold });
    s += text(64, top + 216, I.nameEn, { size: 46, weight: 700, color: "#fff" });
    s += `<text x="64" y="${top + 262}" font-family="'DejaVu Serif', serif" font-style="italic" font-size="24" fill="${C.gold}">“${I.motto}”</text>`;
    s += text(64, top + 304, I.description + ".", { size: 17.5, color: "rgba(255,255,255,.82)" });
    s += `<g>${icon("pin", 64, top + 322, 18, "rgba(255,255,255,.7)")}${text(88, top + 337, `${I.address} · ${I.city}, ${I.state} State, Nigeria`, { size: 15, color: "rgba(255,255,255,.72)" })}</g>`;
    /* stat strip (real counters) */
    const st = [["Students", String(d.stats.students)], ["Teachers", String(d.stats.teachers)], ["Classes", String(d.stats.classes)], ["Subjects", String(d.stats.subjects)]];
    let sx = 64;
    s += rrect(64, top + 490, 680, 96, 20, "#ffffff", ` stroke="${C.line}" stroke-width="1.5"`);
    st.forEach(([a, b], i) => {
        s += text(sx + 36, top + 528, b, { size: 30, weight: 700, color: C.brand });
        s += text(sx + 36, top + 556, a, { size: 14.5, color: C.muted });
        if (i < 3) s += rrect(sx + 160, top + 508, 1, 60, 0, C.line);
        sx += 170;
    });
    s += rrect(800, top + 490, 430, 96, 20, "#fbf7ec", ` stroke="#eadcb8" stroke-width="1.5"`);
    s += icon("academic", 830, top + 512, 26, C.gold700);
    s += text(870, top + 522, `Founded ${I.founded}`, { size: 16.5, weight: 700, color: C.ink });
    s += text(870, top + 548, "Qur'an, Arabic & classroom subjects", { size: 14.5, color: C.inkSoft });
    /* three info columns */
    const cols = [
        ["About the School", `A model madrasa in ${I.city} combining Qur'an memorisation, Arabic and the Nigerian classroom subjects — with printed report cards every term.`, "building"],
        ["Admissions", `Applications for the ${I.session} session are open. Apply online and track your admission status from the portal.`, "admissions"],
        ["News & Events", "First Term resumption, parent-teacher meetings and Qur'an completion ceremonies — published here and in the portal.", "calendar"],
    ];
    let colX = 64;
    cols.forEach(([t, body, ic]) => {
        s += rrect(colX, top + 616, 500, 220, 20, "#ffffff", ` stroke="${C.line}" stroke-width="1.5"`);
        s += rrect(colX + 28, top + 642, 52, 52, 14, C.surface) + icon(ic, colX + 42, top + 656, 26, C.ink800);
        s += text(colX + 28, top + 734, t, { size: 20.5, weight: 700, color: C.ink });
        const words = body.split(" ");
        let line = "", ly = top + 766;
        for (const w of words) {
            if ((line + " " + w).trim().length > 56) { s += text(colX + 28, ly, line, { size: 14.5, color: C.inkSoft }); ly += 22; line = w; }
            else line = (line + " " + w).trim();
        }
        if (line) s += text(colX + 28, ly, line, { size: 14.5, color: C.inkSoft });
        colX += 532;
    });
    s += rrect(0, H - 40, W, 40, 0, C.ink950);
    s += text(64, H - 14, `© 2026 ${I.nameEn} · Powered by EduSphere Education Platform`, { size: 13.5, color: "rgba(255,255,255,.65)" });
    s += text(W - 64, H - 14, `${I.email} · ${I.phone}`, { size: 13.5, color: "rgba(255,255,255,.65)", anchor: "end" });
    return { name: "website-islamic", w: W, h: H, inner: s, winBg: "#ffffff" };
}

/* ------------------------------------------------------------------ */
/* Western Academy — same platform, western category (real category    */
/* configuration: navy theme, 'My Academy', 'Academy Fees' labels)      */
/* ------------------------------------------------------------------ */
function westernDashScreen(d) {
    const W = 1660, H = 940;
    const academy = "Your Academy";
    const sidebar = [
        { label: "Dashboard", icon: "dashboard", active: true },
        { label: "My Academy", icon: "building" },
        { label: "Students", icon: "users" },
        { label: "Teachers", icon: "teacher" },
        { label: "Classes", icon: "classes" },
        { label: "Attendance", icon: "calendar" },
        { label: "Academic", icon: "academic" },
        { label: "Admissions", icon: "admissions" },
        { label: "Library", icon: "book" },
        { label: "Communication", icon: "chat" },
        { label: "Finance", icon: "money" },
        { label: "Payroll", icon: "payroll" },
        { label: "Staff Leave", icon: "leave" },
        { label: "Settings", icon: "settings" },
    ];
    let cm = "";
    cm += rrect(0, 0, 1308, 96, 18, "#08203f");
    cm += rrect(0, 0, 6, 96, 3, "#38bdf8");
    cm += text(32, 34, "YOUR ACADEMY WEBSITE", { size: 12.5, weight: 700, color: "#7dd3fc", spacing: ".08em" });
    cm += icon("globe", 32, 48, 24, "rgba(255,255,255,.8)");
    cm += text(66, 62, "https://edusphere.site/schools/your-academy", { size: 19, weight: 700, color: "#fff" });
    cm += text(66, 84, "A branded public website for your academy — updated from this dashboard.", { size: 13.5, color: "rgba(255,255,255,.65)" });
    cm += btn(1016, 26, 138, 44, "Visit Website", { fill: "#38bdf8", color: "#08203f", size: 16 });
    cm += btn(1164, 26, 124, 44, "Edit Website", { fill: "rgba(255,255,255,.1)", color: "#fff", stroke: "rgba(255,255,255,.35)", size: 16 });
    const stats = [
        ["users", "Total Students", "—"], ["teacher", "Total Teachers", "—"], ["classes", "Total Classes", "—"],
        ["book", "Academic Programs", "—"], ["calendar", "Attendance Today", "—", true], ["admissions", "Applications", "—", true],
        ["money", "Academy Fees", "₦0"], ["money", "Expenses", "₦0"],
    ];
    let sx = 0, sy = 116;
    stats.forEach(([ic, label, v, acc], i) => {
        cm += statCardLite(sx, sy, 315, label, v, { icon: ic, accent: acc });
        sx += 331; if ((i + 1) % 4 === 0) { sx = 0; sy += 128; }
    });
    cm += card(0, 384, 1308, 420);
    cm += cardHead(0, 384, 1308, "One platform — your identity", "Western Academy category");
    const rows2 = [
        ["palette", "Your branding", "Logo, colours, fonts and homepage layout — the platform disappears behind your identity."],
        ["academic", "Academic Programs", "Mathematics, English, Sciences, Computer Science, Business, Arts and more."],
        ["book", "Curriculum & subjects", "Your own programme structure — sessions, terms, examinations and report cards."],
        ["chat", "Community", "The same student, parent and teacher portals — speaking your academy's language."],
    ];
    let ry = 462;
    rows2.forEach(([ic, a, b]) => {
        cm += rrect(26, ry, 60, 60, 16, "#eaf3fb") + icon2(ic, 41, ry + 15, 30, "#0A2342");
        cm += text(112, ry + 27, a, { size: 19, weight: 700, color: "#0A2342" });
        cm += text(112, ry + 51, b, { size: 15, color: "#45566c" });
        ry += 84;
    });
    function icon2(n, x, y, sz, col) { return icon(n === "palette" ? "spark" : n, x, y, sz, col); }
    function statCardLite(x, y, w, label, value, o) {
        o = o || {};
        let s2 = rrect(x, y, w, 112, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
        s2 += rrect(x + 20, y + 20, 46, 46, 12, o.accent ? "#e0f2fe" : "#eef2f7");
        s2 += icon(o.icon || "users", x + 31, y + 31, 24, o.accent ? "#0284c7" : "#0A2342");
        s2 += text(x + 20, y + 94, label, { size: 15.5, color: "#5d6b7d" });
        s2 += text(x + w - 20, y + 54, value, { size: 24, weight: 700, color: o.accent ? "#0284c7" : "#0A2342", anchor: "end" });
        return s2;
    }
    const shell = dashShellNavy(W, H, sidebar, academy, cm);
    return { name: "western-dash", w: W, h: H, inner: shell, winBg: "#f4f7fb" };
}
function dashShellNavy(W, H, sidebar, brandSub, content) {
    const sideW = 300, topH = 86;
    let svg = rrect(0, 0, W, H, 0, "#f4f7fb");
    svg += rrect(0, 0, sideW, H, 0, "#08203f");
    svg += `<image href="${LOGO_B64}" x="22" y="20" width="46" height="46"/>`;
    svg += text(80, 40, "EduSphere", { size: 22, weight: 700, color: "#fff" });
    svg += text(80, 62, brandSub, { size: 15, color: "rgba(255,255,255,.55)" });
    let y = 96;
    for (const it of sidebar) {
        const active = !!it.active;
        if (active) { svg += rrect(12, y, sideW - 24, 40, 12, "#0f335f"); svg += rrect(12, y + 8, 4, 24, 2, "#38bdf8"); }
        svg += icon(it.icon || "dashboard", 30, y + 9, 22, active ? "#7dd3fc" : "rgba(255,255,255,.72)");
        svg += text(66, y + 26, it.label, { size: 18.5, weight: active ? 700 : 400, color: active ? "#fff" : "rgba(255,255,255,.82)" });
        y += 50;
    }
    svg += `<g transform="translate(${sideW},0)">`;
    svg += rrect(0, 0, W - sideW, topH, 0, "#ffffff");
    svg += rrect(0, topH - 1, W - sideW, 1, 0, "#dbe4ee");
    svg += text(40, 52, "Academy Dashboard", { size: 26, weight: 700, color: "#0A2342" });
    svg += rrect(W - sideW - 660, 22, 320, 42, 21, "#f0f4f9", ` stroke="#dbe4ee" stroke-width="1.5"`);
    svg += icon("search", W - sideW - 636, 33, 18, "#7a8aa0");
    svg += text(W - sideW - 608, 49, "Search…", { size: 16, color: "#7a8aa0" });
    svg += icon("bell", W - sideW - 280, 28, 26, "#42556e");
    svg += `<circle cx="${W - sideW - 220}" cy="42" r="22" fill="#0f335f"/>${text(W - sideW - 220, 50, "YA", { size: 17, weight: 700, color: "#fff", anchor: "middle" })}`;
    svg += text(W - sideW - 184, 48, "Academy Admin", { size: 17, weight: 700, color: "#0A2342" });
    svg += `<g transform="translate(36,${topH})">${content}</g></g>`;
    return svg;
}

/* ------------------------------------------------------------------ */
/* Multi-institution architecture diagram                              */
/* ------------------------------------------------------------------ */
function multiScreen(d) {
    const W = 1840, H = 1000;
    let s = backdrop("#3d1472");
    s += text(W / 2, 96, "One platform. Many institutions.", { size: 46, weight: 700, color: "#fff", anchor: "middle" });
    s += text(W / 2, 136, "Every school's records, users and website stay properly separated.", { size: 20, color: "rgba(255,255,255,.72)", anchor: "middle" });
    /* center hub */
    const cx2 = W / 2, cy2 = 540;
    s += `<circle cx="${cx2}" cy="${cy2}" r="150" fill="rgba(216,173,66,.12)"/>`;
    s += `<circle cx="${cx2}" cy="${cy2}" r="118" fill="${C.ink850}" stroke="${C.gold}" stroke-width="2.5"/>`;
    s += `<image href="${LOGO_B64}" x="${cx2 - 44}" y="${cy2 - 66}" width="88" height="88"/>`;
    s += text(cx2, cy2 + 52, "EDUSPHERE", { size: 21, weight: 700, color: "#fff", anchor: "middle", spacing: ".1em" });
    s += text(cx2, cy2 + 74, "Education Platform", { size: 13, color: "rgba(255,255,255,.6)", anchor: "middle" });
    const nodes = [
        { x: 210, y: 260, name: d.institution.nameEn, tag: "Islamic School", col: C.gold },
        { x: 210, y: 700, name: d.institution2.nameEn, tag: "Islamic School", col: C.gold },
        { x: 1310, y: 260, name: "Your Academy", tag: "Western Academy", col: "#38bdf8" },
        { x: 1310, y: 700, name: "Your Institution", tag: "Your branding", col: "#a78bfa" },
    ];
    nodes.forEach((n) => {
        s += `<line x1="${cx2}" y1="${cy2}" x2="${n.x + 220}" y2="${n.y + 76}" stroke="rgba(216,173,66,.5)" stroke-width="2.5" stroke-dasharray="2 10" stroke-linecap="round"/>`;
        s += rrect(n.x, n.y, 440, 152, 22, "rgba(255,255,255,.06)", ` stroke="rgba(255,255,255,.2)" stroke-width="1.5"`);
        s += `<circle cx="${n.x + 56}" cy="${n.y + 58}" r="26" fill="${n.col}" opacity=".2"/>`;
        s += icon("building", n.x + 38, n.y + 40, 36, n.col);
        s += text(n.x + 100, n.y + 56, n.name, { size: 20.5, weight: 700, color: "#fff" });
        s += text(n.x + 100, n.y + 82, n.tag, { size: 15, color: "rgba(255,255,255,.65)" });
        s += icon("lock", n.x + 100, n.y + 102, 18, "rgba(255,255,255,.55)");
        s += text(n.x + 126, n.y + 117, "Separated tenant data · own users · own website", { size: 13.5, color: "rgba(255,255,255,.6)" });
    });
    return { name: "multi", w: W, h: H, inner: s, full: true };
}

/* ------------------------------------------------------------------ */
/* Finale: pillars converge → logo + tagline + CTA                     */
/* ------------------------------------------------------------------ */
function pillarsScreen(stage) {
    const W = 1920, H = 1080;
    let s = backdrop("#4a2193");
    const pillars = ["ADMINISTRATION", "ACADEMICS", "COMMUNICATION", "FINANCE", "STAFF", "STUDENTS", "PARENTS", "WEBSITE"];
    if (stage === 1) {
        /* central dark stage — guaranteed contrast behind headline & pills */
        s += rrect(60, 300, 1800, 520, 36, "#12082e");
        s += rrect(60, 300, 1800, 520, 36, "none", ` stroke="rgba(255,255,255,.14)" stroke-width="1.5"`);
        s += text(W / 2, 430, "Everything a school runs on —", { size: 46, weight: 700, color: "#fff", anchor: "middle" });
        s += text(W / 2, 486, "finally in one place.", { size: 46, weight: 700, color: C.gold, anchor: "middle" });
        const pos = [[150, 550], [590, 550], [1030, 550], [1470, 550], [150, 662], [590, 662], [1030, 662], [1470, 662]];
        pillars.forEach((p, i) => {
            const [x, y] = pos[i];
            s += rrect(x, y, 320, 74, 20, "rgba(255,255,255,.12)", ` stroke="rgba(255,255,255,.34)" stroke-width="1.5"`);
            s += text(x + 160, y + 48, p, { size: 19.5, weight: 700, color: "#fff", anchor: "middle", spacing: ".06em" });
        });
    } else {
        s += `<circle cx="960" cy="430" r="240" fill="rgba(216,173,66,.1)"/>`;
        s += `<image href="${LOGO_B64}" x="800" y="190" width="320" height="320"/>`;
        s += text(960, 620, "EDUSPHERE", { size: 64, weight: 700, color: "#fff", anchor: "middle", spacing: ".18em" });
        s += text(960, 666, "E D U C A T I O N   M A N A G E M E N T   P L A T F O R M", { size: 17, weight: 400, color: "rgba(255,255,255,.78)", anchor: "middle", spacing: ".3em" });
        s += rrect(700, 706, 520, 3, 1.5, C.gold);
        s += text(960, 782, "One school. One platform.", { size: 38, weight: 700, color: C.gold, anchor: "middle" });
        s += text(960, 830, "Everything connected.", { size: 38, weight: 700, color: "#fff", anchor: "middle" });
        if (stage === 3) {
            s += btn(700, 880, 240, 62, "Get Started", { fill: C.gold, color: C.ink950, size: 21 });
            s += btn(972, 880, 320, 62, "Register Your Institution", { fill: "rgba(255,255,255,.1)", color: "#fff", stroke: "rgba(255,255,255,.4)", size: 20 });
            s += text(960, 986, "Modernize your school with EduSphere.", { size: 17.5, color: "rgba(255,255,255,.72)", anchor: "middle" });
        }
    }
    return { name: `pillars-${stage}`, w: W, h: H, inner: s, full: true };
}

/* Brand title card used at the end of Scene 1 */
function brandCardScreen(sub) {
    const W = 1920, H = 1080;
    let s = backdrop("#4a2193");
    s += `<image href="${LOGO_B64}" x="860" y="330" width="200" height="200"/>`;
    s += text(960, 640, "EDUSPHERE", { size: 76, weight: 700, color: "#fff", anchor: "middle", spacing: ".2em" });
    s += text(960, 696, "E D U C A T I O N   M A N A G E M E N T   P L A T F O R M", { size: 18, color: "rgba(255,255,255,.78)", anchor: "middle", spacing: ".32em" });
    if (sub) { s += rrect(790, 740, 340, 3, 1.5, C.gold); s += text(960, 804, sub, { size: 30, weight: 700, color: C.gold, anchor: "middle" }); }
    return { name: sub ? "brandcard-tag" : "brandcard", w: W, h: H, inner: s, full: true };
}

module.exports = { studentPortalScreen, parentPortalScreen, publicWebsiteScreen, westernDashScreen, multiScreen, pillarsScreen, brandCardScreen, phoneFrame };
