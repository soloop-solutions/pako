import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "offline.spec.ts",
  globalSetup: "./e2e/offline.global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: { trace: "on-first-retry", actionTimeout: 15_000 },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
          ...(process.env.PAKO_E2E_CHROMIUM ? { executablePath: process.env.PAKO_E2E_CHROMIUM } : {}),
        },
      },
    },
  ],
});
