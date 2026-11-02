/**
 * Browser end-to-end tests of the studio, against a dev server with ROOMWISE_MOCK=1
 * (see playwright.config.ts). Everything is real except OpenAI and IKEA.
 */
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function roomPhoto() {
  const buffer = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#d9d4cc" } }).jpeg().toBuffer();
  return { name: "bedroom.jpg", mimeType: "image/jpeg", buffer };
}

const designer = (page: Page) => page.getByRole("complementary", { name: "AI Designer" });
const status = (page: Page) => page.getByRole("banner");

async function createProjectWithBrief(page: Page, space = "Bedroom") {
  await page.goto("/");
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "Start a project" }).click();
  await page.waitForURL(/\/projects\/prj_/);
  await page.locator('input[type="file"]').setInputFiles(await roomPhoto());
  await expect(page.getByRole("heading", { name: "Tell Roomwise what you want" })).toBeVisible();

  // Validation: submitting empty shows errors instead of starting.
  await page.getByRole("button", { name: "Start designing" }).click();
  await expect(page.getByText("Pick a style or describe the feeling you want.")).toBeVisible();

  await page.getByRole("radio", { name: space, exact: true }).click();
  await page.getByRole("radio", { name: /Redesign/ }).click();
  await page.getByRole("button", { name: "Cozy", exact: true }).click();
  await page.getByLabel("How should it feel?").fill("Cozy, beige, lots of blankets.");
  await page.getByText("No budget limit — design for the best result").click();
  await page.getByRole("button", { name: "Blankets" }).click();
  await page.getByRole("button", { name: "Start designing" }).click();
}

test("full journey: photo → brief → questions → concept → plan → revision → persistence", async ({ page }) => {
  await createProjectWithBrief(page);

  // The designer asks about the uncertain observation.
  await expect(designer(page).getByText("Quick question")).toBeVisible();
  await expect(status(page).getByText("Waiting for you")).toBeVisible();
  await designer(page).getByRole("button", { name: "Just a ledge" }).click();

  // Then offers the concepts.
  await expect(designer(page).getByText("Your call")).toBeVisible();
  await designer(page).getByRole("button", { name: "Window Cocoon" }).click();
  await expect(status(page).getByText("Plan complete")).toBeVisible();
  await expect(designer(page).getByText(/Window Cocoon plan is ready/)).toBeVisible();

  // Design Studio: inspiration first, with the design review; real-products render on the toggle.
  await page.getByRole("tab", { name: "Design Studio" }).click();
  await expect(page.getByRole("img", { name: "Redesigned room" })).toBeVisible();
  await expect(page.getByText("the design at full ambition")).toBeVisible();
  await expect(page.getByText("Design", { exact: true })).toBeVisible();

  // Before/after slider: "Before" end shows the original photo, "After" end the redesign.
  const slider = page.getByLabel("Compare before and after");
  const original = page.locator('img[alt="Original room"]');
  const visibleWidth = () => original.evaluate((el) => {
    const m = getComputedStyle(el).clipPath.match(/inset\(\S+ ([\d.]+)%/);
    return 100 - Number(m?.[1] ?? 0);
  });
  await expect(slider).toHaveValue("100");
  expect(await visibleWidth()).toBe(0);
  await slider.fill("0");
  expect(await visibleWidth()).toBe(100);
  await slider.fill("30");
  expect(await visibleWidth()).toBe(70);
  await expect(page.getByText("Before", { exact: true }).first()).toBeVisible();
  await page.getByRole("radio", { name: "With real products" }).click();
  await expect(page.getByText(/· \d+ real products$/)).toBeVisible();
  await expect(page.getByText("Products", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Window Cocoon — Rotated Japandi Sleep Platform" })).toBeVisible();

  // Shopping list: no budget limit, real-looking links.
  await page.getByRole("tab", { name: "Shopping List" }).click();
  await expect(page.getByText("No budget limit")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^\d+ items$/ })).toBeVisible();
  const firstLink = page.getByRole("link", { name: /at IKEA/ }).first();
  await expect(firstLink).toHaveAttribute("href", /^https:\/\/www\.ikea\.com\/us\/en\/p\//);
  await expect(firstLink).toHaveAttribute("target", "_blank");

  // Plan: tick a task, reload, still ticked.
  await page.getByRole("tab", { name: "Plan" }).click();
  const task = page.getByRole("checkbox").first();
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/tasks\//.test(r.url()) && r.ok());
  await task.click();
  await expect(task).toBeChecked();
  await saved;
  await page.reload();
  await page.getByRole("tab", { name: "Plan" }).click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByText(/^1 of \d+ done$/)).toBeVisible();

  // Revision through the chat: a tweak re-renders the inspiration only.
  await designer(page).getByLabel("Message the designer").fill("Can you make the bed more layered?");
  await designer(page).getByLabel("Message the designer").press("Enter");
  await expect(status(page).getByText("Designer is working")).toBeVisible();
  await expect(status(page).getByText("Plan complete")).toBeVisible();
  await page.getByRole("tab", { name: "Design Studio" }).click();
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText(/Revision · v2/)).toBeVisible();

  // Activity is inspectable: the steps behind a reply.
  await designer(page).getByRole("button", { name: /\d+ steps/ }).last().click();
  await expect(designer(page).getByText("Rendering your new room").last()).toBeVisible();

  // Home lists the project with its state.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /My room/ })).toContainText("Plan ready");
});

test("projects and files are private to the browser that created them", async ({ page, browser }) => {
  await createProjectWithBrief(page);
  await expect(designer(page).getByText("Quick question")).toBeVisible();
  const url = page.url();
  const photoSrc = await page.getByRole("img", { name: "Room photo" }).getAttribute("src");

  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await other.goto(url);
  await expect(other.getByText("This project doesn't exist or isn't yours.")).toBeVisible();
  const file = await other.request.get(new URL(photoSrc!, url).toString());
  expect(file.status()).toBe(404);
  await stranger.close();
});

test("unknown project shows a recoverable error", async ({ page }) => {
  await page.goto("/projects/prj_doesnotexist");
  await expect(page.getByText("This project doesn't exist or isn't yours.")).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL("/");
});

test("narrow screens: the designer opens as a drawer and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start a project" }).click();
  await page.waitForURL(/\/projects\//);
  await page.getByRole("button", { name: "Open designer chat" }).click();
  const drawer = page.getByRole("dialog", { name: "AI Designer" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("open living + dining: Roomwise asks what the space should do and plans both zones", async ({ page }) => {
  await createProjectWithBrief(page, "Let Roomwise work it out");
  await expect(designer(page).getByText("Quick question")).toBeVisible();
  await expect(designer(page).getByText(/What should this space do after the makeover/)).toBeVisible();
  await page.screenshot({ path: "/tmp/roomwise-shots/e2e-space-question.png" });
  await designer(page).getByRole("button", { name: "Living + dining" }).click();
  await expect(designer(page).getByText("Your call")).toBeVisible();
  await designer(page).getByRole("button").filter({ hasText: /Cocoon|Ryokan|Engawa|Haven|Dune/ }).first().click();
  await expect(status(page).getByText("Plan complete")).toBeVisible();

  await page.getByRole("tab", { name: "Workspace" }).click();
  await expect(page.getByText("Living + dining · Relax, Dine")).toBeVisible();
  await page.getByRole("tab", { name: "Shopping List" }).click();
  await expect(page.getByText("Dining table", { exact: true })).toBeVisible();
  await expect(page.getByText("Sofa", { exact: true })).toBeVisible();
  // The brief asked for blankets; the validator rejected the first list until a throw was added.
  await expect(page.getByText("Throws", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/roomwise-shots/e2e-living-dining-shopping.png", fullPage: true });
});

test("autopilot: switching it on mid-question lets the designer finish on its own", async ({ page }) => {
  await createProjectWithBrief(page, "Let Roomwise work it out");
  await expect(designer(page).getByText("Quick question")).toBeVisible();
  const toggle = designer(page).getByRole("switch", { name: "Autopilot" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(status(page).getByText("Plan complete")).toBeVisible();
  await expect(designer(page).getByText("Your call")).toHaveCount(0);
  await expect(designer(page).getByText(/Assumptions I made:/)).toBeVisible();
  await page.getByRole("tab", { name: "Workspace" }).click();
  await expect(page.getByText("Living + dining", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "/tmp/roomwise-shots/e2e-autopilot.png" });
  // The mode is saved with the project.
  await page.reload();
  await expect(designer(page).getByRole("switch", { name: "Autopilot" })).toHaveAttribute("aria-checked", "true");
});

test("the API rejects fields it doesn't know instead of silently dropping them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a project" }).click();
  await page.waitForURL(/\/projects\//);
  const id = page.url().split("/projects/")[1];
  const res = await page.request.patch(`/api/projects/${id}`, { data: { name: "Renamed", someFutureField: true } });
  expect(res.status()).toBe(400);
  const ok = await page.request.patch(`/api/projects/${id}`, { data: { name: "Renamed" } });
  expect(ok.status()).toBe(200);
});
