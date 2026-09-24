"use strict";

/* Renders all promo UI screens to PNG via @resvg/resvg-js (2x supersample). */
const fs = require("fs");
const path = require("path");
const { Resvg } = require("/home/user/video-tools/node_modules/@resvg/resvg-js");
const { svgDoc, rrect } = require("./lib");
const { load } = require("./data");
const D = require("./screens-desktop");
const X = require("./screens-extra");

const OUT = process.argv[2] || "/home/user/video-tools/assets/ui";
fs.mkdirSync(OUT, { recursive: true });

const d = load();

function render(name, scr) {
    let body;
    let W = scr.w, H = scr.h;
    if (scr.full) {
        body = scr.inner;
    } else {
        const win = D.appWindow(scr.w, scr.h, scr.inner, { bg: scr.winBg });
        body = D.backdrop() + win.svg;
        W = 1920; H = 1080;
    }
    const svg = svgDoc(W, H, body);
    const scale = Number(process.env.RENDER_SCALE || 2);
    const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: W * scale },
        font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
        background: "rgba(0,0,0,0)",
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), resvg.render().asPng());
    console.log("rendered", name, `${W * scale}x${H * scale}`);
}

const screens = {
    home: D.homeScreen(),
    superadmin: D.superAdminScreen(d),
    admindash: D.adminDashScreen(d),
    students: D.studentsScreen(d),
    "teacher-att": D.teacherAttendanceScreen(d),
    "teacher-assign": D.teacherAssignmentsScreen(d),
    finance: D.financeScreen(d),
    payroll: D.payrollScreen(d),
    comm: D.communicationScreen(d),
    "student-phone": X.studentPortalScreen(d),
    "parent-phone": X.parentPortalScreen(d, false),
    "parent-toast": X.parentPortalScreen(d, true),
    "website-islamic": X.publicWebsiteScreen(d),
    "western-dash": X.westernDashScreen(d),
    multi: X.multiScreen(d),
    "pillars-1": X.pillarsScreen(1),
    "pillars-2": X.pillarsScreen(2),
    "pillars-3": X.pillarsScreen(3),
    brandcard: X.brandCardScreen(null),
    "brandcard-tag": X.brandCardScreen("One school. One platform. Everything connected."),
};

const only = process.argv[3] ? process.argv[3].split(",") : null;
for (const [name, scr] of Object.entries(screens)) {
    if (only && !only.includes(name)) continue;
    render(name, scr);
}
console.log("done ->", OUT);
