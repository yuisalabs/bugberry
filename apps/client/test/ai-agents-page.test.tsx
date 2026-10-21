import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { AGENT_PROMPT, AiAgentsView, connectSnippets, reportLinkForms } from "../src/pages/settings/AiAgentsPage"

const ORIGIN = "https://bugberry.kantor.test"
const base = {
  origin: ORIGIN,
  tokens: [{ id: "t1", label: "CI bot", createdAt: new Date("2026-10-01T00:00:00Z"), lastUsedAt: null }],
  apps: [
    {
      clientId: "c1",
      name: "Claude Code",
      uri: null,
      scopes: ["bugberry:read", "bugberry:write"],
      grantedAt: new Date("2026-10-02T00:00:00Z"),
      lastUsedAt: new Date("2026-10-03T00:00:00Z"),
    },
  ],
  newToken: null,
  busy: false,
  error: null,
  onCreateToken: mock(),
  onRevokeToken: mock(),
  onRevokeApp: mock(),
  onDismissToken: mock(),
}

afterEach(() => {
  mock.restore()
})

describe("connectSnippets", () => {
  test("every client gets its exact setup with the server URL", () => {
    const snippets = Object.fromEntries(connectSnippets(`${ORIGIN}/api/mcp`).map((item) => [item.id, item.code]))
    expect(snippets["claude-code"]).toBe(`claude mcp add --transport http bugberry ${ORIGIN}/api/mcp`)
    expect(JSON.parse(snippets.cursor ?? "")).toEqual({ mcpServers: { bugberry: { url: `${ORIGIN}/api/mcp` } } })
    expect(JSON.parse(snippets.vscode ?? "")).toEqual({ servers: { bugberry: { type: "http", url: `${ORIGIN}/api/mcp` } } })
    expect(JSON.parse(snippets.windsurf ?? "")).toEqual({ mcpServers: { bugberry: { serverUrl: `${ORIGIN}/api/mcp` } } })
    expect(snippets["claude-ai"]).toBe(`${ORIGIN}/api/mcp`)
    expect(snippets.chatgpt).toBe(`${ORIGIN}/api/mcp`)
  })
})

describe("AiAgentsView", () => {
  test("shows the server URL and the Claude Code command", () => {
    render(<AiAgentsView {...base} />)
    expect(screen.getByRole("heading", { name: "AI Agents (MCP)" })).toBeTruthy()
    expect(screen.getAllByText(`${ORIGIN}/api/mcp`).length).toBeGreaterThan(0)
    expect(screen.getByText(`claude mcp add --transport http bugberry ${ORIGIN}/api/mcp`)).toBeTruthy()
  })

  test("walks through three steps and links to the guide", () => {
    render(<AiAgentsView {...base} />)
    expect(screen.getAllByRole("heading", { level: 3 }).map((step) => step.textContent)).toEqual([
      "1Copy the server URL",
      "2Add it to your AI app",
      "3Paste a report link into your agent",
    ])
    expect(screen.getByText(`${ORIGIN}/app/r/…`)).toBeTruthy()
    expect(screen.getByText(`${ORIGIN}/s/…`)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Read the docs" }).getAttribute("href")).toBe("https://bugberry.yuisalabs.com/docs/guide/ai-agents")
  })

  test("both report link forms carry this server's full address", () => {
    // The agent reads a link only with this server's full origin, so both forms carry it.
    expect(reportLinkForms("https://bugberry.kantor.test").map((form) => form.link)).toEqual([
      "https://bugberry.kantor.test/app/r/…",
      "https://bugberry.kantor.test/s/…",
    ])
    expect(AGENT_PROMPT).toBe("Fix this bug: ")
  })

  test("creating a token shows it once and then lists it", () => {
    const onCreateToken = mock()
    const { rerender } = render(<AiAgentsView {...base} onCreateToken={onCreateToken} />)
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Cursor laptop" } })
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    expect(onCreateToken).toHaveBeenCalledWith("Cursor laptop")

    rerender(<AiAgentsView {...base} newToken="fdb_secret123" />)
    expect(screen.getByText("fdb_secret123")).toBeTruthy()
    expect(screen.getByText("Copy it now. You won't see it again.")).toBeTruthy()
    expect(screen.getByText("For clients without OAuth. Works with the MCP server only, not the rest of the BugBerry API.")).toBeTruthy()
    expect(screen.getByText("Authorization: Bearer <token>")).toBeTruthy()
  })

  test("revoking a token asks first, in the app's dialog", async () => {
    const onRevokeToken = mock()
    render(<AiAgentsView {...base} onRevokeToken={onRevokeToken} />)
    const row = screen.getByText("CI bot").closest("li") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }))
    const dialog = screen.getByRole("alertdialog", { name: 'Revoke "CI bot"?' })
    expect(dialog.textContent).toContain("Apps using it stop working.")
    expect(onRevokeToken).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" })))
    expect(onRevokeToken).toHaveBeenCalledWith("t1")
  })

  test("connected apps render and revoke", async () => {
    const onRevokeApp = mock()
    render(<AiAgentsView {...base} onRevokeApp={onRevokeApp} />)
    // The setup steps are a list too (their tabs name Claude Code), so the row is found through its own button.
    const row = screen.getByRole("button", { name: "Disconnect" }).closest("li") as HTMLElement
    expect(within(row).getByText("Claude Code")).toBeTruthy()
    expect(within(row).getByText(/Can read and change/)).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }))
    const dialog = screen.getByRole("alertdialog", { name: "Disconnect Claude Code?" })
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" })))
    expect(onRevokeApp).toHaveBeenCalledWith("c1")
  })

  test("no apps and no tokens say so", () => {
    render(<AiAgentsView {...base} tokens={[]} apps={[]} />)
    expect(screen.getByText("No AI apps connected yet")).toBeTruthy()
    expect(screen.getByText("Apps show up here once you sign in from them.")).toBeTruthy()
    expect(screen.getByText("No personal tokens yet.")).toBeTruthy()
  })
})
