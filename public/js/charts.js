"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — chart helpers
   ----------------------------------------------------------------------------
   Tiny dependency-free SVG/HTML chart builders for the dashboards.

   Why hand-rolled? The app's Content-Security-Policy is `script-src 'self'`
   (see server/app.js), so no CDN chart library can ever load. Everything here
   emits inline markup that inherits the site theme through CSS classes and
   works identically in LTR and RTL.

   All builders return an HTML string; callers insert it with innerHTML next to
   their own escaped content. Every label passed in here is escaped again
   before it reaches the markup, so callers cannot inject through data.
   ========================================================================== */
(function () {
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Rounds a scale maximum up to 1/2/2.5/5/10 × 10^n so gridlines are pretty. */
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = 10 ** exp;
    const n = v / base;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * base;
  }

  function int(v) { return Math.round(num(v)).toLocaleString(); }
  function one(v) { return (Math.round(num(v) * 10) / 10).toLocaleString(); }
  function money(v) { return "₦" + Math.round(num(v)).toLocaleString(); }
  /** Compact axis label: 12500 -> 12.5k */
  function compact(v) {
    const n = num(v);
    if (Math.abs(n) >= 1000000) return (Math.round((n / 100000) * 1) / 10) + "m";
    if (Math.abs(n) >= 1000) return (Math.round(n / 100) / 10) + "k";
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  /** Trims '2026-09-09' -> '09/09' and '2026-09' -> 'Sep' for tight axes. */
  function shortLabel(label, all) {
    const s = String(label == null ? "" : label);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(8) + "/" + s.slice(5, 7);
    if (/^\d{4}-\d{2}$/.test(s)) {
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = Number(s.slice(5, 7));
      // Show the year on January, or on the first bucket, so a 12-month series
      // is unambiguous about which year it starts in.
      const showYear = m === 1 || (all && all[0] === s);
      return names[m - 1] ? names[m - 1] + (showYear ? " " + s.slice(2, 4) : "") : s;
    }
    return s.length > 14 ? s.slice(0, 13) + "…" : s;
  }

  /** How often to draw an x-axis label so they never collide. */
  function labelStride(count, maxLabels) {
    return Math.max(1, Math.ceil(count / Math.max(1, maxLabels)));
  }

  /* ------------------------------ bar chart ---------------------------- */

  /**
   * @param {Array<{label:string, value:number}>} data
   * @param {object} o { height, width, max, nice, format, axisFormat, tone }
   */
  function bar(data, o) {
    o = o || {};
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return empty(o);
    const W = o.width || 680;
    const H = o.height || 210;
    const pad = { top: 14, right: 12, bottom: 30, left: 44 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const rawMax = Math.max(0, ...rows.map((d) => num(d.value)));
    const max = o.max != null ? num(o.max) : (o.nice === false ? Math.max(rawMax, 1) : niceCeil(rawMax));
    const step = iw / rows.length;
    const bw = Math.max(3, Math.min(42, step * 0.62));
    const fmt = o.format || int;
    const afmt = o.axisFormat || compact;

    let grid = "";
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.top + ih - (ih * i) / ticks;
      grid += `<line class="ch-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}"/>` +
        `<text class="ch-tick" x="${pad.left - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(afmt((max * i) / ticks))}</text>`;
    }

    const stride = labelStride(rows.length, 9);
    let bars = "";
    rows.forEach((d, i) => {
      const v = num(d.value);
      const h = max > 0 ? (v / max) * ih : 0;
      const x = pad.left + step * i + (step - bw) / 2;
      const y = pad.top + ih - h;
      const label = o.labelOf ? o.labelOf(d) : d.label;
      bars += `<g class="ch-bar-g"><title>${esc(label)}: ${esc(fmt(v))}</title>` +
        `<rect class="ch-bar ${o.tone || ""}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(v > 0 ? 2 : 0, h).toFixed(1)}" rx="3"/>` +
        (i % stride === 0
          ? `<text class="ch-tick" x="${(x + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(shortLabel(label, rows.map((r) => r.label)))}</text>`
          : "") +
        `</g>`;
    });

    return svg(W, H, grid + bars, o.title);
  }

  /* ----------------------------- line chart ---------------------------- */

  /**
   * Line chart that tolerates gaps: a null value breaks the line rather than
   * drawing a misleading drop to zero (used for days with no attendance).
   */
  function line(data, o) {
    o = o || {};
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return empty(o);
    const W = o.width || 680;
    const H = o.height || 210;
    const pad = { top: 14, right: 14, bottom: 30, left: 44 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const defined = rows.filter((d) => d.value !== null && d.value !== undefined);
    const rawMax = defined.length ? Math.max(0, ...defined.map((d) => num(d.value))) : 1;
    const max = o.max != null ? num(o.max) : (o.nice === false ? Math.max(rawMax, 1) : niceCeil(rawMax));
    const fmt = o.format || one;
    const afmt = o.axisFormat || compact;

    let grid = "";
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.top + ih - (ih * i) / ticks;
      grid += `<line class="ch-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}"/>` +
        `<text class="ch-tick" x="${pad.left - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(afmt((max * i) / ticks))}</text>`;
    }

    const xAt = (i) => pad.left + (rows.length > 1 ? (iw * i) / (rows.length - 1) : iw / 2);
    const yAt = (v) => pad.top + ih - (max > 0 ? (num(v) / max) * ih : 0);

    // Build contiguous segments, breaking at nulls.
    const segments = [];
    let cur = [];
    rows.forEach((d, i) => {
      if (d.value === null || d.value === undefined) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else {
        cur.push({ x: xAt(i), y: yAt(d.value), d });
      }
    });
    if (cur.length) segments.push(cur);

    let paths = "";
    for (const seg of segments) {
      const pts = seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      if (o.area !== false && seg.length > 1) {
        const base = pad.top + ih;
        paths += `<polygon class="ch-area ${o.tone || ""}" points="${pts} ${seg[seg.length - 1].x.toFixed(1)},${base} ${seg[0].x.toFixed(1)},${base}"/>`;
      }
      if (seg.length > 1) paths += `<polyline class="ch-line ${o.tone || ""}" points="${pts}"/>`;
    }
    let dots = "";
    for (const seg of segments) {
      for (const p of seg) {
        dots += `<circle class="ch-dot ${o.tone || ""}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6"><title>${esc(p.d.label)}: ${esc(fmt(p.d.value))}</title></circle>`;
      }
    }

    const stride = labelStride(rows.length, 9);
    const allLabels = rows.map((r) => r.label);
    let axis = "";
    rows.forEach((d, i) => {
      if (i % stride !== 0) return;
      axis += `<text class="ch-tick" x="${xAt(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(shortLabel(d.label, allLabels))}</text>`;
    });

    return svg(W, H, grid + paths + dots + axis, o.title);
  }

  /* ----------------------------- donut chart --------------------------- */

  const SLICE_CLASSES = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];

  function polar(cx, cy, r, a) {
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function ringSlice(cx, cy, ro, ri, a1, a2) {
    const [x1, y1] = polar(cx, cy, ro, a1);
    const [x2, y2] = polar(cx, cy, ro, a2);
    const [x3, y3] = polar(cx, cy, ri, a2);
    const [x4, y4] = polar(cx, cy, ri, a1);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ro} ${ro} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}` +
      ` L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${ri} ${ri} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  }

  /**
   * @param {Array<{label:string, value:number}>} slices
   * @param {object} o { size, centerLabel, format, legend }
   */
  function donut(slices, o) {
    o = o || {};
    const rows = (Array.isArray(slices) ? slices : []).filter((s) => num(s.value) > 0);
    if (!rows.length) return empty(o);
    const size = o.size || 170;
    const cx = size / 2;
    const cy = size / 2;
    const ro = size / 2 - 4;
    const ri = ro * 0.6;
    const total = rows.reduce((s, x) => s + num(x.value), 0);
    const fmt = o.format || int;

    let angle = -Math.PI / 2;
    let paths = "";
    rows.forEach((s, i) => {
      const frac = num(s.value) / total;
      const cls = SLICE_CLASSES[i % SLICE_CLASSES.length];
      const tip = `<title>${esc(s.label)}: ${esc(fmt(s.value))} (${Math.round(frac * 100)}%)</title>`;
      if (frac >= 0.9999) {
        // A full ring cannot be one arc (start == end), so split it in two.
        paths += `<path class="ch-slice ${cls}" d="${ringSlice(cx, cy, ro, ri, angle, angle + Math.PI)}">${tip}</path>`;
        paths += `<path class="ch-slice ${cls}" d="${ringSlice(cx, cy, ro, ri, angle + Math.PI, angle + 2 * Math.PI)}">${tip}</path>`;
      } else {
        const a2 = angle + frac * 2 * Math.PI;
        paths += `<path class="ch-slice ${cls}" d="${ringSlice(cx, cy, ro, ri, angle, a2)}">${tip}</path>`;
        angle = a2;
      }
    });

    const center = o.centerLabel
      ? `<text class="ch-donut-num" x="${cx}" y="${cy + 2}" text-anchor="middle">${esc(o.centerValue != null ? o.centerValue : total)}</text>` +
        `<text class="ch-donut-lbl" x="${cx}" y="${cy + 18}" text-anchor="middle">${esc(o.centerLabel)}</text>`
      : "";

    const legendRows = rows.map((s, i) => {
      const cls = SLICE_CLASSES[i % SLICE_CLASSES.length];
      return `<li><span class="lg-dot ${cls}"></span>${esc(s.label)} <b>${esc(fmt(s.value))}</b>` +
        `<span class="muted"> ${Math.round((num(s.value) / total) * 100)}%</span></li>`;
    }).join("");

    return `<div class="donut-wrap">` +
      svg(size, size, paths + center, o.title) +
      (o.legend === false ? "" : `<ul class="legend">${legendRows}</ul>`) +
      `</div>`;
  }

  /* -------------------------- horizontal bars -------------------------- */

  /**
   * Labelled horizontal bars — the clearest layout for ranked lists such as
   * class averages, and it reflows naturally in RTL.
   * @param {Array<{label:string, value:number, sub?:string}>} items
   * @param {object} o { max, format, tone, suffix }
   */
  function hbar(items, o) {
    o = o || {};
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return empty(o);
    const max = o.max != null ? num(o.max) : Math.max(1, ...rows.map((r) => num(r.value)));
    const fmt = o.format || one;
    const suffix = o.suffix || "";
    return `<div class="hbars">` + rows.map((r) => {
      const v = num(r.value);
      const w = Math.max(0, Math.min(100, (v / max) * 100));
      return `<div class="hbar">` +
        `<span class="hbar-lbl" title="${esc(r.label)}">${esc(r.label)}</span>` +
        `<span class="hbar-track"><i class="${o.tone || ""}" style="width:${w.toFixed(1)}%"></i></span>` +
        `<span class="hbar-val">${esc(fmt(v))}${esc(suffix)}${r.sub ? ` <span class="muted small">${esc(r.sub)}</span>` : ""}</span>` +
        `</div>`;
    }).join("") + `</div>`;
  }

  /* ------------------------------ plumbing ----------------------------- */

  function svg(w, h, inner, title) {
    const t = title ? `<title>${esc(title)}</title>` : "";
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">${t}${inner}</svg>`;
  }

  function empty(o) {
    const cls = (o && o.emptyClass) || "chart-empty";
    const msg = (o && o.emptyText) || "";
    return `<div class="${esc(cls)}">${esc(msg)}</div>`;
  }

  window.Charts = { bar, line, donut, hbar, esc, num, int, one, money, compact, shortLabel, niceCeil };
})();
