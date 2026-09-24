"use strict";

/* Composites: device trio (laptop/tablet/phone) + category split plates. */
const fs = require("fs");
const path = require("path");
const { Resvg } = require("/home/user/video-tools/node_modules/@resvg/resvg-js");
const { C, icon, text, rrect, pill, svgDoc, LOGO_B64 } = require("./lib");
const { backdrop } = require("./screens-desktop");

const OUT = "/home/user/video-tools/assets/ui";
const UI = "/home/user/video-tools/assets/ui";
const IMG = "/home/user/EduSphere-Education-Management-Platform/tools/promo/frames";

function b64(p) { return "data:image/png;base64," + fs.readFileSync(p).toString("base64"); }
function b64jpg(p) { return "data:image/jpeg;base64," + fs.readFileSync(p).toString("base64"); }

function render(name, W, H, body) {
    const resvg = new Resvg(svgDoc(W, H, body), {
        fitTo: { mode: "width", value: W * 2 },
        font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), resvg.render().asPng());
    console.log("rendered", name);
}

/* ---------- Device trio: laptop + tablet + phone on a dark stage ---------- */
function devices() {
    const W = 1920, H = 1080;
    const lap = b64(`${UI}/admindash.png`);   // 3840x2160
    const tab = b64(`${UI}/teacher-att.png`);
    const ph  = b64(`${UI}/student-phone.png`); // 3440x2000 (framed plate) — use raw phone crop instead
    let s = backdrop("#3d1472");
    s += text(960, 108, "Your school, on every screen", { size: 52, weight: 700, color: "#fff", anchor: "middle" });
    s += text(960, 156, "The same connected platform — desktop, tablet and smartphone.", { size: 22, color: "rgba(255,255,255,.72)", anchor: "middle" });

    /* laptop */
    const lw = 1080, lh = lw * 2160 / 3840;
    const lx = 130, ly = 280;
    s += rrect(lx - 18, ly + lh + 30, lw + 36, 60, 18, "rgba(5,0,12,.55)");
    s += rrect(lx - 10, ly - 14, lw + 20, lh + 28, 22, "#0d0616");
    s += `<image href="${lap}" x="${lx}" y="${ly}" width="${lw}" height="${lh}" preserveAspectRatio="xMidYMid slice"/>`;
    s += `<defs><clipPath id="lapc"><rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="10"/></clipPath></defs>`;
    s += rrect(lx - 60, ly + lh + 10, lw + 120, 26, 10, "#241a33");
    /* tablet */
    const tw = 520, th = tw * 2160 / 3840;
    const tx = 1150, ty = 500;
    s += rrect(tx - 16, ty + th + 24, tw + 32, 50, 16, "rgba(5,0,12,.5)");
    s += rrect(tx - 12, ty - 12, tw + 24, th + 24, 24, "#0d0616");
    s += `<defs><clipPath id="tabc"><rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="8"/></clipPath></defs>`;
    s += `<g clip-path="url(#tabc)"><image href="${tab}" x="${tx - 90}" y="${ty - 12}" width="${tw * 1.35}" height="${th * 1.35}" preserveAspectRatio="xMidYMid slice"/></g>`;
    /* phone — crop the student phone UI region from its plate (plate 3440x2000,
       phone frame drawn at 640+14..655+430*1.28-14; in plate coords) */
    const pw = 300, phh = 620;
    const px = 1530, py = 330;
    s += rrect(px - 18, py + phh + 22, pw + 36, 46, 16, "rgba(5,0,12,.5)");
    s += rrect(px - 10, py - 10, pw + 20, phh + 20, 42, "#0d0616");
    s += `<defs><clipPath id="phc"><rect x="${px}" y="${py}" width="${pw}" height="${phh}" rx="30"/></clipPath></defs>`;
    /* student plate is 3440x2000; phone viewport inside begins x=(640+14)*2, y=(40+14)*2, w=(430*1.28-28)*2, h=(880*0.98-28)*2 */
    const scale = pw / (430 * 1.28 - 28);
    s += `<g clip-path="url(#phc)"><image href="${ph}" x="${px - (654) * scale}" y="${py - (54) * scale}" width="${1720 * scale}" height="${1000 * scale}"/></g>`;
    /* labels */
    const lab = [["monitor", "Desktop", lx + lw / 2], ["tablet", "Tablet", tx + tw / 2], ["phone", "Smartphone", px + pw / 2]];
    lab.forEach(([ic, t, cx]) => {
        s += `<g>${rrect(cx - 92, 1008, 184, 44, 22, "rgba(255,255,255,.08)", ` stroke="rgba(255,255,255,.2)" stroke-width="1.5"`)}${icon(ic, cx - 70, 1018, 22, C.gold)}${text(cx + 8, 1037, t, { size: 17, weight: 700, color: "#fff", anchor: "middle" })}</g>`;
    });
    render("devices", W, H, s);
}

/* ---------- Split: islamic photo | western photo ---------- */
function splitPhotos() {
    const W = 1920, H = 1080;
    const l = b64jpg(`${IMG}/sc11-islamic.jpg`);
    const r = b64jpg(`${IMG}/sc11-western.jpg`);
    let s = "";
    s += `<defs><clipPath id="hl"><rect x="0" y="0" width="960" height="1080"/></clipPath><clipPath id="hr"><rect x="960" y="0" width="960" height="1080"/></clipPath></defs>`;
    s += `<g clip-path="url(#hl)"><image href="${l}" x="0" y="0" width="960" height="1080" preserveAspectRatio="xMidYMid slice"/></g>`;
    s += `<g clip-path="url(#hr)"><image href="${r}" x="960" y="0" width="960" height="1080" preserveAspectRatio="xMidYMid slice"/></g>`;
    s += rrect(958, 0, 4, 1080, 0, "#fff", ' opacity=".9"');
    s += `<defs><linearGradient id="shL" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#0a0320" stop-opacity=".96"/><stop offset="40%" stop-color="#0a0320" stop-opacity=".88"/><stop offset="75%" stop-color="#0a0320" stop-opacity=".45"/><stop offset="100%" stop-color="#0a0320" stop-opacity="0"/></linearGradient></defs>`;
    s += rrect(0, 500, 960, 580, 0, "url(#shL)");
    s += rrect(960, 500, 960, 580, 0, "url(#shL)");
    s += `<image href="${LOGO_B64}" x="64" y="760" width="64" height="64"/>`;
    s += text(148, 792, "ISLAMIC SCHOOLS", { size: 21, weight: 700, color: C.gold, spacing: ".12em" });
    s += text(148, 842, "Qur'an, Arabic & classroom subjects —", { size: 27, weight: 700, color: "#fff" });
    s += text(148, 882, "with Hifz progress tracking built in.", { size: 27, weight: 700, color: "#fff" });
    s += `<image href="${LOGO_B64}" x="1024" y="760" width="64" height="64"/>`;
    s += text(1108, 792, "WESTERN ACADEMIES", { size: 21, weight: 700, color: "#7dd3fc", spacing: ".12em" });
    s += text(1108, 842, "Modern programmes, academics &", { size: 27, weight: 700, color: "#fff" });
    s += text(1108, 882, "report cards — in your academy's identity.", { size: 27, weight: 700, color: "#fff" });
    render("split-photos", W, H, s);
}

/* ---------- Split: islamic public website | western academy dashboard ---------- */
function splitSites() {
    const W = 1920, H = 1080;
    const l = b64(`${UI}/website-islamic.png`);
    const r = b64(`${UI}/western-dash.png`);
    let s = backdrop("#3d1472");
    const w = 860, h = w * 2160 / 3840;
    s += rrect(40 - 14, 150 + h + 18, w + 28, 56, 16, "rgba(5,0,12,.5)");
    s += rrect(40, 150, w, h, 20, "#0d0616");
    s += `<defs><clipPath id="pl"><rect x="40" y="150" width="${w}" height="${h}" rx="18"/></clipPath></defs>`;
    s += `<g clip-path="url(#pl)"><image href="${l}" x="40" y="150" width="${w}" height="${h}"/></g>`;
    s += `<g>${rrect(40, 700, w, 120, 18, C.ink900)}${icon("globe", 80, 738, 34, C.gold)}${text(134, 762, "Branded public school websites", { size: 25, weight: 700, color: "#fff" })}${text(134, 796, "Logo · colours · admissions · news · contact", { size: 17, color: "rgba(255,255,255,.72)" })}</g>`;
    s += rrect(1020 - 14, 150 + h + 18, w + 28, 56, 16, "rgba(5,0,12,.5)");
    s += rrect(1020, 150, w, h, 20, "#0d0616");
    s += `<defs><clipPath id="pr"><rect x="1020" y="150" width="${w}" height="${h}" rx="18"/></clipPath></defs>`;
    s += `<g clip-path="url(#pr)"><image href="${r}" x="1020" y="150" width="${w}" height="${h}"/></g>`;
    s += `<g>${rrect(1020, 700, w, 120, 18, "#08203f")}${icon("building", 1060, 738, 34, "#38bdf8")}${text(1114, 762, "Western academy dashboards", { size: 25, weight: 700, color: "#fff" })}${text(1114, 796, "My Academy · Academy Fees · Academic Programs", { size: 17, color: "rgba(255,255,255,.72)" })}</g>`;
    s += `<g>${rrect(880, 380, 160, 160, 80, C.ink950, ` stroke="${C.gold}" stroke-width="3"`)}<image href="${LOGO_B64}" x="912" y="412" width="96" height="96"/></g>`;
    s += text(960, 930, "One platform — two very different identities.", { size: 27, weight: 700, color: "#fff", anchor: "middle" });
    render("split-sites", W, H, s);
}

devices();
splitPhotos();
splitSites();
