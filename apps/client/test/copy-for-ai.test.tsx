import { describe, expect, test } from "bun:test"
import { copyForAiText } from "../src/lib/more-menu"

describe("Copy for AI", () => {
  test("the text points the agent at this report", () => {
    expect(copyForAiText("https://bugberry.kantor.test", "r1")).toBe(
      "Use the BugBerry MCP server to debug this report: https://bugberry.kantor.test/app/r/r1",
    )
  })
})
