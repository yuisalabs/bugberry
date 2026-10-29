import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"

/** How an element comes in; the CSS for each lives in styles.css, inside a no-preference motion query. */
export type RevealVariant = "up" | "down" | "blur" | "rise" | "fade"

export interface RevealOptions {
  variant?: RevealVariant
  /** Milliseconds to wait, so neighbours come in one after another. */
  delay?: number
  /** Play as soon as the page draws (the hero) instead of when scrolled into view. */
  immediate?: boolean
}

/** Part of an element counted as "in view": enough to be seen, so nothing plays off-screen. */
const IN_VIEW = 0.15
/** When frames have not come by then, the hero is shown anyway. */
const FRAME_FALLBACK_MS = 400

/**
 * Props that make an element come in once: on first show, or when it scrolls into view. Without an
 * IntersectionObserver it shows at once; people who asked for less motion get no animation from the CSS.
 */
export function useReveal({ variant = "up", delay = 0, immediate = false }: RevealOptions = {}) {
  const [shown, setShown] = useState(false)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!element || done.current) return
    const show = () => {
      done.current = true
      setShown(true)
    }
    if (immediate) {
      // One frame after the hidden state is drawn, so the browser has something to animate from. Frames are
      // held back in a tab opened in the background; the timer makes sure the hero still appears.
      let next = 0
      const first = requestAnimationFrame(() => {
        next = requestAnimationFrame(show)
      })
      const fallback = setTimeout(show, FRAME_FALLBACK_MS)
      return () => {
        cancelAnimationFrame(first)
        cancelAnimationFrame(next)
        clearTimeout(fallback)
      }
    }
    if (typeof IntersectionObserver === "undefined") {
      show()
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        show()
      },
      { threshold: IN_VIEW },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, immediate])

  const ref = useCallback((node: HTMLElement | null) => setElement(node), [])
  return {
    ref,
    "data-reveal": variant,
    "data-shown": shown ? "" : undefined,
    style: { "--reveal-delay": `${delay}ms` } as CSSProperties,
  }
}
