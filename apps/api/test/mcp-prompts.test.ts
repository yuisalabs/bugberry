import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createUserWithToken, setupTestApp } from "./helpers"
import { mcpClient } from "./mcp-helpers"

let client: Client

beforeEach(async () => {
  const ctx = await setupTestApp()
  client = await mcpClient(ctx.app, (await createUserWithToken(ctx.db)).headers)
})

const textOf = (result: Awaited<ReturnType<Client["getPrompt"]>>) =>
  result.messages.map((message) => (message.content.type === "text" ? message.content.text : "")).join("\n")

describe("prompts", () => {
  test("lists the three prompts", async () => {
    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["debug-report", "summarize-report", "triage-reports"])
  })

  test("debug-report walks the agent through the tools for the given report", async () => {
    const text = textOf(await client.getPrompt({ name: "debug-report", arguments: { report: "BB-1" } }))
    for (const part of ["BB-1", "getReport", "getTimeline", "getCodeHotspots", "failedOnly", "addComment"]) expect(text).toContain(part)
  })

  test("triage-reports changes nothing without a yes", async () => {
    const text = textOf(await client.getPrompt({ name: "triage-reports", arguments: { project: "shop" } }))
    expect(text).toContain('searchReports status=["open"]')
    expect(text).toContain("shop")
    expect(text).toContain("Do not change anything")
  })

  test("summarize-report is for people who don't code", async () => {
    const text = textOf(await client.getPrompt({ name: "summarize-report", arguments: { report: "BB-2" } }))
    expect(text).toContain("BB-2")
    expect(text).toContain("non-developer")
  })
})
