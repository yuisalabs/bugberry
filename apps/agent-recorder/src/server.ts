import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import packageJson from "../package.json"
import type { RecorderSession, StoredRecording } from "./session"

export type Submit = (recording: StoredRecording, uploadLink: string) => Promise<{ reportUrl: string }>

const INSTRUCTIONS =
  "Records a bug in a browser you drive, and files it in BugBerry with video, console, network and your actions. " +
  "Call startRecording, then use the bugberry-browser tools in the recorded tab only, then stopRecording. Write a title " +
  "and description, call createUpload on the BugBerry server with the recording object, then submitRecording here with " +
  "the uploadLink it returns."

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

export function createRecorderServer(session: RecorderSession, submit: Submit): McpServer {
  const server = new McpServer({ name: "bugberry-recorder", version: packageJson.version }, { instructions: INSTRUCTIONS })
  const changes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

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
        const status = session.status()
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
      description: "Stops the running recording and throws it away, so a new one can start. Nothing is sent.",
      inputSchema: {},
      annotations: { ...changes, destructiveHint: true },
    },
    () =>
      run(async () => {
        await session.discard()
        return text("Recording discarded.")
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
        if (!recording) throw new Error(`No stopped recording ${recordingId} here. Call stopRecording first.`)
        const { reportUrl } = await submit(recording, uploadLink)
        await session.forget(recordingId)
        return text(`Sent. The report is ready: ${reportUrl}`, { reportUrl })
      }),
  )

  return server
}
