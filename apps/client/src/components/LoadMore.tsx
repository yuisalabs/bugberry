import { useEffect, useRef } from "react"
import { Button } from "@bugberry/ui/button"

/**
 * The end of a report list. When it scrolls into view the next part is asked for, once: nothing more is asked
 * while that part loads, after it fails (Try again asks), or once every report is shown. If the end is still in
 * view when a part arrives, the next one is asked for, so a tall window fills up one part at a time.
 */
export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  failed,
  onLoadMore,
}: {
  shown: number
  total: number
  hasMore: boolean
  loading: boolean
  failed: boolean
  onLoadMore(): void
}) {
  const end = useRef<HTMLDivElement>(null)
  const latest = useRef(onLoadMore)
  latest.current = onLoadMore
  const watching = hasMore && !loading && !failed

  useEffect(() => {
    const target = end.current
    if (!watching || !target || typeof IntersectionObserver === "undefined") return
    // A fresh observer for every part: it reports at once whether the end is already in view.
    let asked = false
    const observer = new IntersectionObserver((entries) => {
      if (asked || !entries.some((entry) => entry.isIntersecting)) return
      asked = true
      observer.disconnect()
      latest.current()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [watching, shown])

  return (
    <div ref={end} className="flex min-h-12 items-center justify-center py-4 text-sm text-muted-foreground">
      {loading ? (
        // The list shows placeholder cards above; this only tells screen readers.
        <span role="status" className="sr-only">
          Loading more reports…
        </span>
      ) : failed ? (
        <div className="flex items-center gap-3">
          <span>Couldn't load more reports.</span>
          <Button size="sm" intent="outline" onPress={onLoadMore}>
            Try again
          </Button>
        </div>
      ) : !hasMore && shown > 0 ? (
        <span>{`All ${total} ${total === 1 ? "report" : "reports"} shown`}</span>
      ) : null}
    </div>
  )
}
