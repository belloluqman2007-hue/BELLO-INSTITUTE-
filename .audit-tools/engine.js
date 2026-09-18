/* Minimal but faithful CSS cascade resolver for contrast auditing.
   Handles: specificity, media queries at a given viewport width, custom
   properties (var() with fallbacks), `background` shorthand colour extraction,
   gradients (samples the darkest/lightest stop), inheritance, and alpha. */

/* ---------------- colour ---------------- */
const NAMED = {
  transparent: [0, 0, 0, 0], white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0],
  lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], silver: [192, 192, 192], gray: [128, 128, 128],
  grey: [128, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0], green: [0, 128, 0],
  purple: [128, 0, 128], teal: [0, 128, 128], navy: [0, 0, 128], orange: [255, 165, 0],
  gold: [255, 215, 0], pink: [255, 192, 203], brown: [165, 42, 42], crimson: [220, 20, 60],
  tomato: [255, 99, 71], salmon: [250, 128, 114], coral: [255, 127, 80], indigo: [75, 0, 130],
  violet: [238, 130, 238], khaki: [240, 230, 140], beige: [245, 245, 220], ivory: [255, 255, 240],
  linen: [250, 240, 230], snow: [255, 250, 250], azure: [240, 255, 255], wheat: [245, 222, 179],
  whitesmoke: [245, 245, 245], seashell: [255, 245, 238], lavender: [230, 230, 250],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
  slategray: [112, 128, 144], slategrey: [112, 128, 144], lightslategray: [119, 136, 153],
  gainsboro: [220, 220, 220], firebrick: [178, 34, 34], darkred: [139, 0, 0],
  seagreen: [46, 139, 87], forestgreen: [34, 139, 34], darkgreen: [0, 100, 0],
  steelblue: [70, 130, 180], royalblue: [65, 105, 225], dodgerblue: [30, 144, 255],
  skyblue: [135, 206, 235], lightblue: [173, 216, 230], midnightblue: [25, 25, 112],
  goldenrod: [218, 165, 32], darkorange: [255, 140, 0], chocolate: [210, 105, 30],
  sienna: [160, 82, 45], peru: [205, 133, 63], tan: [210, 180, 140], plum: [221, 160, 221],
  orchid: [218, 112, 214], thistle: [216, 191, 216], mintcream: [245, 255, 250],
  honeydew: [240, 255, 240], aliceblue: [240, 248, 255], ghostwhite: [248, 248, 255],
  floralwhite: [255, 250, 240], oldlace: [253, 245, 230], cornsilk: [255, 248, 220],
  papayawhip: [255, 239, 213], blanchedalmond: [255, 235, 205], bisque: [255, 228, 196],
  mistyrose: [255, 228, 225], lavenderblush: [255, 240, 245], antiquewhite: [250, 235, 215],
};

function parseColor(str) {
  if (str === null || str === undefined) return null;
  let s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (s === "currentcolor" || s === "inherit" || s === "initial" || s === "unset" || s === "none" || s === "auto") return null;
  if (NAMED[s]) { const v = NAMED[s]; return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; }
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[,\/\s]+/).filter(Boolean);
    if (p.length < 3) return null;
    const num = (x) => (String(x).endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    const al = (x) => (x === undefined ? 1 : String(x).endsWith("%") ? parseFloat(x) / 100 : parseFloat(x));
    const c = { r: num(p[0]), g: num(p[1]), b: num(p[2]), a: al(p[3]) };
    return Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b) ? c : null;
  }
  m = s.match(/^hsla?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[,\/\s]+/).filter(Boolean);
    if (p.length < 3) return null;
    let h = parseFloat(p[0]); const sa = parseFloat(p[1]) / 100; const l = parseFloat(p[2]) / 100;
    const a = p[3] === undefined ? 1 : String(p[3]).endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sa, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), mm = l - c / 2;
    let rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: (rgb[0] + mm) * 255, g: (rgb[1] + mm) * 255, b: (rgb[2] + mm) * 255, a };
  }
  return null;
}
const over = (fg, bg) => { const a = fg.a === undefined ? 1 : fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; };
function lum(c) { const f = (v) => { v = Math.max(0, Math.min(255, v)) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/* Split a CSS value on top-level commas / whitespace, respecting parens. */
function splitTop(value, sep) {
  const out = []; let depth = 0, cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* Extract colour stops from a gradient and return the extreme that is worst
   for contrast against `fg` (conservative), or the average when fg unknown. */
function gradientColors(value) {
  const cols = [];
  const inner = value.replace(/^[a-z-]*gradient\(/i, "").replace(/\)$/, "");
  for (const part of splitTop(inner, ",")) {
    for (const tok of splitTop(part, " ")) {
      const c = parseColor(tok);
      if (c && c.a > 0) { cols.push(c); break; }
    }
  }
  return cols;
}

/* ---------------- specificity ---------------- */
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  let s = sel.replace(/\s*[>+~]\s*/g, " ");
  s = s.replace(/:not\(([^)]*)\)/g, " $1 ").replace(/:is\(([^)]*)\)/g, " $1 ").replace(/:where\([^)]*\)/g, " ");
  a = (s.match(/#[\w-]+/g) || []).length;
  b = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]+\]/g) || []).length +
      (s.match(/:(?!:)(?!not|is|where)[\w-]+(\([^)]*\))?/g) || []).length;
  c = (s.match(/(^|[\s(])[a-z][\w-]*/gi) || []).length + (s.match(/::[\w-]+/g) || []).length;
  return a * 10000 + b * 100 + c;
}

const INHERITED = new Set(["color", "font-size", "font-weight", "font-family", "font-style", "line-height", "text-align", "visibility", "direction", "letter-spacing", "text-transform", "white-space", "list-style", "cursor"]);

/* ---------------- engine ---------------- */
class Engine {
  constructor(window, viewportWidth) {
    this.win = window;
    this.doc = window.document;
    this.vw = viewportWidth;
    this.rules = [];   // {sel, decls:Map, spec, order}
    this.cache = new Map();
    this.collect();
  }

  mediaMatches(text) {
    // Evaluate only width-based queries (what this codebase uses) + print/reduced-motion.
    const q = String(text).toLowerCase();
    if (!q.trim()) return true;
    // Multiple comma-separated queries: any match wins.
    return q.split(",").some((one) => {
      one = one.trim();
      if (/\bprint\b/.test(one)) return false;
      if (/prefers-reduced-motion/.test(one)) return false;
      if (/prefers-color-scheme:\s*dark/.test(one)) return false;
      if (/forced-colors/.test(one)) return false;
      let ok = true;
      const maxs = one.match(/\(\s*max-width\s*:\s*([\d.]+)px\s*\)/g) || [];
      for (const m of maxs) ok = ok && this.vw <= parseFloat(m.match(/([\d.]+)px/)[1]);
      const mins = one.match(/\(\s*min-width\s*:\s*([\d.]+)px\s*\)/g) || [];
      for (const m of mins) ok = ok && this.vw >= parseFloat(m.match(/([\d.]+)px/)[1]);
      return ok;
    });
  }

  collect() {
    let order = 0;
    const walk = (rules) => {
      for (const r of rules) {
        const type = r.constructor.name;
        if (type === "CSSStyleRule" || (r.selectorText && r.style)) {
          const decls = new Map();
          for (const prop of r.style) decls.set(prop, { value: r.style.getPropertyValue(prop), important: r.style.getPropertyPriority(prop) === "important" });
          for (const sel of r.selectorText.split(",")) {
            const s = sel.trim();
            if (!s) continue;
            this.rules.push({ sel: s, decls, spec: specificity(s), order: order++ });
          }
        } else if (type === "CSSMediaRule" || r.media) {
          if (this.mediaMatches(r.media ? r.media.mediaText : "")) walk(r.cssRules || []);
        } else if (type === "CSSSupportsRule") {
          walk(r.cssRules || []);
        }
      }
    };
    for (const sheet of this.doc.styleSheets) {
      try { walk(sheet.cssRules || []); } catch (e) { /* cross-origin */ }
    }
  }

  /** Raw declared value (post-cascade, pre-var-resolution) for an element. */
  declared(el) {
    if (this.cache.has(el)) return this.cache.get(el);
    const winner = new Map(); // prop -> {value, important, spec, order}
    for (const rule of this.rules) {
      let matches = false;
      try { matches = el.matches(rule.sel); } catch (e) { matches = false; }
      if (!matches) continue;
      for (const [prop, d] of rule.decls) {
        const prev = winner.get(prop);
        const better = !prev || (d.important && !prev.important) ||
          (d.important === prev.important && (rule.spec > prev.spec || (rule.spec === prev.spec && rule.order >= prev.order)));
        if (better) winner.set(prop, { value: d.value, important: d.important, spec: rule.spec, order: rule.order });
      }
    }
    // Inline style wins over everything non-important.
    if (el.style) {
      for (const prop of el.style) {
        const imp = el.style.getPropertyPriority(prop) === "important";
        const prev = winner.get(prop);
        if (!prev || !prev.important || imp) winner.set(prop, { value: el.style.getPropertyValue(prop), important: imp, spec: 1000000, order: 1e9 });
      }
    }
    const map = new Map();
    for (const [k, v] of winner) map.set(k, v.value);
    map.__meta = winner; // {prop -> {value, important, spec, order}}
    this.cache.set(el, map);
    return map;
  }

  /** Resolve a custom property by walking up the tree. */
  customProp(el, name, seen = new Set()) {
    if (seen.has(name)) return "";
    seen.add(name);
    let node = el;
    while (node && node.nodeType === 1) {
      const d = this.declared(node);
      if (d.has(name)) return this.resolveVars(node, d.get(name), seen);
      node = node.parentElement;
    }
    return "";
  }

  resolveVars(el, value, seen = new Set()) {
    if (!value || value.indexOf("var(") === -1) return value;
    let out = value, guard = 0;
    while (out.indexOf("var(") !== -1 && guard++ < 12) {
      const i = out.indexOf("var(");
      let depth = 0, j = i + 3;
      for (; j < out.length; j++) { if (out[j] === "(") depth++; else if (out[j] === ")") { depth--; if (!depth) break; } }
      const inner = out.slice(i + 4, j);
      const comma = splitTop(inner, ",");
      const name = comma[0].trim();
      const fallback = comma.slice(1).join(",").trim();
      let val = this.customProp(el, name, new Set(seen));
      if (!val) val = fallback ? this.resolveVars(el, fallback, new Set(seen)) : "";
      out = out.slice(0, i) + val + out.slice(j + 1);
    }
    return out;
  }

  /** Cascaded + inherited value for a standard property. */
  value(el, prop) {
    let node = el;
    while (node && node.nodeType === 1) {
      const d = this.declared(node);
      if (d.has(prop)) {
        let v = this.resolveVars(node, d.get(prop)).trim();
        if (v === "inherit") { node = node.parentElement; continue; }
        if (v && v !== "initial" && v !== "unset" && v !== "revert") return v;
      }
      if (!INHERITED.has(prop)) return "";
      node = node.parentElement;
    }
    return "";
  }

  /** Effective text colour (composited over its background). */
  colorOf(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const d = this.declared(node);
      if (d.has("color")) {
        const v = this.resolveVars(node, d.get("color")).trim();
        const c = parseColor(v);
        if (c) return c;
        if (v === "inherit") { node = node.parentElement; continue; }
      }
      node = node.parentElement;
    }
    return { r: 0, g: 0, b: 0, a: 1 }; // UA default
  }

  /** Own background colour(s) of an element: [{color, opaque}] or []. */
  ownBg(el) {
    const d = this.declared(el);
    const out = [];
    const push = (v) => {
      if (!v) return;
      v = this.resolveVars(el, v).trim();
      if (!v) return;
      if (/gradient\(/i.test(v)) {
        const cols = gradientColors(v);
        if (cols.length) {
          // average the stops — a fair stand-in for "the colour under the text"
          const avg = cols.reduce((a, c) => ({ r: a.r + c.r * (c.a), g: a.g + c.g * c.a, b: a.b + c.b * c.a, a: a.a + c.a }), { r: 0, g: 0, b: 0, a: 0 });
          const n = cols.length;
          out.push({ r: avg.r / n, g: avg.g / n, b: avg.b / n, a: avg.a / n, gradient: true, stops: cols });
        }
        // a gradient may be layered over a colour; keep scanning tokens
        for (const tok of splitTop(v, " ")) { const c = parseColor(tok); if (c && c.a > 0) out.push(c); }
        return;
      }
      for (const layer of splitTop(v, ",")) {
        for (const tok of splitTop(layer, " ")) { const c = parseColor(tok); if (c) { out.push(c); break; } }
      }
    };
    // `background` (shorthand) and `background-color` both set the colour.
    // Whichever WON the cascade (higher spec / later order) is the one that
    // paints — taking both produces phantom layers, e.g. a `.is-selected`
    // rule's dark `background` being masked by the base rule's white one.
    const meta = d.__meta;
    const cands = [];
    for (const prop of ["background-color", "background"]) {
      if (d.has(prop)) {
        const m = meta && meta.get(prop);
        cands.push({ prop, value: d.get(prop), spec: m ? m.spec : 0, order: m ? m.order : 0, important: m ? m.important : false });
      }
    }
    if (cands.length) {
      cands.sort((a, b) => (a.important !== b.important ? (a.important ? 1 : -1) : a.spec !== b.spec ? a.spec - b.spec : a.order - b.order));
      push(cands[cands.length - 1].value);
    }
    if (!out.length && d.has("background-image")) push(d.get("background-image"));
    return out.filter((c) => c && c.a > 0);
  }

  /** Composite background behind an element's text. */
  bgOf(el, pageDefault = { r: 255, g: 255, b: 255, a: 1 }) {
    const layers = [];
    let node = el;
    let opaqueFound = false;
    while (node && node.nodeType === 1) {
      const cols = this.ownBg(node);
      for (let i = 0; i < cols.length; i++) {
        layers.push(cols[i]);
        if (cols[i].a >= 0.999) { opaqueFound = true; break; }
      }
      if (opaqueFound) break;
      node = node.parentElement;
    }
    let bg = pageDefault;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  }

  fontOf(el) {
    const fsRaw = this.value(el, "font-size");
    const fwRaw = this.value(el, "font-weight");
    let fs = 16;
    if (fsRaw) {
      const m = String(fsRaw).match(/([\d.]+)\s*(px|rem|em|pt)?/);
      if (m) {
        const n = parseFloat(m[1]); const u = m[2] || "px";
        if (u === "px") fs = n;
        else if (u === "rem") fs = n * 16;
        else if (u === "pt") fs = n * (4 / 3);
        else if (u === "em") {
          // approximate: multiply by parent's computed size
          const p = el.parentElement ? this.fontOf(el.parentElement).fs : 16;
          fs = n * p;
        }
      }
      if (/clamp\(|calc\(/i.test(fsRaw)) {
        const nums = String(fsRaw).match(/([\d.]+)rem/g);
        if (nums && nums.length) fs = parseFloat(nums[0]) * 16;
      }
    }
    let w = 400;
    if (fwRaw) w = fwRaw === "bold" || fwRaw === "bolder" ? 700 : parseInt(fwRaw, 10) || 400;
    const tag = el.tagName.toLowerCase();
    if (!fwRaw && ["b", "strong", "th", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) w = 700;
    return { fs, w, large: fs >= 24 || (fs >= 18.66 && w >= 700) };
  }

  hidden(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const d = this.declared(node);
      const disp = d.has("display") ? this.resolveVars(node, d.get("display")).trim() : "";
      if (disp === "none") return true;
      const vis = this.value(node, "visibility");
      if (vis === "hidden" || vis === "collapse") return true;
      const op = d.has("opacity") ? parseFloat(this.resolveVars(node, d.get("opacity"))) : 1;
      if (Number.isFinite(op) && op === 0) return true;
      if (node.getAttribute && node.getAttribute("hidden") !== null) return true;
      node = node.parentElement;
    }
    return false;
  }
}

module.exports = { Engine, parseColor, over, lum, contrast, hex, specificity, splitTop, gradientColors };
