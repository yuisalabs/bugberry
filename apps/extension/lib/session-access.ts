/**
 * Lets content scripts read session storage (the flush script reads whether a recording runs), so a normal
 * page load never wakes the background. Firefox has no setAccessLevel: an unguarded call would throw and stop
 * the rest of the background from starting.
 */
export function openSessionToContentScripts(
  session: { setAccessLevel?: (options: { accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }) => Promise<void> } | undefined,
): void {
  try {
    void session?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })?.catch(() => {})
  } catch {
    // Not available here; the flush script then flushes on every page exit (lib/recording-watch.ts).
  }
}
