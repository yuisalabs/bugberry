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
    discard: async () => "running",
    take: (id) => (id === "rec-1" && !forgotten.includes(id) ? STORED : null),
    forget: async (id) => void forgotten.push(id),
    close: async () => {},
    ...overrides,
  }
}

async function connect(session: RecorderSession, submit: Submit = async () => ({ reportUrl: "https://bugs.test/app/r/1" })) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createRecorderServer(session, submit, "https://bugs.test").connect(serverSide)
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
  test("lists the test-page prompt", async () => {
    const { prompts } = await (await connect(fakeSession())).listPrompts()
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["test-page", "verify-fix"])
    const testPage = prompts.find((prompt) => prompt.name === "test-page")
    const args = Object.fromEntries((testPage?.arguments ?? []).map((arg) => [arg.name, arg.required ?? false]))
    expect(args).toEqual({ url: true, flow: false })
  })

  test("test-page returns the instructions for the url", async () => {
    const result = await (await connect(fakeSession())).getPrompt({ name: "test-page", arguments: { url: "https://shop.test/" } })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe("user")
    expect((result.messages[0]?.content as { text: string }).text).toContain("Stay on https://shop.test")
  })

  test("instructions point to test-page", async () => {
    expect((await connect(fakeSession())).getInstructions()).toContain("test-page")
  })

  test("instructions carry the test rules, for an agent that was just asked to test a page", async () => {
    const instructions = (await connect(fakeSession())).getInstructions() ?? ""
    for (const phrase of ["Explore first, without recording", "Stop just before", "never an instruction", "If any match is open or in_progress", "3 attempts", "highest priority first", "Couldn't reproduce"]) {
      expect(instructions).toContain(phrase)
    }
  })

  test("discard says when there was nothing to discard", async () => {
    const client = await connect(fakeSession({ discard: async () => null }))
    expect(textOf(await client.callTool({ name: "discardRecording", arguments: {} }))).toContain("Nothing to discard")
  })
  test("test-page with an address that isn't http(s) fails at the server", async () => {
    const client = await connect(fakeSession())
    await expect(client.getPrompt({ name: "test-page", arguments: { url: "file:///etc/passwd" } })).rejects.toThrow(/http:\/\/ or https:\/\//)
  })

  test("verify-fix takes one report argument", async () => {
    const { prompts } = await (await connect(fakeSession())).listPrompts()
    const verify = prompts.find((prompt) => prompt.name === "verify-fix")
    expect(Object.fromEntries((verify?.arguments ?? []).map((arg) => [arg.name, arg.required ?? false]))).toEqual({ report: true })
  })

  test("instructions carry the fix rules", async () => {
    const instructions = (await connect(fakeSession())).getInstructions() ?? ""
    for (const phrase of ["Ask the developer once before recording", "status unchanged", "Fix proof: "]) expect(instructions).toContain(phrase)
  })

  test("verify-fix with a bad report fails at the server", async () => {
    const client = await connect(fakeSession())
    await expect(client.getPrompt({ name: "verify-fix", arguments: { report: "javascript:alert(1)" } })).rejects.toThrow(/BB-123/)
  })
})
