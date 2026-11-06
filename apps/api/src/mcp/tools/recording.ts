import { frameIndexAt, isRecordingType, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { replayFrameKeyFor } from "../../storage/keys"
import { type McpContext, McpToolError, RATE_LIMITED, runTool } from "../context"
import { loadDebuggerView } from "../debugger"
import { offsetLabel, reportUrl, textResult } from "../format"
import { type Moment, recordingMoments } from "../recording"
import { resolveReportRef } from "../refs"
import { noteAgentRead } from "../activity"
import { reportArgs } from "./args"

/** How long the agent has to start the download; one already running finishes. */
const LINK_SECONDS = 300

/** "5.4": seconds for ffmpeg's -ss. */
const seconds = (ms: number) => (Math.round(ms / 100) / 10).toFixed(1)
/** "0005.4s": sorts in video order in a folder. */
const frameName = (prefix: string, ms: number) => `${prefix}-${seconds(ms).padStart(6, "0")}s.jpg`
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The answer's text: the link, the moments, and how to turn them into frames on the agent's machine. */
export function recordingText(input: {
  number: number
  title: string
  durationMs: number | null
  sizeBytes: number
  url: string
  reportLink: string
  moments: Moment[]
}): string {
  const prefix = `bb-${input.number}`
  const video = `${prefix}.webm`
  const length = input.durationMs !== null ? `${seconds(input.durationMs)}s, ` : ""
  const cut = (ms: number) => `   ffmpeg -v error -y -ss ${seconds(ms)} -i ${video} -frames:v 1 ${frameName(prefix, ms)}`
  return [
    `BB-${input.number} · ${input.title}: recording, ${length}${megabytes(input.sizeBytes)}`,
    `Video link (start the download within 5 minutes): ${input.url}`,
    "",
    ...(input.moments.length > 0
      ? [
          "Moments worth a frame, in video time (the last line of each is where its frame is cut):",
          ...input.moments.flatMap((moment) => [`${offsetLabel(moment.atMs)}`, ...moment.lines.map((line) => `  ${line}`)]),
        ]
      : ["No moments to point at: this recording has no captured errors, failed requests, notes or navigations. Cut frames at any second."]),
    "",
    "To see them:",
    `1. Download the video into a temporary folder, for example: curl -fsSL -o ${video} "${input.url}"`,
    "2. Cut a frame at each moment (any other second works the same way):",
    ...(input.moments.length > 0 ? input.moments.map((moment) => cut(moment.atMs)) : [cut(0)]),
    "3. Open the images and look at them next to the console and network logs.",
    "4. Delete the video and the frames when you are done: the recording can show private data.",
    `Without ffmpeg, install it (https://ffmpeg.org/download.html) or watch the video in BugBerry: ${input.reportLink}`,
  ].join("\n")
}

export interface ReplayFrameLink {
  index: number
  atMs: number
  seconds: string
  url: string
}

/** A replay's answer: the moments, each with the frame showing the page just before it, then every frame's link. */
export function replayText(input: {
  number: number
  title: string
  durationMs: number | null
  frames: ReplayFrameLink[]
  moments: Array<Moment & { frameIndex: number | null }>
  reportLink: string
}): string {
  const length = input.durationMs !== null ? ` of about ${seconds(input.durationMs)}s` : ""
  const frameOf = (index: number | null) => {
    const frame = index === null ? undefined : input.frames[index]
    return frame ? `  → frame ${frame.index} (${frame.seconds}s)` : "  → no frame before this moment"
  }
  return [
    `BB-${input.number} "${input.title}" is a replay${length}: ${input.frames.length} screenshots taken every 5 s while the tab was armed.`,
    "",
    ...(input.moments.length > 0
      ? [
          "Moments worth a look, in replay time, each with the last screenshot taken at or before it:",
          ...input.moments.flatMap((moment) => [
            offsetLabel(moment.atMs),
            ...moment.lines.map((line) => `  ${line}`),
            frameOf(moment.frameIndex),
          ]),
        ]
      : ["No moments to point at: this replay has no captured errors, failed requests, notes or navigations."]),
    "",
    "Screenshots:",
    ...input.frames.map((frame) => `frame ${frame.index} at ${frame.seconds}s: ${frame.url}`),
    "",
    `Links expire in 5 minutes. Read the report in BugBerry: ${input.reportLink}`,
  ].join("\n")
}

export function registerRecordingTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "getRecording",
    {
      title: "Get the report's recording",
      description:
        "For a video report: a short-lived link to the video, the moments worth a frame (errors, failed requests, the click " +
        "before them, notes, rage clicks, navigations) in video time, and ffmpeg commands to cut those frames on your machine. " +
        "For a replay report: links to its screenshots, one every 5 seconds, with each moment mapped to the screenshot before it.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ report: ref, workspace }) =>
      runTool(async () => {
        // The link hands out the whole video, heavier than any image: it shares the screenshots' allowance.
        if (!(await ctx.screenshotLimiter.consume(ctx.caller.user.id))) throw new McpToolError("rate_limited", RATE_LIMITED)
        const resolved = await resolveReportRef(ctx, ref, workspace)
        const row = resolved.row
        if (!isRecordingType(row.captureType)) {
          return textResult(`BB-${row.number} is a screenshot report, not a recording. Use getScreenshot to see it.`)
        }
        await noteAgentRead(ctx, resolved, "recording")
        const reportLink = reportUrl(ctx.deps.config.appUrl, resolved.id)
        if (row.captureType === "replay") {
          const times = row.replayFrames ?? []
          if (times.length === 0) {
            return textResult(
              `BB-${row.number} is a replay with no screenshots: the tab was hidden while it was armed. Use getTimeline for what happened.`,
            )
          }
          const frames: ReplayFrameLink[] = await Promise.all(
            times.map(async (atMs, index) => ({
              index,
              atMs,
              seconds: seconds(atMs),
              url: await ctx.deps.storage.getReadUrl(replayFrameKeyFor(row.id, index), {
                contentType: THUMBNAIL_CONTENT_TYPE,
                expiresInSeconds: LINK_SECONDS,
              }),
            })),
          )
          const view = await loadDebuggerView(ctx, resolved)
          const moments = (view ? recordingMoments(view, row.durationMs) : []).map((moment) => ({
            ...moment,
            frameIndex: frameIndexAt(frames, moment.atMs),
          }))
          const text = replayText({ number: row.number, title: row.title, durationMs: row.durationMs, frames, moments, reportLink })
          return textResult(text, {
            kind: "replay",
            durationMs: row.durationMs,
            expiresInSeconds: LINK_SECONDS,
            frames,
            moments: moments.map((moment) => ({
              atMs: moment.atMs,
              seconds: Number(seconds(moment.atMs)),
              lines: moment.lines,
              frameIndex: moment.frameIndex,
            })),
          })
        }
        const info = row.mediaKey ? await ctx.deps.storage.head(row.mediaKey) : null
        if (!row.mediaKey || !info) return textResult(`The video file is missing. Watch the report in BugBerry: ${reportLink}`)

        const url = await ctx.deps.storage.getReadUrl(row.mediaKey, { contentType: row.mediaType, expiresInSeconds: LINK_SECONDS })
        const view = await loadDebuggerView(ctx, resolved)
        const moments = view ? recordingMoments(view, row.durationMs) : []
        const text = recordingText({
          number: row.number,
          title: row.title,
          durationMs: row.durationMs,
          sizeBytes: info.size,
          url,
          reportLink,
          moments,
        })
        return textResult(text, {
          url,
          expiresInSeconds: LINK_SECONDS,
          mediaType: row.mediaType,
          sizeBytes: info.size,
          durationMs: row.durationMs,
          moments: moments.map((moment) => ({ atMs: moment.atMs, seconds: Number(seconds(moment.atMs)), lines: moment.lines })),
        })
      }),
  )
}
