import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-live",
  testIgnore: /mobile-live\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3117",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "cd .. && PYTHONPATH=backend:tests python3 tests/e2e_backend_server.py --port 8012",
      url: "http://127.0.0.1:8012/health/live",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8012 npm run dev -- --hostname 127.0.0.1 --port 3117",
      url: "http://127.0.0.1:3117",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
