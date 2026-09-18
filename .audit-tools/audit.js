/* Drives real pages from the dev server through jsdom and reports WCAG
   contrast failures for text, icons and buttons — at desktop AND mobile. */
const { JSDOM, VirtualConsole } = require("jsdom");
const { Engine, parseColor, over, contrast, hex } = require("./engine");

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(urlPath, { cookie, width = 1280 } = {}) {
  const jar = { value: cookie || "" };
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const res = await fetch(BASE + urlPath, { headers: jar.value ? { cookie: jar.value } : {} });
  const html = await res.text();
  const dom = new JSDOM(html, {
    url: BASE + urlPath,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: width < 700 ? 844 : 900, configurable: true });
      window.matchMedia = (q) => {
        const s = String(q).toLowerCase();
        let ok = true;
        for (const m of s.match(/\(\s*max-width\s*:\s*([\d.]+)px\s*\)/g) || []) ok = ok && width <= parseFloat(m.match(/([\d.]+)px/)[1]);
        for (const m of s.match(/\(\s*min-width\s*:\s*([\d.]+)px\s*\)/g) || []) ok = ok && width >= parseFloat(m.match(/([\d.]+)px/)[1]);
        if (/prefers-reduced-motion|prefers-color-scheme:\s*dark|print/.test(s)) ok = false;
        return { matches: ok, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      };
      window.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { try { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this); } catch (e) {} } unobserve() {} disconnect() {} takeRecords() { return []; } };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.fetch = async (input, init = {}) => {
        const abs = new URL(String(input), BASE).href;
        const headers = Object.assign({}, init.headers || {}, jar.value ? { cookie: jar.value } : {});
        const r = await fetch(abs, Object.assign({}, init, { headers }));
        const sc = r.headers.get("set-cookie");
        if (sc) jar.value = sc.split(";")[0];
        return r;
      };
    },
  });
  await sleep(2200);
  return { dom, jar, doc: dom.window.document, win: dom.window, width, close() { try { dom.window.close(); } catch (e) {} } };
}

function ownText(el) {
  let t = "";
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
  return t.replace(/\s+/g, " ").trim();
}
function selectorFor(el) {
  const id = el.id ? "#" + el.id : "";
  const cls = ((el.getAttribute && el.getAttribute("class")) || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).map((c) => "." + c).join("");
  return el.tagName.toLowerCase() + id + cls;
}
function ancestry(el) {
  const out = [];
  let n = el.parentElement, i = 0;
  while (n && n.tagName.toLowerCase() !== "body" && i++ < 4) { out.unshift(selectorFor(n)); n = n.parentElement; }
  return out.join(" > ");
}

const SKIP_TAGS = new Set(["script", "style", "noscript", "head", "meta", "link", "title", "br", "hr", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g", "defs", "use", "stop", "lineargradient", "radialgradient", "clippath", "mask", "text", "tspan", "option"]);

function auditDoc(doc, win, label, width) {
  const eng = new Engine(win, width);
  const out = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll("body *")) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (el.closest && el.closest("svg")) continue;
    if (eng.hidden(el)) continue;

    const text = ownText(el);
    const directSvg = el.querySelector ? el.querySelector(":scope > svg") : null;
    const isSvg = tag === "svg";
    const isIconish = isSvg || (!text && !!directSvg);
    // input/textarea/select: their value text uses `color`
    const isField = ["input", "textarea", "select"].includes(tag);
    if (!text && !isIconish && !isField) continue;
    if (isField && ["hidden", "checkbox", "radio", "range", "file", "color"].includes((el.getAttribute("type") || "").toLowerCase())) continue;

    const fgRaw = eng.colorOf(el);
    // `color: transparent` is a deliberate "hidden until selected" state
    // (unchecked tick marks), not a contrast defect.
    if ((fgRaw.a ?? 1) === 0) continue;
    const bg = eng.bgOf(el);
    const fg = over(fgRaw, bg);
    const r = contrast(fg, bg);
    const { fs, w, large } = eng.fontOf(el);
    const need = isIconish ? 3 : large ? 3 : 4.5;
    if (r + 0.01 >= need) continue;

    const key = `${selectorFor(el)}|${hex(fgRaw)}|${hex(bg)}|${text.slice(0, 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      page: label, width, sel: selectorFor(el), parent: ancestry(el),
      text: text.slice(0, 64) || (isIconish ? "«icon»" : "«field»"),
      fg: hex(fgRaw), fgAlpha: +(fgRaw.a ?? 1).toFixed(2), bg: hex(bg),
      ratio: +r.toFixed(2), need, fontPx: +fs.toFixed(1), weight: w,
    });
  }
  return out;
}

async function auditPage(label, urlPath, { cookie, width = 1280, before, wait = 1500 } = {}) {
  const page = await open(urlPath, { cookie, width });
  if (before) { try { await before(page); } catch (e) { console.error(`  [${label}] before() error: ${e.message}`); } await sleep(wait); }
  const r = auditDoc(page.doc, page.win, label, width);
  page.close();
  return r;
}

module.exports = { open, auditPage, auditDoc, sleep, BASE };
