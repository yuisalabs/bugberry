import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import packageJson from "../package.json"
import { FIX_RULES, registerRecorderPrompts, TEST_RULES } from "./prompts"
import type { RecorderSession, StoredRecording } from "./session"

export type Submit = (recording: StoredRecording, uploadLink: string) => Promise<{ reportUrl: string }>

const INSTRUCTIONS =
  "Records a bug in a browser you drive, and files it in BugBerry with video, console, network and your actions. " +
  "Call startRecording, then use the bugberry-browser tools in the recorded tab only, then stopRecording. Write a title " +
  "and description, call createUpload on the BugBerry server with the recording object, then submitRecording here with " +
  "the uploadLink it returns.\n\nWhen asked to test a page and file what you find (the test-page prompt, or just asked), " +
  `follow these rules:\n${TEST_RULES}\n\nWhen asked to record proof that a reported bug is fixed (the verify-fix ` +
  `prompt, or just asked), follow these rules:\n${FIX_RULES}`

const text = (body: string, structured?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: body }],
  ...(structured ? { structuredContent: structured } : {}),
})

/** Every failure is something the agent can act on, so it comes back as the tool's answer. */
async function run(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work()
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }
  }
}

/** `bugberry` is the --server origin: report links for verify-fix are only taken from there. */
export function createRecorderServer(session: RecorderSession, submit: Submit, bugberry: string): McpServer {
  const server = new McpServer({ name: "bugberry-recorder", version: packageJson.version }, { instructions: INSTRUCTIONS })
  const changes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  /** Recordings already sent, by id: a retry after a lost answer gets the report again instead of an error. */
  const sent = new Map<string, string>()

  server.registerTool(
    "startRecording",
    {
      title: "Start recording a bug",
      description:
        "Opens the page in the recorder's browser and starts recording that tab. Then drive it with the bugberry-browser " +
        "tools, in that tab only, and call stopRecording when the bug has shown.",
      inputSchema: { url: z.string().min(1).max(2048).describe("The page to open, http:// or https://.") },
      annotations: changes,
    },
    ({ url }) =>
      run(async () => {
        const started = await session.start(url)
        return text(started.text, { tabIndex: started.tabIndex, cdpEndpoint: started.cdpEndpoint })
      }),
  )

  server.registerTool(
    "recordingStatus",
    {
      title: "Recording status",
      description: "Whether a recording is running, for how long, and a warning when you opened a tab that isn't recorded.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const status = await session.status()
        const line = status.recording ? `Recording for ${status.seconds} s.` : "Nothing is recording."
        return text([line, status.warning].filter(Boolean).join(" "), status)
      }),
  )

  server.registerTool(
    "stopRecording",
    {
      title: "Stop recording",
      description:
        "Stops the recording and keeps it here. Answers with what was caught and the recording object to pass, unchanged, " +
        "to createUpload on the BugBerry server.",
      inputSchema: {},
      annotations: changes,
    },
    () =>
      run(async () => {
        const stopped = await session.stop()
        return text(
          [stopped.summary, stopped.warning, `recordingId: ${stopped.recordingId}`, `recording: ${JSON.stringify(stopped.recording)}`]
            .filter(Boolean)
            .join("\n"),
          { ...stopped },
        )
      }),
  )

  server.registerTool(
    "discardRecording",
    {
      title: "Discard the recording",
      description:
        "Throws away the running recording, or else the last stopped one that wasn't sent, so a new one can start. " +
        "Nothing is sent.",
      inputSchema: {},
      annotations: { ...changes, destructiveHint: true },
    },
    () =>
      run(async () => {
        const dropped = await session.discard()
        if (dropped === "running") return text("Recording discarded.")
        if (dropped === "stopped") return text("The stopped recording was discarded; it won't be sent.")
        return text("Nothing to discard.")
      }),
  )

  server.registerTool(
    "submitRecording",
    {
      title: "Send the recording to its report",
      description: "Sends a stopped recording to the report createUpload made, through the uploadLink it returned.",
      inputSchema: {
        recordingId: z.string().min(1).max(100).describe("From stopRecording."),
        uploadLink: z.string().min(1).max(2048).describe("From createUpload."),
      },
      annotations: changes,
    },
    ({ recordingId, uploadLink }) =>
      run(async () => {
        const recording = session.take(recordingId)
        const sentTo = sent.get(recordingId)
        if (!recording && sentTo) return text(`Already sent. The report is ready: ${sentTo}`, { reportUrl: sentTo })
        if (!recording) throw new Error(`No stopped recording ${recordingId} here. Call stopRecording first.`)
        const { reportUrl } = await submit(recording, uploadLink)
        sent.set(recordingId, reportUrl)
        await session.forget(recordingId)
        return text(`Sent. The report is ready: ${reportUrl}`, { reportUrl })
      }),
  )

  registerRecorderPrompts(server, bugberry)
  return server
}
