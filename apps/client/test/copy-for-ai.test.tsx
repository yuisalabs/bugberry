import { afterEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CopyForAiButton, copyForAiText } from "../src/components/report/CopyForAiButton"

afterEach(() => {
  mock.restore()
})

describe("Copy for AI", () => {
  test("the text points the agent at this report", () => {
    expect(copyForAiText("https://bugberry.kantor.test", "r1")).toBe(
      "Use the BugBerry MCP server to debug this report: https://bugberry.kantor.test/app/r/r1",
    )
  })

  test("copies the text and links to the setup page", async () => {
    const writeText = mock(async () => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    render(<CopyForAiButton reportId="r1" origin="https://bugberry.kantor.test" />)
    fireEvent.click(screen.getByRole("button", { name: "Copy for AI" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Use the BugBerry MCP server to debug this report: https://bugberry.kantor.test/app/r/r1"))
    expect(screen.getByRole("link", { name: "Set up" }).getAttribute("href")).toBe("/app/settings/ai")
  })
})
