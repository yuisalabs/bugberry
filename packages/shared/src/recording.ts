/** The longest recording the extension makes, and the agent recorder's limit when a server sets none. */
export const MAX_RECORDING_MS = 20 * 60 * 1000

/** BugBerry cloud: the server a store build of the extension, and the agent recorder, send to by default. */
export const BUGBERRY_CLOUD_ORIGIN = "https://bugberry.yuisalabs.com"

/** The video may fill 95% of the server's upload limit; the rest is room for the last chunk and the header. */
export function recordingByteBudget(maxUploadMb: number): number {
  return Math.floor(maxUploadMb * 1024 * 1024 * 0.95)
}
