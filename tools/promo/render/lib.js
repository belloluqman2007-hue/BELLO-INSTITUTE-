"use strict";

/*
 * EduSphere promotional video — UI screen renderer (shared SVG helpers).
 *
 * These screens are faithful re-creations of the REAL EduSphere interface:
 * sidebar labels, navigation, dashboard cards, portal menus, colours and
 * demo data are all taken from the actual application code
 * (public/js/dashboard.js, portal-*.js, app.js and the live demo seed).
 * They are rendered as SVG and rasterised with @resvg/resvg-js so the promo
 * shows the product's real module names and real demo institution data —
 * no invented features, no invented customers.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOGO_B64 = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "../../public/assets/edusphere-logo.png")).toString("base64");

/* Real EduSphere design tokens (public/css/app.css) */
const C = {
    ink950: "#17062d",
    ink900: "#1f083b",
    ink850: "#260b49",
    ink800: "#2d0e56",
    ink700: "#371761",
    brand: "#200A3D",
    gold700: "#b78318",
    gold: "#d8ad42",
    goldDeep: "#C8952C",
    goldLight: "#f4e5bd",
    paper: "#ffffff",
    canvas: "#fbfafc",
    surface: "#f4f3f7",
    line: "#e4e1e9",
    ink: "#221533",
    inkSoft: "#4b4059",
    muted: "#6b6575",
    green: "#1e9e6a",
    greenSoft: "#e3f5ec",
    red: "#d64545",
    redSoft: "#fdeaea",
    amber: "#c07f13",
    amberSoft: "#fdf3df",
    sky: "#2f9bd8",
    navy: "#0A2342",
    navySoft: "#eaf3fb",
};

const F = `font-family="'DejaVu Sans', sans-serif"`;

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* icons (24px stroke style, matching the app's icon language)         */
/* ------------------------------------------------------------------ */
function icon(name, x, y, size, color, sw) {
    const s = size || 24;
    const p = {
        dashboard: `<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>`,
        building: `<path d="M4 21V5l8-2v18M20 21V9l-8-2M8 7h1M8 11h1M8 15h1M14 11h1M18 11h1M14 15h1M18 15h1M2 21h20"/>`,
        users: `<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.1A4.9 4.9 0 0 1 8.4 13h1.2a4.9 4.9 0 0 1 4.9 4.9V20M16 5.5a3 3 0 0 1 0 5.8M18.3 13.4a4.7 4.7 0 0 1 2.2 4V20"/>`,
        file: `<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6ZM13 3v6h6M9 13h6M9 17h4"/>`,
        teacher: `<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.3v4.4c2.6 2.2 7.4 2.2 10 0v-4.4M21 9v5"/>`,
        classes: `<path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M6 12.2V17c2.9 2.7 9.1 2.7 12 0v-4.8M21 10v6"/>`,
        calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>`,
        check: `<path d="m5 12.5 4.2 4.2L19.5 6.5"/>`,
        academic: `<path d="M4 19V5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V19Z"/><path d="M8 7h8M8 11h5"/>`,
        admissions: `<path d="m4 20 4.1-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 7.5 3 3"/>`,
        book: `<path d="M4 5.7A3.7 3.7 0 0 1 7.7 2H20v18H7.7A3.7 3.7 0 0 0 4 23V5.7Z"/><path d="M8 7h8"/>`,
        chat: `<path d="M4 5h16v11H13l-5 4v-4H4V5Z"/><path d="M8 9h8M8 12h5"/>`,
        money: `<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/>`,
        payroll: `<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>`,
        leave: `<path d="M12 21c-4-3.5-7-6.6-7-10a7 7 0 0 1 14 0c0 3.4-3 6.5-7 10Z"/><path d="M12 8v3.5l2.5 1.5"/>`,
        settings: `<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>`,
        shield: `<path d="M12 3 19 6v5.4c0 4.2-2.8 7.8-7 9.6-4.2-1.8-7-5.4-7-9.6V6l7-3Z"/><path d="m8.5 12 2.2 2.2 4.7-4.7"/>`,
        chart: `<path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7"/>`,
        activity: `<path d="M3 12h4l2.5 6 4-12L16 12h5"/>`,
        bell: `<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z"/><path d="M10 19a2 2 0 0 0 4 0"/>`,
        globe: `<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.1 3.5 8.5S14.3 18.2 12 20.5C9.7 18.2 8.5 15.4 8.5 12S9.7 5.8 12 3.5Z"/>`,
        search: `<circle cx="10.8" cy="10.8" r="6.4"/><path d="m16 16 4.4 4.4"/>`,
        plus: `<path d="M12 5v14M5 12h14"/>`,
        external: `<path d="M7 17 17 7M9 7h8v8"/>`,
        clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
        pin: `<path d="M20 10.2c0 5.2-8 10.3-8 10.3s-8-5.1-8-10.3a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10.2" r="2.6"/>`,
        spark: `<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/>`,
        card: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>`,
        receipt: `<path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3Z"/><path d="M9 8h6M9 12h6"/>`,
        send: `<path d="m4 11 16-7-5 16-3.5-6.5L4 11Z"/><path d="m11.5 13.5 4-4"/>`,
        home: `<path d="m4 11 8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z"/>`,
        monitor: `<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>`,
        tablet: `<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M10.5 17.8h3"/>`,
        phone: `<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.8h3"/>`,
        chevron: `<path d="m9 6 6 6-6 6"/>`,
        arrow: `<path d="M5 12h13M13 6l6 6-6 6"/>`,
        lock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
    }[name] || "";
    return `<g transform="translate(${x},${y}) scale(${s / 24})" fill="none" stroke="${color}" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round">${p}</g>`;
}

/* ------------------------------------------------------------------ */
/* small text helpers                                                  */
/* ------------------------------------------------------------------ */
function text(x, y, str, o) {
    o = o || {};
    const size = o.size || 24;
    const color = o.color || C.ink;
    const weight = o.weight || 400;
    const anchor = o.anchor || "start";
    const spacing = o.spacing !== undefined ? ` letter-spacing="${o.spacing}"` : "";
    const opacity = o.opacity !== undefined ? ` opacity="${o.opacity}"` : "";
    return `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${spacing}${opacity}>${esc(str)}</text>`;
}
function rrect(x, y, w, h, r, fill, extra) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${extra || ""}/>`;
}
function pill(x, y, str, o) {
    o = o || {};
    const size = o.size || 19;
    const padX = o.padX || 16;
    const h = o.h || 34;
    const fill = o.fill || C.greenSoft;
    const color = o.color || C.green;
    const w = o.w || Math.round(str.length * size * 0.6 + padX * 2);
    return `<g>${rrect(x, y, w, h, h / 2, fill)}${text(x + w / 2, y + h / 2 + size * 0.36, str, { size, color, weight: o.weight || 700, anchor: "middle" })}</g>`;
}
function btn(x, y, w, h, str, o) {
    o = o || {};
    const fill = o.fill || C.brand;
    const color = o.color || "#fff";
    const size = o.size || 22;
    return `<g>${rrect(x, y, w, h, o.r || h / 2, fill, o.stroke ? ` stroke="${o.stroke}" stroke-width="1.5"` : "")}${o.icon ? icon(o.icon, x + 22, y + h / 2 - size * 0.55, size * 1.1, color, 2) : ""}${text(x + w / 2 + (o.icon ? size * 0.55 : 0), y + h / 2 + size * 0.36, str, { size, color, weight: 700, anchor: "middle" })}</g>`;
}

/* Browser chrome for public pages */
function browserChrome(url, w, inner) {
    const barH = 64;
    return `
  ${rrect(0, 0, w, barH, 0, "#efeef3")}
  <circle cx="34" cy="32" r="8" fill="#e26a5f"/><circle cx="60" cy="32" r="8" fill="#e8b53f"/><circle cx="86" cy="32" r="8" fill="#63bb6b"/>
  ${rrect(116, 16, w - 170, 32, 16, "#ffffff", ` stroke="${C.line}" stroke-width="1.5"`)}
  ${icon("lock", 136, 24, 16, C.muted, 2)}
  ${text(162, 38, url, { size: 17, color: C.inkSoft })}
  <g transform="translate(0,${barH})">${inner}</g>`;
}

/* The EduSphere dashboard shell — real sidebar layout */
function dashShell(o) {
    // o: { w,h, sidebar: [{label, icon, active, sub?}], brandName, brandSub, title, chip, accent, topActions, content(x,y,w,h) }
    const W = o.w || 1720;
    const H = o.h || 1000;
    const sideW = o.sideW || 300;
    const topH = 86;
    const accent = o.accent || C.gold;
    let svg = rrect(0, 0, W, H, 0, C.surface);
    /* sidebar */
    svg += rrect(0, 0, sideW, H, 0, C.ink900);
    svg += rrect(sideW - 1, 0, 1, H, 0, "rgba(255,255,255,.06)");
    svg += `<image href="${LOGO_B64}" x="22" y="20" width="46" height="46"/>`;
    svg += text(80, 40, o.brandName || "EduSphere", { size: 22, weight: 700, color: "#fff" });
    svg += text(80, 62, o.brandSub || "", { size: 15, color: "rgba(255,255,255,.55)" });
    let y = 96;
    for (const it of o.sidebar) {
        const active = !!it.active;
        if (active) {
            svg += rrect(12, y, sideW - 24, 40, 12, C.ink800);
            svg += rrect(12, y + 8, 4, 24, 2, accent);
        }
        svg += icon(it.icon || "dashboard", 30, y + 9, 22, active ? accent : "rgba(255,255,255,.72)");
        svg += text(66, y + 26, it.label, { size: 18.5, weight: active ? 700 : 400, color: active ? "#fff" : "rgba(255,255,255,.82)" });
        if (it.count !== undefined) svg += pill(sideW - 58, y + 7, String(it.count), { size: 14, h: 26, fill: accent, color: C.ink950 });
        y += 44;
        if (it.sub) {
            for (const s of it.sub) {
                svg += text(66, y + 24, s.label || s, { size: 15.5, color: s.active ? accent : "rgba(255,255,255,.6)", weight: s.active ? 700 : 400 });
                if (s.active) svg += rrect(30, y + 12, 3, 16, 1.5, accent);
                y += 36;
            }
        }
        y += 6;
    }
    /* content region */
    svg += `<g transform="translate(${sideW},0)">`;
    svg += rrect(0, 0, W - sideW, topH, 0, C.paper);
    svg += rrect(0, topH - 1, W - sideW, 1, 0, C.line);
    svg += text(40, 52, o.title || "", { size: 26, weight: 700, color: C.ink });
    if (o.crumb) svg += text(40, 26, o.crumb, { size: 14.5, color: C.muted });
    /* search */
    svg += rrect(W - sideW - 660, 22, 320, 42, 21, C.surface, ` stroke="${C.line}" stroke-width="1.5"`);
    svg += icon("search", W - sideW - 636, 33, 18, C.muted);
    svg += text(W - sideW - 608, 49, "Search…", { size: 16, color: C.muted });
    svg += icon("bell", W - sideW - 280, 28, 26, C.inkSoft);
    if (o.bellDot) svg += `<circle cx="${W - sideW - 261}" cy="30" r="6" fill="${C.red}"/>`;
    svg += `<circle cx="${W - sideW - 220}" cy="42" r="22" fill="${C.ink800}"/>${text(W - sideW - 220, 50, o.chip || "SA", { size: 17, weight: 700, color: "#fff", anchor: "middle" })}`;
    svg += text(W - sideW - 184, 48, o.user || "Administrator", { size: 17, weight: 700, color: C.ink });
    svg += `<g transform="translate(36,${topH})">`;
    svg += o.content;
    svg += `</g></g>`;
    return svg;
}

function svgDoc(w, h, body, bg) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg || ""}${body}</svg>`;
}

/* standard full-frame card grid */
function statCard(x, y, w, label, value, o) {
    o = o || {};
    const h = o.h || 128;
    let s = rrect(x, y, w, h, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`);
    s += rrect(x + 22, y + 22, 52, 52, 14, o.accent ? "#fff7e8" : C.surface);
    s += icon(o.icon || "users", x + 34, y + 34, 28, o.accent ? C.gold700 : C.ink700);
    s += text(x + 22, y + 100, label, { size: 17, color: C.muted });
    s += text(x + w - 22, y + 62, value, { size: o.vsize || 34, weight: 700, color: o.accent ? C.gold700 : C.ink, anchor: "end" });
    if (o.sub) s += text(x + w - 22, y + 100, o.sub, { size: 15, color: C.muted, anchor: "end" });
    return s;
}

function card(x, y, w, h) {
    return rrect(x, y, w, h, 18, C.paper, ` stroke="${C.line}" stroke-width="1.5"`) + rrect(x, y + h - 1, w, 1, 0, "rgba(31,8,59,.03)");
}
function cardHead(x, y, w, title, hint) {
    return text(x + 26, y + 40, title, { size: 21, weight: 700, color: C.ink }) + (hint ? text(x + w - 26, y + 40, hint, { size: 15, color: C.muted, anchor: "end" }) : "") + rrect(x + 26, y + 56, w - 52, 1.5, 0, C.line);
}

function table(x, y, w, cols, rows, o) {
    o = o || {};
    const rowH = o.rowH || 56;
    const headH = 46;
    let s = "";
    let cx = x;
    const xs = cols.map((col) => { const out = { x: cx, w: col.w, align: col.align || "left" }; cx += col.w; return out; });
    s += text(0, 0, "", { size: 1, opacity: 0 });
    cols.forEach((col, i) => {
        const tx = xs[i].align === "right" ? xs[i].x + xs[i].w - 4 : xs[i].x + 4;
        s += text(tx, y + 28, col.label, { size: 14.5, weight: 700, color: C.muted, anchor: xs[i].align === "right" ? "end" : "start", spacing: ".04em" });
    });
    s += rrect(x, y + headH - 8, w, 1.5, 0, C.line);
    rows.forEach((row, ri) => {
        const ry = y + headH + ri * rowH;
        if (ri % 2 === 0) s += rrect(x, ry, w, rowH, 0, "rgba(31,8,59,.022)");
        row.cells.forEach((cell, ci) => {
            const col = xs[ci];
            const tx = col.align === "right" ? col.x + col.w - 8 : col.x + 8;
            const anchor = col.align === "right" ? "end" : "start";
            if (typeof cell === "string") {
                s += text(tx, ry + rowH / 2 + 6.5, cell, { size: 17, color: ci === 0 ? C.ink : C.inkSoft, weight: ci === 0 ? 700 : 400, anchor });
            } else if (cell.pill) {
                const pw = Math.round(cell.pill.length * 10.2 + 28);
                s += pill(col.align === "right" ? col.x + col.w - 8 - pw : tx, ry + rowH / 2 - 15, cell.pill, { size: 13.5, h: 30, fill: cell.fill || C.greenSoft, color: cell.color || C.green });
            } else if (cell.html) {
                s += cell.html(tx, ry, rowH, anchor);
            }
        });
    });
    return s;
}

module.exports = { C, F, esc, icon, text, rrect, pill, btn, browserChrome, dashShell, svgDoc, statCard, card, cardHead, table, LOGO_B64 };
