// Headless screenshots for the look-at-it loop. Usage:
//   node scripts/shot.mjs <outDir> [--seed <evalProjectJson>] [--path /projects/<id>] [--tab "Design Studio"] [--width 1440] [--dark]
import { chromium } from "playwright-core";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = process.argv[2] ?? "/tmp/roomwise-shots";
const base = arg("--base", "http://127.0.0.1:3001");
const width = Number(arg("--width", "1440"));
const dark = process.argv.includes("--dark");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(base + "/", { waitUntil: "networkidle" });

let path = arg("--path", "/");
const seed = arg("--seed");
if (seed) {
  // Copy an eval project into the dev data dir, owned by this browser's anonymous id.
  const uid = (await ctx.cookies()).find((c) => c.name === "roomwise_uid").value;
  const p = JSON.parse(await readFile(seed, "utf8"));
  p.ownerId = uid;
  await writeFile(join(".data-us/projects", `${p.id}.json`), JSON.stringify(p));
  await cp(join(dirname(dirname(seed)), "files", p.id), join(".data-us/files", p.id), { recursive: true });
  await cp(join(dirname(dirname(seed)), "events", `${p.id}.jsonl`), join(".data-us/events", `${p.id}.jsonl`)).catch(() => {});
  path = `/projects/${p.id}`;
}
await page.goto(base + path, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const tabs = (arg("--tabs", "") || "").split(",").filter(Boolean);
const name = `${width}${dark ? "-dark" : ""}`;
if (!tabs.length) await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
for (const t of tabs) {
  await page.getByRole("tab", { name: t }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}-${t.replace(/\s+/g, "-").toLowerCase()}.png`), fullPage: true });
}
console.log(`${out} ${path}`);
await browser.close();
