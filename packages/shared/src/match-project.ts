export interface ProjectWithPatterns {
  id: string
  urlPatterns: readonly string[]
}

function escapeGlob(glob: string, wildcard: string): string {
  return glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(wildcard)
}

/** In the host part `*` stays within the host, so `*.kantor.com` cannot match `evil.com/?x=a.kantor.com`. */
function globToRegExp(pattern: string): RegExp {
  const schemeEnd = pattern.indexOf("://")
  const hostStart = schemeEnd >= 0 ? schemeEnd + 3 : 0
  const pathStart = pattern.indexOf("/", hostStart)
  const head = pathStart >= 0 ? pattern.slice(0, pathStart) : pattern
  const tail = pathStart >= 0 ? pattern.slice(pathStart) : ""
  return new RegExp(`^${escapeGlob(head, "[^/]*")}${escapeGlob(tail, ".*")}$`, "i")
}

/** A pattern without a path (`app.kantor.com`) covers every path on that host. */
function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim()
  const withoutScheme = trimmed.replace(/^[a-z*]+:\/\//i, "")
  return withoutScheme.includes("/") ? trimmed : `${trimmed}/*`
}

function subjectFor(pattern: string, url: URL): string {
  const rest = `${url.host}${url.pathname}${url.search}`
  return pattern.includes("://") ? `${url.protocol}//${rest}` : rest
}

/**
 * Picks the project whose URL pattern matches the page. Patterns are globs (`*` = anything) matched
 * against `host/path?query`, or against the full URL when they include a scheme. The most specific
 * pattern (most literal characters) wins.
 */
export function matchProject<T extends ProjectWithPatterns>(projects: readonly T[], pageUrl: string): T | null {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  let best: { project: T; score: number } | null = null
  for (const project of projects) {
    for (const raw of project.urlPatterns) {
      if (!raw.trim()) continue
      const pattern = normalizePattern(raw)
      if (!globToRegExp(pattern).test(subjectFor(pattern, url))) continue
      const score = pattern.replaceAll("*", "").length
      if (!best || score > best.score) best = { project, score }
    }
  }
  return best?.project ?? null
}
