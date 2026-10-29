import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../src", import.meta.url))

const DRIZZLE_VALUE_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+"drizzle-orm(\/[^"]*)?"/m
const TRANSACTION = /\.transaction\s*\(/
const QUERY_WITHOUT_EXECUTOR = /\b(db|tx)\s*\.\s*(select|selectDistinct|insert|update|delete|execute|transaction)\s*\(/
const EXECUTOR_CALL = /\bexecutor\s*\(/

const isRepository = (path: string) => /^modules\/[^/]+\/repository\.ts$/.test(path)
const mayImportDrizzle = (path: string) =>
  path.startsWith("db/") || path.startsWith("admin/") || isRepository(path) || path === "modules/auth/better-auth.ts"
const mayOpenTransaction = (path: string) =>
  path === "db/client.ts" || path.startsWith("admin/") || path === "modules/auth/better-auth.ts"

/** Files that still query outside a repository; each repository task removes its own. Empty when the refactor is done. */
const PENDING = new Set<string>([
  "jobs/cleanup.ts",
  "mcp/oauth.ts",
  "mcp/refs.ts",
  "mcp/route.ts",
  "mcp/tools/browse.ts",
  "mcp/tools/report-read.ts",
  "mcp/tools/upload.ts",
  "mcp/tools/write.ts",
  "modules/activity/backfill.ts",
  "modules/activity/service.ts",
  "modules/ai/index.ts",
  "modules/ai/setup.ts",
  "modules/comments/mentions.ts",
  "modules/comments/reactions.ts",
  "modules/comments/replies.ts",
  "modules/comments/service.ts",
  "modules/connections/index.ts",
  "modules/demo-requests/index.ts",
  "modules/integrations/index.ts",
  "modules/integrations/resolve.ts",
  "modules/invitations/index.ts",
  "modules/join/index.ts",
  "modules/notifications/service.ts",
  "modules/notifiers/deliver.ts",
  "modules/onboarding/progress.ts",
  "modules/projects/index.ts",
  "modules/projects/logo.ts",
  "modules/reports/agent-uploads.ts",
  "modules/reports/detail.ts",
  "modules/reports/index.ts",
  "modules/reports/numbers.ts",
  "modules/reports/service.ts",
  "modules/reports/upload-flow.ts",
  "modules/reports/uploads.ts",
  "modules/share/index.ts",
  "modules/trackers/dispatch.ts",
  "modules/trackers/index.ts",
  "modules/workspaces/access.ts",
  "modules/workspaces/index.ts",
  "modules/workspaces/limits.ts",
  "modules/workspaces/logo.ts",
  "modules/workspaces/provision.ts",
  "modules/workspaces/slug.ts",
])

async function violators(): Promise<string[]> {
  const found: string[] = []
  for (const path of new Bun.Glob("**/*.ts").scanSync(SRC)) {
    const file = path.replaceAll("\\", "/")
    const text = await Bun.file(`${SRC}/${file}`).text()
    const broken =
      (!mayImportDrizzle(file) && DRIZZLE_VALUE_IMPORT.test(text)) ||
      (!mayOpenTransaction(file) && TRANSACTION.test(text)) ||
      (isRepository(file) && QUERY_WITHOUT_EXECUTOR.test(text)) ||
      // A query needs no Drizzle import when it uses no operators, so the calls themselves are checked too.
      (!mayImportDrizzle(file) && (QUERY_WITHOUT_EXECUTOR.test(text) || EXECUTOR_CALL.test(text)))
    if (broken) found.push(file)
  }
  return found.sort()
}

describe("structure", () => {
  test("Drizzle is used only where the structure allows it", async () => {
    expect((await violators()).filter((path) => !PENDING.has(path))).toEqual([])
  })

  test("PENDING lists only files that still break the rules", async () => {
    const found = await violators()
    expect([...PENDING].filter((path) => !found.includes(path))).toEqual([])
  })
})
