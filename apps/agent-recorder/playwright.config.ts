import { defineConfig } from "@playwright/test"

/** `bun run e2e`: the built recorder and real Playwright MCP against the E2E server and its demo shop. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  webServer: {
    command: "bun ../api/scripts/e2e-server.ts",
    url: "http://127.0.0.1:3999/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_STATE_FILE: "e2e/.state.json" },
  },
})
