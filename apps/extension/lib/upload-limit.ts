/** What an older server, or one that can't be reached, is assumed to accept. */
export const DEFAULT_MAX_UPLOAD_MB = 200
const READ_TIMEOUT_MS = 2000

/** The video may fill 95% of the server's upload limit; the rest is room for the last chunk and the header. */
export function recordingByteBudget(maxUploadMb: number): number {
  return Math.floor(maxUploadMb * 1024 * 1024 * 0.95)
}

/** The server's upload limit in MB from `/client-config`, or 200 when it gives none in time. */
export async function uploadLimitMb(read: () => Promise<unknown>, timeoutMs = READ_TIMEOUT_MS): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const config = await Promise.race([
      read().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
    const value = typeof config === "object" && config !== null ? (config as { maxUploadMb?: unknown }).maxUploadMb : undefined
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_UPLOAD_MB
  } finally {
    clearTimeout(timer)
  }
}
