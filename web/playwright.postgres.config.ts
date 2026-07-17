import { defineConfig } from "@playwright/test";

process.env.E2E_EXPECT_HEALTH_READY_STATUS = "200";

export default defineConfig({
  testDir: "./e2e-backend",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8015",
    trace: "on-first-retry",
  },
  webServer: {
    command: "cd .. && PYTHONPATH=backend:tests python3 tests/e2e_postgres_server.py --port 8015",
    url: "http://127.0.0.1:8015/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
