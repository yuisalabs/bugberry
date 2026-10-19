const PLACEHOLDER_ORIGIN = "http://bugberry.invalid"

/**
 * Where to go after login. Only same-site paths are allowed, so `/login?next=` cannot bounce
 * people to another site, and never back to /login itself.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/app"
  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return "/app"
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname === "/login") return "/app"
  return `${url.pathname}${url.search}${url.hash}`
}

/** The URL as a link target, or null unless it is plain http(s). */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

export function shareUrl(slug: string, origin = window.location.origin): string {
  return `${origin}/s/${encodeURIComponent(slug)}`
}

export function reportUrl(id: string, origin = window.location.origin): string {
  return `${origin}/app/r/${encodeURIComponent(id)}`
}

/** The share link that starts the video at `seconds` (whole seconds; the start needs no parameter). */
export function shareUrlAt(slug: string, seconds: number, origin = window.location.origin): string {
  const at = Math.floor(seconds)
  return at > 0 ? `${shareUrl(slug, origin)}?t=${at}` : shareUrl(slug, origin)
}

/** The `?t=` of a shared "at 0:03" link, in whole seconds; undefined when missing or nonsense. */
export function startSecondsFrom(search: Record<string, unknown>): number | undefined {
  const value = Number(search.t)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}
