/** The recording state the background keeps in session storage (lib/recording/browser-recording-state.ts). */
const RECORDING_KEY = "recording"
const isPaused = (state: unknown) => typeof (state as { pausedAt?: unknown } | undefined)?.pausedAt === "number"

type OnChange = (recording: boolean, initial: boolean, paused: boolean) => void

/**
 * Tells the flush script whether a recording runs, from session storage, so a normal page load never wakes
 * the background. Where content scripts can't read that area (Firefox may refuse), it flushes on every page
 * exit instead; the background drops the pages of tabs it isn't recording.
 */
export function watchRecording(
  session: { get(key: string): Promise<Record<string, unknown>> } | undefined,
  onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void },
  onChange: OnChange,
): void {
  const always = () => onChange(true, true, false)
  if (!session) return always()
  session
    .get(RECORDING_KEY)
    .then((stored) => onChange(Boolean(stored[RECORDING_KEY]), true, isPaused(stored[RECORDING_KEY])))
    .catch(always)
  onChanged.addListener((changes, area) => {
    if (area === "session" && RECORDING_KEY in changes) {
      const value = changes[RECORDING_KEY]?.newValue
      onChange(Boolean(value), false, isPaused(value))
    }
  })
}
