import { useCallback, useSyncExternalStore } from "react"

/** Whether a CSS media query matches now, kept current as the window changes. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {}
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  )
}

/** Phones: below Tailwind's md breakpoint. */
export const PHONE_QUERY = "(max-width: 767px)"
