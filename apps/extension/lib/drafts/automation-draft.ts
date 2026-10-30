import { type CaptureEvent, encodeDebuggerPayload, summarize } from "@bugberry/capture"
import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"
import type { DraftStore } from "./draft-store"
import type { RecordingEndReason } from "../recording/recorder"

/** What the agent recorder learns of a stopped recording; the files themselves it reads a slice at a time. */
export interface AutomationDraftMeta {
  durationMs: number
  pageUrl: string
  pageTitle: string
  device: DeviceInfo
  debuggerSummary: DebuggerSummary
  /** The actions the agent made: the recorder's own reload at the start doesn't count. */
  agentActions: number
  /** Set when the time limit ended the recording. */
  stoppedAtLimitMs: number | null
  /** Why it ended by itself; null when it was stopped. */
  endReason: RecordingEndReason | null
  sizes: { media: number; debugger: number; thumbnail: number | null }
}

export interface PreparedDraft {
  meta: AutomationDraftMeta
  files: { media: Blob; debugger: Blob; thumbnail: Blob | null }
}

/** The recorder reloads the page once recording runs, so errors on load are caught; that reload isn't the agent's. */
function agentActionsOf(events: readonly CaptureEvent[]): number {
  const actions = events.filter((event) => event.kind === "action")
  const first = actions[0]
  const ownReload = first?.type === "navigate" && first.via === "reload"
  return actions.length - (ownReload ? 1 : 0)
}

/** Readies a stopped recording for the recorder: its payload encoded as the server takes it, and a thumbnail. */
export async function prepareAutomationDraft(
  store: DraftStore,
  id: string,
  deps: { makeThumbnail(video: Blob, durationMs: number | null): Promise<Blob | null> },
): Promise<PreparedDraft> {
  const draft = await store.get(id)
  if (draft?.captureType !== "video" || !draft.video || !draft.debuggerPayload) throw new Error("Recording not found")
  const payload = draft.debuggerPayload
  const debuggerFile = await encodeDebuggerPayload(payload)
  const thumbnail = await deps.makeThumbnail(draft.video, draft.durationMs)
  return {
    files: { media: draft.video, debugger: debuggerFile, thumbnail },
    meta: {
      durationMs: draft.durationMs ?? 0,
      pageUrl: draft.page.url,
      pageTitle: draft.page.title,
      device: draft.device,
      debuggerSummary: summarize(payload.events, payload.incomplete),
      agentActions: agentActionsOf(payload.events),
      stoppedAtLimitMs: draft.stoppedAtLimitMs ?? null,
      endReason: draft.endReason ?? null,
      sizes: { media: draft.video.size, debugger: debuggerFile.size, thumbnail: thumbnail?.size ?? null },
    },
  }
}

/**
 * `length` bytes of `blob` from `offset`, as base64. A recording can be hundreds of megabytes: read whole, it would
 * cross to the recorder as one string bigger than V8 allows.
 */
export async function base64Chunk(blob: Blob, offset: number, length: number): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
  let binary = ""
  // btoa takes a binary string; built in slices, as one spread of a large chunk overflows the call stack.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}
