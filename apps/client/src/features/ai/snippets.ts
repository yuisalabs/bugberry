import { RiCursorLine, RiMessage2Line, RiProgress4Line, RiTerminalLine, type RemixiconComponentType } from "@remixicon/react"

/** How to add the server in each AI app: what to paste, and where. */
export function connectSnippets(url: string): Array<{ id: string; label: string; where: string; code: string }> {
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  return [
    { id: "claude-code", label: "Claude Code", where: "Run in a terminal, then sign in when Claude Code asks.", code: `claude mcp add --transport http bugberry ${url}` },
    { id: "claude-ai", label: "Claude.ai", where: "Settings → Connectors → Add custom connector, then paste this URL.", code: url },
    {
      id: "codex",
      label: "Codex",
      where: "Run both in a terminal; the second signs you in.",
      code: [`codex mcp add bugberry --url ${url}`, "codex mcp login bugberry"].join("\n"),
    },
    { id: "cursor", label: "Cursor", where: "Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).", code: json({ mcpServers: { bugberry: { url } } }) },
    { id: "vscode", label: "VS Code", where: "Add to .vscode/mcp.json, or run “MCP: Add Server” and choose HTTP.", code: json({ servers: { bugberry: { type: "http", url } } }) },
    { id: "windsurf", label: "Windsurf", where: "Add to ~/.codeium/windsurf/mcp_config.json.", code: json({ mcpServers: { bugberry: { serverUrl: url } } }) },
    { id: "chatgpt", label: "ChatGPT", where: "Settings → Connectors → Create, then paste this URL.", code: url },
  ]
}

/** Where the agent recorder's Chromium listens, as @bugberry/recorder starts it without --port. */
export const RECORDER_PORT = 9555

/** How to add the agent recorder and its browser in each coding agent: two local servers beside the MCP one. */
export function recorderSnippets(serverUrl: string, port: number): Array<{ id: string; label: string; where: string; code: string }> {
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  const recorder = { command: "npx", args: ["-y", "@bugberry/recorder", "--server", serverUrl] }
  const browser = { command: "npx", args: ["@playwright/mcp@latest", "--cdp-endpoint", `http://127.0.0.1:${port}`] }
  const servers = { "bugberry-recorder": recorder, "bugberry-browser": browser }
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      where: "Run both in a terminal.",
      code: [
        `claude mcp add bugberry-recorder -- ${[recorder.command, ...recorder.args].join(" ")}`,
        `claude mcp add bugberry-browser -- ${[browser.command, ...browser.args].join(" ")}`,
      ].join("\n"),
    },
    {
      id: "codex",
      label: "Codex",
      where: "Run both in a terminal.",
      code: [
        `codex mcp add bugberry-recorder -- ${[recorder.command, ...recorder.args].join(" ")}`,
        `codex mcp add bugberry-browser -- ${[browser.command, ...browser.args].join(" ")}`,
      ].join("\n"),
    },
    { id: "cursor", label: "Cursor", where: "Add to ~/.cursor/mcp.json, beside bugberry.", code: json({ mcpServers: servers }) },
    {
      id: "vscode",
      label: "VS Code",
      where: "Add to .vscode/mcp.json, beside bugberry.",
      code: json({ servers: Object.fromEntries(Object.entries(servers).map(([name, entry]) => [name, { type: "stdio", ...entry }])) }),
    },
    { id: "windsurf", label: "Windsurf", where: "Add to ~/.codeium/windsurf/mcp_config.json.", code: json({ mcpServers: servers }) },
  ]
}

/** The prompt step 3 offers to copy; the person adds their report's link after it. */
export const AGENT_PROMPT = "Fix this bug: "

/**
 * The report links an agent can be given on this server, as the MCP server reads them (parseReportRef): the
 * report page's address and a share link. Both need this server's full origin.
 */
export function reportLinkForms(origin: string): Array<{ link: string; what: string }> {
  return [
    { link: `${origin}/app/r/…`, what: "the report's page" },
    { link: `${origin}/s/…`, what: "a share link" },
  ]
}

/** What an agent can do with a report once it is connected, as the side card lists it. */
export const AGENT_CAN: Array<{ icon: RemixiconComponentType; title: string; text: string }> = [
  { icon: RiTerminalLine, title: "Read console & network logs", text: "Errors, failed requests and stack traces" },
  { icon: RiCursorLine, title: "Replay user steps", text: "Every click and keystroke before the bug" },
  { icon: RiMessage2Line, title: "Comment on reports", text: "Post findings and fixes back to your team" },
  { icon: RiProgress4Line, title: "Update status & priority", text: "Move a report to In review when a fix is ready" },
]
