import { useEffect, useLayoutEffect, useState } from "react"

/**
 * Keeps something on screen for `outMs` after it closes, so it can ease out. "closed" is returned from the very
 * render that closes it (never a frame without it, which would flicker); null once it is gone.
 */
export function usePresence(open: boolean, outMs: number): "open" | "closed" | null {
  const [phase, setPhase] = useState<"open" | "closed" | null>(open ? "open" : null)
  useLayoutEffect(() => {
    setPhase((now) => (open ? "open" : now === "open" ? "closed" : now))
  }, [open])
  useEffect(() => {
    if (phase !== "closed") return
    const gone = setTimeout(() => setPhase(null), outMs)
    return () => clearTimeout(gone)
  }, [phase, outMs])
  if (open) return "open"
  return phase === "open" ? "closed" : phase
}
