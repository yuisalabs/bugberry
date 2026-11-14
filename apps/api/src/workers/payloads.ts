import type { DebuggerView } from "@bugberry/debugger-view"
import { createWorkerPool, WorkerTaskError, type WorkerPool } from "../lib/worker-pool"

/** Work the payload threads do; `bytes` is the gzipped file, handed over without a copy. */
export type PayloadTask =
  | { kind: "debugger-view"; bytes: ArrayBuffer }
  | { kind: "top-errors"; bytes: ArrayBuffer }
  | { kind: "replay-frames"; bytes: ArrayBuffer; maxBytes: number; maxFrames: number }

/** Why a payload could not be read: past its size cap, or broken. */
export type PayloadFailure = "too_large" | "unreadable"

export class PayloadError extends Error {
  constructor(readonly reason: PayloadFailure) {
    super(`Payload ${reason}`)
    this.name = "PayloadError"
  }
}

const TASK_TIMEOUT_MS = 60_000
let size = 2
let pool: WorkerPool | null = null

/** Sets how many threads parse payloads (PAYLOAD_WORKERS); takes effect before the first payload is read. */
export function configurePayloadWorkers(threads: number): void {
  size = threads
}

/** Stops the threads; the next payload starts them again. */
export function stopPayloadWorkers(): void {
  pool?.terminate()
  pool = null
}

async function run<T>(task: PayloadTask): Promise<T> {
  pool ??= createWorkerPool({ url: new URL("./payload.worker.ts", import.meta.url), size, taskTimeoutMs: TASK_TIMEOUT_MS })
  try {
    return await pool.run<T>(task, [task.bytes])
  } catch (error) {
    if (error instanceof WorkerTaskError) throw new PayloadError(error.code === "too_large" ? "too_large" : "unreadable")
    throw error
  }
}

/** A gzipped debugger payload, validated like the dashboard does; `bytes` is the size of its JSON. */
export async function parseDebuggerView(blob: Blob): Promise<{ view: DebuggerView; bytes: number }> {
  return run({ kind: "debugger-view", bytes: await blob.arrayBuffer() })
}

/** The first distinct page and console errors in a gzipped debugger payload. */
export async function parseTopErrors(blob: Blob): Promise<string[]> {
  return run({ kind: "top-errors", bytes: await blob.arrayBuffer() })
}

/** The JPEG frames embedded in a gzipped replay recording, decoded, with their times. */
export async function parseReplayFrames(
  blob: Blob,
  limits: { maxBytes: number; maxFrames: number },
): Promise<Array<{ atMs: number; jpeg: Uint8Array<ArrayBuffer> }>> {
  return run({ kind: "replay-frames", bytes: await blob.arrayBuffer(), ...limits })
}
