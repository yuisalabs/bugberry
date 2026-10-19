import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { McpToolError, runTool } from "../src/mcp/context"

afterEach(() => {
  mock.restore()
})

describe("runTool", () => {
  test("our own errors are the answer", async () => {
    const result = await runTool(async () => {
      throw new McpToolError("report_not_found", "Report not found")
    })
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "Report not found" }] })
  })

  test("anything else is logged and hidden from the agent", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    const result = await runTool(async () => {
      throw new Error('Failed query: select "token_hash" from "api_token" params: secret')
    })
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "Something went wrong. Try again." }] })
    expect(logged).toHaveBeenCalled()
    expect(String(logged.mock.calls[0]?.[0])).toContain("MCP tool failed")
  })
})
