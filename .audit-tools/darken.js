/* For each failing colour, find the nearest colour ON THE SAME HUE that meets
   the required ratio against its background. Only lightness moves, so the
   brand hue/character is preserved. */
const { parseColor, contrast, hex } = require("/tmp/audit/engine");

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function fromHsl({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (t[0] + m) * 255, g: (t[1] + m) * 255, b: (t[2] + m) * 255, a: 1 };
}

/** Nearest same-hue colour reaching `need` against `bg`. */
function fix(fgHex, bgHex, need) {
  const fg = parseColor(fgHex), bg = parseColor(bgHex);
  if (contrast(fg, bg) >= need) return { hex: hex(fg), changed: false, ratio: contrast(fg, bg) };
  const hsl = toHsl(fg);
  const bgL = toHsl(bg).l;
  // Move away from the background's lightness (darker on light bg, lighter on dark bg)
  const dir = bgL > 0.5 ? -1 : 1;
  let best = null;
  for (let step = 0; step <= 100; step++) {
    const l = Math.max(0, Math.min(1, hsl.l + dir * step / 100));
    const cand = fromHsl({ ...hsl, l });
    const r = contrast(cand, bg);
    if (r >= need) { best = { hex: hex(cand), ratio: r, l }; break; }
    if (l === 0 || l === 1) break;
  }
  if (!best) {
    // Hue alone cannot reach it — fall back to pure black/white.
    const bw = bgL > 0.5 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    best = { hex: hex(bw), ratio: contrast(bw, bg) };
  }
  return { ...best, changed: true, from: hex(fg), was: contrast(fg, bg) };
}

if (require.main === module) {
  const rows = JSON.parse(process.argv[2] || "[]");
  for (const [name, fg, bg, need] of rows) {
    const r = fix(fg, bg, need || 4.5);
    console.log(`${name.padEnd(36)} ${fg} -> ${r.hex}   (${(r.was || r.ratio).toFixed(2)} -> ${r.ratio.toFixed(2)}) need ${need || 4.5}`);
  }
}
module.exports = { fix, toHsl, fromHsl };
