import { encodeDebuggerPayload, summarize } from "@bugberry/capture"
import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"
import type { DraftStore } from "./draft-store"

/** A finished recording as the agent recorder takes it: the files as base64, and what createUpload needs. */
export interface AutomationDraft {
  videoBase64: string
  debuggerBase64: string
  thumbnailBase64: string | null
  durationMs: number
  pageUrl: string
  pageTitle: string
  device: DeviceInfo
  debuggerSummary: DebuggerSummary
  /** Set when the time limit ended the recording. */
  stoppedAtLimitMs: number | null
}

/** btoa takes a binary string; built in slices, as one spread of a long video overflows the call stack. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

/** Reads a stopped recording out of the draft store, with its payload encoded as the server takes it. */
export async function readAutomationDraft(
  store: DraftStore,
  id: string,
  deps: { makeThumbnail(video: Blob, durationMs: number | null): Promise<Blob | null> },
): Promise<AutomationDraft> {
  const draft = await store.get(id)
  if (draft?.captureType !== "video" || !draft.video || !draft.debuggerPayload) throw new Error("Recording not found")
  const payload = draft.debuggerPayload
  const thumbnail = await deps.makeThumbnail(draft.video, draft.durationMs)
  return {
    videoBase64: await base64Of(draft.video),
    debuggerBase64: await base64Of(await encodeDebuggerPayload(payload)),
    thumbnailBase64: thumbnail ? await base64Of(thumbnail) : null,
    durationMs: draft.durationMs ?? 0,
    pageUrl: draft.page.url,
    pageTitle: draft.page.title,
    device: draft.device,
    debuggerSummary: summarize(payload.events, payload.incomplete),
    stoppedAtLimitMs: draft.stoppedAtLimitMs ?? null,
  }
}
