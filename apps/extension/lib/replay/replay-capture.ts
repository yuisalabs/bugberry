import { redactUrl } from "@bugberry/capture"
import { encodeReplayMedia, type ReplayEvent, replayDurationMs, replayFrames, replayStartedAt, tooLong } from "@bugberry/shared"
import { type ActiveTab, type CaptureFlowDeps, type CaptureResult, capturable, pagePayloadFor, UNCAPTURABLE } from "../capture/capture-flow"
import { deviceInfoFrom } from "../capture/device"
import type { ReplaySnapshot } from "../shared/messages"
import type { ReplayDraft } from "../shared/types"

export type ReplayCaptureDeps = Pick<
  CaptureFlowDeps,
  "readPageCapture" | "readEnvironment" | "pageReadTimeoutMs" | "openReview" | "store" | "userAgent" | "now" | "newId"
>

const META = 4

/** The events from the last segment start (the last Meta event) on; the whole list when there is only one. */
export function lastSegment(events: ReplayEvent[]): ReplayEvent[] {
  const start = events.findLastIndex((event) => event.type === META)
  return start > 0 ? events.slice(start) : events
}

/**
 * Over the recording limit the older segment goes rather than the capture being refused, judged as the server
 * judges it (with its slack).
 */
export function withinLimit(events: ReplayEvent[], maxMs: number): ReplayEvent[] {
  return tooLong(replayDurationMs(events), maxMs) ? lastSegment(events) : events
}

/** The page's buffer as a draft: the replay, the logs cut to the same window, and the review over the tab. */
export async function startReplayReport(tab: ActiveTab, snapshot: ReplaySnapshot, deps: ReplayCaptureDeps, maxMs: number): Promise<CaptureResult> {
  if (!capturable(tab.url)) return { ok: false, error: UNCAPTURABLE }
  if (snapshot.events.length === 0) return { ok: false, error: "Nothing was recorded yet" }
  const events = withinLimit(snapshot.events, maxMs)
  // Every event time in the dashboard counts from the kept checkout, so the first frame is at 0.
  const since = replayStartedAt(events)
  const { payload } = await pagePayloadFor(tab.id, deps, since, { since, pauses: [] })
  const id = deps.newId()
  const draft: ReplayDraft = {
    id,
    createdAt: deps.now(),
    captureType: "replay",
    replay: await encodeReplayMedia({ version: 1, events }),
    durationMs: replayDurationMs(events),
    recordingStartedAt: since,
    frames: replayFrames(events).map((frame) => frame.atMs),
    page: { url: redactUrl(tab.url), title: tab.title ?? "" },
    device: deviceInfoFrom(deps.userAgent, { width: tab.width, height: tab.height }),
    debuggerPayload: payload,
    debuggerGzip: null,
    status: "editing",
    error: null,
    session: null,
    form: null,
    tabId: tab.id,
  }
  await deps.store.put(draft)
  await deps.openReview(id, tab.id)
  return { ok: true, draftId: id }
}
