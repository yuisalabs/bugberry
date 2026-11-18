import { describe, expect, test } from "bun:test"
import { createUserWithToken, setupTestApp } from "./helpers"
import { mcpClient } from "./mcp-helpers"

const READ = [
  "getReport",
  "getTimeline",
  "getConsoleLogs",
  "getNetworkRequests",
  "getNetworkRequest",
  "getUserActions",
  "getReproductionScript",
  "getFrustrationSignals",
  "getPerformance",
  "getCodeHotspots",
  "getScreenshot",
  "getRecording",
  "getComments",
  "searchReports",
  "listWorkspaces",
  "listProjects",
  "listMembers",
  "listLabels",
  "getNotifications",
  "search",
  "fetch",
  "listTrackers",
]
const WRITE = ["addComment", "editComment", "deleteComment", "updateReport", "resolveReport", "markNotificationsRead", "sendToTracker", "createUpload"]

describe("MCP tool catalogue", () => {
  test("every tool has a title, description and the right annotations", async () => {
    const ctx = await setupTestApp()
    const client = await mcpClient(ctx.app, (await createUserWithToken(ctx.db)).headers)
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ, ...WRITE].sort())
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect((tool.description ?? "").length, tool.name).toBeGreaterThan(30)
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(READ.includes(tool.name))
      expect(tool.annotations?.destructiveHint === true, tool.name).toBe(tool.name === "deleteComment")
    }
    expect(tools.filter((tool) => /delete/i.test(tool.name)).map((tool) => tool.name)).toEqual(["deleteComment"])
  })

  test("updateReport and createUpload tell the agent the description is Markdown", async () => {
    const ctx = await setupTestApp()
    const client = await mcpClient(ctx.app, (await createUserWithToken(ctx.db)).headers)
    const { tools } = await client.listTools()

    for (const name of ["updateReport", "createUpload"]) {
      const tool = tools.find((candidate) => candidate.name === name)
      const description = tool?.inputSchema.properties?.description as { description?: string } | undefined
      expect(description?.description, name).toContain("Markdown")
    }
  })
})
