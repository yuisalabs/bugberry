import { useEffect } from "react"

/** Asks before the page closes; returnValue is what Safari and Chromium before 119 look at. */
export function warnBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = true
}

/** Leaving with a recording not yet sent asks first. */
export function useLeaveWarning(on: boolean) {
  useEffect(() => {
    if (!on) return
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving)
  }, [on])
}
