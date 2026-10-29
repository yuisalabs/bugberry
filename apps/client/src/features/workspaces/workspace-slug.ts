import { RESERVED_WORKSPACE_SLUGS, WORKSPACE_SLUG_PATTERN } from "@bugberry/shared"
import { useEffect, useRef, useState } from "react"
import { slugCheck } from "./queries"

export type SlugStatus = "checking" | "available" | "taken" | "invalid" | "reserved"
export type SlugAnswer = { slug: string; available: boolean; reason: "taken" | "invalid" | "reserved" | null }
type SlugQuery = { name?: string; slug?: string; except?: string }

const PATTERN = new RegExp(WORKSPACE_SLUG_PATTERN)
const RESERVED: ReadonlySet<string> = new Set(RESERVED_WORKSPACE_SLUGS)
const DEBOUNCE_MS = 300
const askServer = (query: SlugQuery) => slugCheck(query)

/** A rule break the browser can see without asking the server. */
export function localSlugProblem(slug: string): "invalid" | "reserved" | null {
  if (!PATTERN.test(slug)) return "invalid"
  return RESERVED.has(slug) ? "reserved" : null
}

/**
 * The Workspace URL field's state. While the person has not typed their own URL, the server suggests a
 * free one from the name; once they have, their URL is checked as typed.
 */
export function useSlugCheck(
  input: { name: string; slug: string; edited: boolean; except?: string },
  check: (query: SlugQuery) => Promise<SlugAnswer> = askServer,
): { slug: string; status: SlugStatus } {
  // Held in a ref: a caller's new function on each render must not start another request.
  const checkRef = useRef(check)
  checkRef.current = check
  const { name, slug, edited, except } = input
  const local = edited ? localSlugProblem(slug) : null
  const [answer, setAnswer] = useState<{ key: string; slug: string; status: SlugStatus } | null>(null)
  const key = edited ? `slug:${slug}` : `name:${name}`

  useEffect(() => {
    if (local || (!edited && !name.trim())) return
    let cancelled = false
    const timer = setTimeout(() => {
      const query: SlugQuery = edited ? { slug } : { name }
      if (except) query.except = except
      checkRef.current(query)
        .then((result) => {
          if (cancelled) return
          setAnswer({ key, slug: result.slug, status: result.available ? "available" : (result.reason ?? "taken") })
        })
        .catch(() => {})
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, local, edited, name, slug, except])

  if (local) return { slug, status: local }
  if (answer?.key !== key) return { slug: edited ? slug : (answer?.slug ?? slug), status: "checking" }
  return { slug: answer.slug, status: answer.status }
}
