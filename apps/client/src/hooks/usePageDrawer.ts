import { useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"

/**
 * Whether the phone drawer is open. A navigation closes it once the new page has been drawn behind it, so its
 * slide runs on an idle page instead of competing with the page's first render (which made it stutter). The
 * router leaves the drawer's scroll position alone meanwhile: see mayRestoreScroll.
 */
export function usePageDrawer(): { open: boolean; setOpen(open: boolean): void } {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    let frame = 0
    const unsubscribe = router.subscribe("onRendered", () => {
      frame = requestAnimationFrame(() => setOpen(false))
    })
    return () => {
      unsubscribe()
      cancelAnimationFrame(frame)
    }
  }, [open, router])
  return { open, setOpen }
}
