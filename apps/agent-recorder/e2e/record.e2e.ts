import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { expect, test } from "@playwright/test"

interface State {
  serverUrl: string
  token: string
  demoUrl: string
}

const state = () => JSON.parse(readFileSync(fileURLToPath(new URL("./.state.json", import.meta.url)), "utf8")) as State
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const playwrightMcp = fileURLToPath(new URL("../node_modules/@playwright/mcp/cli.js", import.meta.url))
const PORT = 9556

type ToolResult = Awaited<ReturnType<Client["callTool"]>>
const textOf = (result: ToolResult) => (result.content as Array<{ text?: string }>).map((item) => item.text ?? "").join("\n")

async function stdioClient(name: string, args: string[]): Promise<Client> {
  const client = new Client({ name, version: "1.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: "inherit" }))
  return client
}

/** The three MCP servers an agent has: the recorder, its browser, and BugBerry itself. */
async function agent(s: State) {
  const profile = mkdtempSync(join(tmpdir(), "recorder-e2e-profile-"))
  const recorder = await stdioClient("recorder", [cli, "--server", s.serverUrl, "--port", String(PORT), "--headless", "--profile", profile])
  const browser = await stdioClient("browser", [playwrightMcp, "--cdp-endpoint", `http://127.0.0.1:${PORT}`])
  const bugberry = new Client({ name: "bugberry", version: "1.0.0" })
  await bugberry.connect(
    new StreamableHTTPClientTransport(new URL(`${s.serverUrl}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.token}` } } }),
  )
  const close = async () => {
    await Promise.all([recorder, browser, bugberry].map((client) => client.close().catch(() => {})))
    // Chromium lets go of its profile a moment after it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
  return { recorder, browser, bugberry, close }
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError, `${name}: ${textOf(result)}`).toBeFalsy()
  return result
}

async function clickPay(browser: Client) {
  const snapshot = textOf(await call(browser, "browser_snapshot"))
  const ref = /Pay \$48\.00"? \[ref=(e\d+)\]/.exec(snapshot)?.[1]
  expect(ref, snapshot).toBeTruthy()
  await call(browser, "browser_click", { element: "Pay $48.00 button", target: ref })
}

test("an agent records the demo shop's Pay bug and files it", async () => {
  const s = state()
  const { recorder, browser, bugberry, close } = await agent(s)
  try {
    await call(recorder, "startRecording", { url: new URL("/shop", s.demoUrl).href })
    await clickPay(browser)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const stopped = (await call(recorder, "stopRecording")).structuredContent as {
      recordingId: string
      warning: string | null
      endedBy: string
      recording: { debuggerSummary: { errors: number; failedRequests: number } }
    }
    expect(stopped.warning).toBeNull()
    expect(stopped.endedBy).toBe("agent")
    expect(stopped.recording.debuggerSummary.errors).toBeGreaterThanOrEqual(1)
    expect(stopped.recording.debuggerSummary.failedRequests).toBeGreaterThanOrEqual(1)

    const created = (
      await call(bugberry, "createUpload", { title: "Pay fails", description: "Clicking Pay shows nothing.", recording: stopped.recording })
    ).structuredContent as { reportId: string; uploadLink: string; reportUrl: string }
    const sent = await call(recorder, "submitRecording", { recordingId: stopped.recordingId, uploadLink: created.uploadLink })
    expect(textOf(sent)).toContain(created.reportUrl)

    const headers = { authorization: `Bearer ${s.token}` }
    const report = (await (await fetch(`${s.serverUrl}/api/reports/${created.reportId}`, { headers })).json()) as {
      uploadStatus: string
      captureType: string
      viaAgent: string | null
      projectId: string | null
      debuggerUrl: string
    }
    expect(report).toMatchObject({ uploadStatus: "ready", captureType: "video", viaAgent: "AI agent" })
    expect(report.projectId).not.toBeNull()
    const payload = JSON.parse(gunzipSync(Buffer.from(await (await fetch(report.debuggerUrl)).arrayBuffer())).toString()) as {
      events: Array<{ kind: string; type?: string; target?: string }>
    }
    expect(payload.events).toContainEqual(expect.objectContaining({ kind: "action", type: "click", target: 'button#pay "Pay $48.00"' }))
  } finally {
    await close()
  }
})

test("opening another tab is warned and not recorded", async () => {
  const s = state()
  const { recorder, browser, close } = await agent(s)
  try {
    await call(recorder, "startRecording", { url: new URL("/shop", s.demoUrl).href })
    await clickPay(browser)
    await call(browser, "browser_tabs", { action: "new", url: s.demoUrl })
    const stopped = (await call(recorder, "stopRecording")).structuredContent as { warning: string | null }
    expect(stopped.warning).toContain("Go back to tab 0")
  } finally {
    await close()
  }
})

test("driving another browser gives an empty recording, which is refused", async () => {
  const s = state()
  const { recorder, close } = await agent(s)
  try {
    await call(recorder, "startRecording", { url: new URL("/shop", s.demoUrl).href })
    const stopped = await recorder.callTool({ name: "stopRecording", arguments: {} })
    expect(stopped.isError).toBe(true)
    expect(textOf(stopped)).toContain("Did you use the bugberry-browser tools?")
  } finally {
    await close()
  }
})
