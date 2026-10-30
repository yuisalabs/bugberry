import { RiCloseLine } from "@remixicon/react"
import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { browser } from "wxt/browser"
import type { PromptPage, PromptTicketRequest } from "../shared/messages"

/** Where a prompt page runs: over a page (an iframe) or in a tab of its own, and the ticket naming what it asks. */
export function promptParams(search: string): { token: string; embedded: boolean } {
  const params = new URLSearchParams(search)
  return { token: params.get("prompt") ?? "", embedded: params.get("embedded") === "1" }
}

/** Over a page the frame stays see-through, so the page shows dimmed behind the prompt. */
export function clearEmbeddedBackground(embedded: boolean) {
  if (!embedded) return
  document.documentElement.style.background = "transparent"
  document.body.style.background = "transparent"
}

const ask = (token: string, action: PromptTicketRequest["action"]) =>
  browser.runtime.sendMessage({ type: "bugberry:prompt-ticket", token, action } satisfies PromptTicketRequest).catch(() => null)

/** What the ticket asks; null while asking, "invalid" for an unknown, expired or foreign ticket. */
export function usePromptTicket(token: string, page: PromptPage): { server: string | null } | "invalid" | null {
  const [ticket, setTicket] = useState<{ server: string | null } | "invalid" | null>(null)
  useEffect(() => {
    void ask(token, "read").then((reply) => {
      const read = reply as { page?: unknown; server?: unknown } | null
      setTicket(read?.page === page ? { server: typeof read.server === "string" ? read.server : null } : "invalid")
    })
  }, [token, page])
  return ticket
}

/** Takes the prompt away: off the page, or the tab closes. `then` "tab" asks again in a tab of its own. */
export async function closePrompt(token: string, embedded: boolean, then: "done" | "tab" = "done") {
  await ask(token, then)
  if (embedded) window.parent.postMessage({ bugberry: "prompt-close" }, "*")
  else window.close()
}

interface VisibilityEntry extends IntersectionObserverEntry {
  isVisible?: boolean
}

/**
 * Over someone else's page, whether `target` is really seen: nothing drawn over it, not faded or transformed
 * (IntersectionObserver v2). A page could otherwise hide the prompt under its own look-alike and pass the
 * click through. Always true in a tab of its own, and where the browser can't tell.
 */
export function useUnobscured(target: RefObject<HTMLElement | null>, embedded: boolean): boolean {
  const [visible, setVisible] = useState(!embedded)
  useEffect(() => {
    const element = target.current
    if (!embedded || !element) return
    const options = { threshold: [1], trackVisibility: true, delay: 100 } as IntersectionObserverInit
    let observer: IntersectionObserver
    try {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.at(-1) as VisibilityEntry | undefined
        if (entry) setVisible(entry.isVisible ?? true)
      }, options)
    } catch {
      setVisible(true)
      return
    }
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, embedded])
  return visible
}

/**
 * Shown while the page seems to cover the prompt: its buttons stay off, but the reporter isn't stuck, the same
 * prompt opens in a tab of its own.
 */
export function CoveredNote({ token }: { token: string }) {
  // Not during the first check (the browser answers after about 100 ms), so it doesn't flash on every prompt.
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 800)
    return () => clearTimeout(timer)
  }, [])
  if (!late) return null
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
      Something on this page covers BugBerry.
      <button type="button" className="font-semibold underline" onClick={() => void closePrompt(token, true, "tab")}>
        Open in a tab
      </button>
    </p>
  )
}

/** The prompt's card: centred over the dimmed page, or on its own in a tab. */
export function PromptShell({
  embedded,
  labelledBy,
  onClose,
  children,
}: {
  embedded: boolean
  labelledBy: string
  /** Shows a × in the corner. */
  onClose?: () => void
  children: ReactNode
}) {
  return (
    <div className={embedded ? "fixed inset-0 flex items-center justify-center bg-foreground/45 p-6" : "flex min-h-screen items-center justify-center bg-muted p-6"}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl bg-overlay p-7 text-overlay-foreground shadow-2xl ring ring-muted-foreground/25"
      >
        <div className="flex items-center justify-between">
          <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className="h-6 w-auto object-contain" />
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground ring-1 ring-border hover:bg-secondary hover:text-foreground"
            >
              <RiCloseLine size={16} aria-hidden />
            </button>
          )}
        </div>
        {children}
      </section>
    </div>
  )
}
