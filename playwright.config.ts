import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "3100";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "17779";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:FACETWRITE_APP_ROOT='.facetwrite-test/e2e'; $env:VITE_PORT='${frontendPort}'; $env:PORT='${apiPort}'; npm.cmd run dev:services"`,
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
