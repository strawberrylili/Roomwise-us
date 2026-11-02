import { defineConfig } from "@playwright/test";

// Browser e2e against a dev server in mock mode: no OpenAI or IKEA calls, isolated data dir.
const PORT = 3002;

export default defineConfig({
  testDir: "tests-e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", headless: true, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: {
    command: `rm -rf .data-e2e && next dev -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ROOMWISE_MOCK: "1", ROOMWISE_DATA_DIR: ".data-e2e", NEXT_DIST_DIR: ".next-e2e" },
  },
});
