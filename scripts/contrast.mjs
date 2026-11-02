// Contrast check for tokens.css (OKLCH -> sRGB, clipped like browsers do).
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/app/tokens.css", import.meta.url), "utf8");
const block = (sel) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
const vars = (src) => Object.fromEntries([...src.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = vars(block(":root {"));
const dark = { ...light, ...vars(block('[data-theme="dark"]')) };
function resolve(v, t, d = 0) {
  if (d > 10) throw new Error(v);
  return v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(t[n], t, d + 1));
}
function oklchToRgb(str) {
  const [L, C, H] = str.match(/oklch\(([^)]+)\)/)[1].split("/")[0].trim().split(/\s+/).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((x) => Math.min(1, Math.max(0, x)));
}
const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; // already linear
const ratio = (x, y, t) => { const [a, b] = [lum(oklchToRgb(resolve(t[x], t))), lum(oklchToRgb(resolve(t[y], t)))].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
const PAIRS = [["--text","--surface",4.5],["--text-muted","--surface",4.5],["--text-subtle","--surface",3],["--text-muted","--surface-sunken",4.5],["--accent-text","--surface",4.5],["--text-on-accent","--accent",4.5],["--border-interactive","--surface",3],["--border-focus","--surface",3],["--danger-text","--danger-bg",4.5],["--success-text","--success-bg",4.5],["--warning-text","--warning-bg",4.5]];
let fail = 0;
for (const [name, t] of [["light", light], ["dark", dark]]) for (const [x, y, min] of PAIRS) {
  const r = ratio(x, y, t); const ok = r >= min; if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${x} on ${y}: ${r.toFixed(2)} (min ${min})`);
}
process.exit(fail ? 1 : 0);
