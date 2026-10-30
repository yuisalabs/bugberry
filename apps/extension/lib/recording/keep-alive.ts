/** Under Firefox's 30-second idle limit for an extension's background page. */
export const KEEP_ALIVE_MS = 20_000

/**
 * Pings the background while the recorder window waits for the reporter to choose what to record: Firefox
 * may unload an idle background page, and with it the recording that is starting. Returns a stop function.
 */
export function keepBackgroundAwake(send: () => Promise<unknown>, every: (run: () => void, ms: number) => () => void): () => void {
  return every(() => void send().catch(() => {}), KEEP_ALIVE_MS)
}
