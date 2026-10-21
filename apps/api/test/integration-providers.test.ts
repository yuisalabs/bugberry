import { beforeEach, describe, expect, test } from "bun:test"
import { INTEGRATION_PROVIDERS, integrationKind, integrationLabel, issueReference, PROVIDER_LABELS } from "@bugberry/shared"
import { eq } from "drizzle-orm"
import { integration } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { createProject, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

describe("integration providers", () => {
  test("every provider has a kind and a label", () => {
    expect(integrationKind("linear")).toBe("tracker")
    expect(integrationKind("gitlab")).toBe("tracker")
    expect(integrationKind("jira")).toBe("tracker")
    expect(integrationKind("slack")).toBe("notifier")
    expect(integrationKind("webhook")).toBe("notifier")
    for (const provider of INTEGRATION_PROVIDERS) expect(PROVIDER_LABELS[provider].length).toBeGreaterThan(0)
    expect(integrationLabel("webhook", { url: "https://hooks.kantor.test/bugs" })).toBe("hooks.kantor.test")
    expect(integrationLabel("gitlab", { baseUrl: "https://gitlab.com", projectPath: "kantor/web", labels: [] })).toBe("kantor/web")
    expect(integrationLabel("linear", { teamKey: "ENG", labels: [] })).toBe("Team ENG")
    expect(integrationLabel("telegram", { chatId: "-1001234" })).toBe("Chat -1001234")
  })

  test("issues are referred to the way each tracker does", () => {
    expect(issueReference("gitlab", "42")).toBe("#42")
    expect(issueReference("github", "7")).toBe("#7")
    expect(issueReference("linear", "ENG-142")).toBe("ENG-142")
    expect(issueReference("jira", "BUG-12")).toBe("BUG-12")
  })

  test("a notifier is stored like any integration, with room for its last delivery", async () => {
    const project = await createProject(ctx.db)
    const id = newId()
    await ctx.db.insert(integration).values({ id, projectId: project.id, provider: "slack", config: {}, secretEncrypted: "sealed" })
    const [row] = await ctx.db.select().from(integration).where(eq(integration.id, id))
    expect(row).toMatchObject({ provider: "slack", lastError: null, lastDeliveredAt: null })
  })
})
