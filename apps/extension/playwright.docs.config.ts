import { defineConfig } from "@playwright/test"

/** `bun run docs:screenshots`: photographs the extension and dashboard for the user guide. Not a test suite. */
export default defineConfig({
  testDir: "./docs-shots",
  testMatch: "*.shots.ts",
  timeout: 180_000,
  workers: 1,
  reporter: "list",
  webServer: {
    command: "bun ../api/scripts/e2e-server.ts",
    url: "http://127.0.0.1:3999/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_STATE_FILE: "docs-shots/.state.json", E2E_USER_NAME: "Alex Morgan" },
  },
})
