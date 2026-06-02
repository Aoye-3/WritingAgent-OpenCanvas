import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$env:FACETWRITE_APP_ROOT='.facetwrite-test/e2e'; npm.cmd run dev\"",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
