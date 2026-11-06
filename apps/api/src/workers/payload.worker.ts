// Runs in a worker thread (see payloads.ts): gunzip, JSON.parse and the walk over every event happen here, so
// a large payload never blocks the request thread.
import { normalizePayload } from "@bugberry/debugger-view"
import { isReplayMedia, replayFrames } from "@bugberry/shared"
import { DecompressedTooLargeError, gunzipLimited, topErrors } from "../modules/trackers/debugger-errors"
import type { WorkerReply } from "../lib/worker-pool"
import type { PayloadTask } from "./payloads"

/** This thread's side of the channel; typed here rather than with the webworker lib, which clashes with the DOM one. */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PayloadTask & { id: number }>) => void) | null
  postMessage(message: WorkerReply, transfer?: Transferable[]): void
}

async function run(task: PayloadTask): Promise<{ value: unknown; transfer: Transferable[] }> {
  const blob = new Blob([task.bytes])
  switch (task.kind) {
    case "debugger-view": {
      const json = await gunzipLimited(blob)
      return { value: { view: normalizePayload(JSON.parse(json)), bytes: json.length }, transfer: [] }
    }
    case "top-errors": {
      const payload = JSON.parse(await gunzipLimited(blob)) as { events?: unknown }
      return { value: Array.isArray(payload.events) ? topErrors(payload.events) : [], transfer: [] }
    }
    case "replay-frames": {
      const media: unknown = JSON.parse(await gunzipLimited(blob, task.maxBytes))
      if (!isReplayMedia(media)) throw new Error("unreadable")
      const frames = replayFrames(media.events)
      if (frames.length > task.maxFrames) throw new DecompressedTooLargeError()
      // A copy each, so every frame owns its buffer and can be handed over without copying again.
      const decoded = frames.map((frame) => ({ atMs: frame.atMs, jpeg: new Uint8Array(Buffer.from(frame.jpeg, "base64")) }))
      return { value: decoded, transfer: decoded.map((frame) => frame.jpeg.buffer) }
    }
  }
}

scope.onmessage = async (event) => {
  const { id } = event.data
  try {
    const { value, transfer } = await run(event.data)
    scope.postMessage({ id, ok: true, value } satisfies WorkerReply, transfer)
  } catch (error) {
    const code = error instanceof DecompressedTooLargeError ? "too_large" : "unreadable"
    scope.postMessage({ id, ok: false, error: code } satisfies WorkerReply)
  }
}
