/** Slack over a recording length limit, for the WebM's last chunk and the recorder's timer. */
export const RECORDING_LENGTH_TOLERANCE_MS = 5000

/** "3:10", "0:05", "60:00": a recording's length for people to read, in whole seconds. */
export function clockLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** Whether a recording of `durationMs` is over a limit of `maxMs`, past its slack. */
export function tooLong(durationMs: number, maxMs: number): boolean {
  return durationMs > maxMs + RECORDING_LENGTH_TOLERANCE_MS
}
