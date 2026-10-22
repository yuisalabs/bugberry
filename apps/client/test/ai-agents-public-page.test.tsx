import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { AiAgentsView } from "../src/pages/landing/AiAgentsView"
import { MCP_GUIDE } from "../src/pages/landing/site-links"

const ORIGIN = "https://bugberry.yuisalabs.com"
const text = () => document.body.textContent ?? ""

describe("AiAgentsView", () => {
  test("pitches agents that watched the bug, with a way to connect one", () => {
    render(<AiAgentsView signedIn={false} installUrl={null} origin={ORIGIN} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your AI agent can fix the bug it watched happen")
    expect(screen.getAllByRole("link", { name: "Connect an agent" })[0]?.getAttribute("href")).toBe("/login")
    expect(screen.getByRole("link", { name: /Read the MCP docs/ }).getAttribute("href")).toBe(MCP_GUIDE)
  })

  test("a signed-in visitor connects from their AI settings", () => {
    render(<AiAgentsView signedIn installUrl={null} origin={ORIGIN} />)
    expect(screen.getAllByRole("link", { name: "Connect an agent" })[0]?.getAttribute("href")).toBe("/app/settings/ai")
  })

  test("the MCP address and the command use this server, never a development address", () => {
    render(<AiAgentsView signedIn={false} installUrl={null} origin={ORIGIN} />)
    expect(text()).toContain(`${ORIGIN}/api/mcp`)
    expect(text()).toContain(`claude mcp add --transport http bugberry ${ORIGIN}/api/mcp`)
    expect(text()).not.toContain("localhost:5173")
  })

  test("names the six clients the MCP guide covers", () => {
    render(<AiAgentsView signedIn={false} installUrl={null} origin={ORIGIN} />)
    const works = screen.getByRole("list", { name: "Works with" })
    expect([...works.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Claude Code", "Claude.ai", "Cursor", "VS Code", "Windsurf", "ChatGPT"])
  })

  test("describes masking only as far as it goes", () => {
    render(<AiAgentsView signedIn={false} installUrl={null} origin={ORIGIN} />)
    for (const overclaim of ["card numbers", "masked before anything leaves the browser", "15-min", "up to 5 reporters"]) expect(text()).not.toContain(overclaim)
    expect(text()).toContain("Update status & priority")
  })
})
