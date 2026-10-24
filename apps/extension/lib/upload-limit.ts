import type { WorkspaceLimits } from "./limits"
import { MAX_RECORDING_MS } from "./recorder"

/** What an older server, or one that can't be reached, is assumed to accept. */
export const DEFAULT_MAX_UPLOAD_MB = 200
const READ_TIMEOUT_MS = 2000

/** The video may fill 95% of the server's upload limit; the rest is room for the last chunk and the header. */
export function recordingByteBudget(maxUploadMb: number): number {
  return Math.floor(maxUploadMb * 1024 * 1024 * 0.95)
}

/** `read`'s answer, or null when it fails or doesn't come in time: a recording never waits long to start. */
async function inTime<T>(read: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** The server's public `/client-config`, or null when it isn't known in time. */
export function clientConfigInTime(read: () => Promise<unknown>, timeoutMs = READ_TIMEOUT_MS): Promise<unknown> {
  return inTime(read, timeoutMs)
}

/** The default workspace's limits, or null when they aren't known in time. */
export function workspaceLimitsInTime(read: () => Promise<WorkspaceLimits | null>, timeoutMs = READ_TIMEOUT_MS): Promise<WorkspaceLimits | null> {
  return inTime(read, timeoutMs)
}

const configNumber = (config: unknown, key: string): number | null => {
  const value = typeof config === "object" && config !== null ? (config as Record<string, unknown>)[key] : undefined
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

/** The server's upload limit in MB from `/client-config`, or 200 without one. */
export function uploadLimitMb(clientConfig: unknown): number {
  return configNumber(clientConfig, "maxUploadMb") ?? DEFAULT_MAX_UPLOAD_MB
}

/**
 * How long a recording may run: the workspace's length under ACCOUNT_LIMITS, 20 minutes in a workspace that isn't
 * limited. Signed out, or with the workspace unknown, the server's account length from `/client-config` (null on a
 * server without limits); 20 minutes when that isn't known either. Never past 20 minutes.
 */
export function recordingLengthMs(limits: WorkspaceLimits | null, clientConfig: unknown): number {
  if (limits?.limited === false) return MAX_RECORDING_MS
  const seconds = configNumber(clientConfig, "maxRecordingSeconds")
  const length = limits?.limited ? limits.maxRecordingMs : seconds === null ? undefined : seconds * 1000
  return Math.min(length ?? MAX_RECORDING_MS, MAX_RECORDING_MS)
}
