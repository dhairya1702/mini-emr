import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-backend",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8011",
    trace: "on-first-retry",
  },
  webServer: {
    command: "cd .. && PYTHONPATH=backend:tests python3 tests/e2e_backend_server.py --port 8011",
    url: "http://127.0.0.1:8011/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
