import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createRecorderServer, type Submit } from "../src/server"
import type { RecorderSession, StoredRecording } from "../src/session"

const RECORDING = {
  mediaSize: 5,
  debuggerSize: 3,
  durationMs: 4000,
  pageUrl: "https://shop.test/checkout",
  pageTitle: "Checkout",
  device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
  debuggerSummary: { logs: 1, errors: 1, requests: 2, failedRequests: 1, actions: 2, incomplete: [] },
}
const STORED: StoredRecording = { recordingId: "rec-1", draftId: "d1", dir: "/tmp/rec-1", mediaPath: "m", debuggerPath: "d", thumbnailPath: null }

function fakeSession(overrides: Partial<RecorderSession> = {}): RecorderSession & { forgotten: string[] } {
  const forgotten: string[] = []
  return {
    forgotten,
    start: async () => ({ text: "Recording tab 0 (https://shop.test/checkout).", tabIndex: 0, cdpEndpoint: "http://127.0.0.1:9555" }),
    status: async () => ({ recording: false, seconds: 0, warning: null }),
    stop: async () => ({ recordingId: "rec-1", summary: "Recorded 0:04.", warning: null, endedBy: "agent", recording: RECORDING }),
    discard: async () => {},
    take: (id) => (id === "rec-1" && !forgotten.includes(id) ? STORED : null),
    forget: async (id) => void forgotten.push(id),
    close: async () => {},
    ...overrides,
  }
}

async function connect(session: RecorderSession, submit: Submit = async () => ({ reportUrl: "https://bugs.test/app/r/1" })) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createRecorderServer(session, submit).connect(serverSide)
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
  return client
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as Array<{ type: string; text?: string }>).map((item) => item.text ?? "").join("\n")

describe("recorder MCP server", () => {
  test("server lists the five tools with their names", async () => {
    const { tools } = await (await connect(fakeSession())).listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ["discardRecording", "recordingStatus", "startRecording", "stopRecording", "submitRecording"].sort(),
    )
    for (const tool of tools) expect((tool.description ?? "").length).toBeGreaterThan(30)
  })

  test("stopRecording gives the recording object in the text, for clients that show only text", async () => {
    const result = await (await connect(fakeSession())).callTool({ name: "stopRecording", arguments: {} })
    expect(textOf(result)).toContain(JSON.stringify(RECORDING))
    expect(textOf(result)).toContain("rec-1")
    expect(result.structuredContent).toMatchObject({ recordingId: "rec-1", recording: RECORDING })
  })

  test("an error comes back as the tool's answer", async () => {
    const session = fakeSession({
      start: async () => {
        throw new Error("A recording is already running.")
      },
    })
    const result = await (await connect(session)).callTool({ name: "startRecording", arguments: { url: "https://shop.test" } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("A recording is already running.")
  })

  test("submitRecording sends the stored recording and forgets it", async () => {
    const session = fakeSession()
    const seen: string[] = []
    const client = await connect(session, async (recording: StoredRecording, link: string) => {
      seen.push(`${recording.recordingId} ${link}`)
      return { reportUrl: "https://bugs.test/app/r/1" }
    })
    const result = await client.callTool({ name: "submitRecording", arguments: { recordingId: "rec-1", uploadLink: "https://bugs.test/api/agent-uploads/t" } })
    expect(seen).toEqual(["rec-1 https://bugs.test/api/agent-uploads/t"])
    expect(textOf(result)).toContain("https://bugs.test/app/r/1")
    expect(session.forgotten).toEqual(["rec-1"])
  })

  test("submitRecording with an unknown recording says so", async () => {
    const result = await (await connect(fakeSession())).callTool({
      name: "submitRecording",
      arguments: { recordingId: "nope", uploadLink: "https://bugs.test/api/agent-uploads/t" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("stopRecording")
  })
  test("submitting a recording again after it was sent answers with its report", async () => {
    const client = await connect(fakeSession())
    await client.callTool({ name: "submitRecording", arguments: { recordingId: "rec-1", uploadLink: "https://bugs.test/api/agent-uploads/t" } })
    const again = await client.callTool({ name: "submitRecording", arguments: { recordingId: "rec-1", uploadLink: "https://bugs.test/api/agent-uploads/t" } })
    expect(again.isError).toBeFalsy()
    expect(textOf(again)).toContain("Already sent")
    expect(textOf(again)).toContain("https://bugs.test/app/r/1")
  })
})
