// Drives the real UI end to end: new project → upload → brief → live designer run → answers.
// Usage: node scripts/ui-flow.mjs <photo> <outDir>
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const [photo, out = "/tmp/roomwise-flow"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:3001";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const shot = (n) => page.screenshot({ path: join(out, `${n}.png`) });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const resume = process.argv.indexOf("--resume") > 0 ? process.argv[process.argv.indexOf("--resume") + 1] : null;
if (resume) {
  await page.context().addCookies([{ name: "roomwise_uid", value: process.argv[process.argv.indexOf("--uid") + 1], url: base }]);
  await page.goto(resume, { waitUntil: "networkidle" });
} else {
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start a bedroom project" }).click();
await page.waitForURL(/\/projects\//);
await page.waitForLoadState("networkidle");
await shot("01-empty-project");
await page.setInputFiles('input[type="file"]', photo);
await page.getByRole("heading", { name: "Tell Roomwise what you want" }).waitFor();
log("uploaded");
await page.getByRole("button", { name: "Cozy", exact: true }).click();
await page.getByLabel("How should it feel?").fill("Cozy, beige or lighter colours, and I want blankets too.");
await page.getByLabel("Budget (USD)").fill("450");
await page.getByLabel("Colours you like").fill("beige, cream");
await page.getByRole("button", { name: "Blankets" }).click();
await page.getByLabel("Keeping").fill("black metal bed frame, arched mirror");
await shot("02-brief");
await page.getByRole("button", { name: "Start designing" }).click();
log("started");
}

let answered = 0;
let midShot = false;
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(3000);
  const status = await page.locator("header:visible").first().innerText();
  if (!midShot && /working/i.test(status) && i > 3) {
    await shot("03-working");
    midShot = true;
  }
  const waiting = await page.getByText(/Quick question|Your call|Needs your OK/).isVisible().catch(() => false);
  if (waiting && answered < 4) {
    await shot(`04-question-${answered + 1}`);
    const card = page.locator("div", { has: page.getByText(/Quick question|Your call|Needs your OK/) }).last();
    const q = await page.locator("textarea#designer-input").isEnabled();
    const opts = card.getByRole("button");
    const n = await opts.count();
    if (n > 0) {
      log(`answering: ${await opts.first().innerText()}`);
      await opts.first().click();
    } else if (q) {
      await page.fill("textarea#designer-input", "Full/double bed. Use your best judgement.");
      await page.keyboard.press("Enter");
    }
    answered++;
    continue;
  }
  if (/Plan complete|steps done/.test(status) && !/working/i.test(status) && !waiting && i > 5) {
    log(`finished: ${status.replace(/\s+/g, " ")}`);
    break;
  }
}
await shot("05-done");
for (const t of ["Design Studio", "Shopping List", "Plan"]) {
  await page.getByRole("tab", { name: t }).click();
  await page.waitForTimeout(800);
  await shot(`06-${t.replace(/\s+/g, "-").toLowerCase()}`);
}
console.log(page.url());
await browser.close();
