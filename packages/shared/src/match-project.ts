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

/** The pattern that catches `url` and how specific it is (literal characters), if any does. */
function bestPattern(patterns: readonly string[], url: URL): { pattern: string; score: number } | null {
  let best: { pattern: string; score: number } | null = null
  for (const raw of patterns) {
    if (!raw.trim()) continue
    const pattern = normalizePattern(raw)
    if (!globToRegExp(pattern).test(subjectFor(pattern, url))) continue
    const score = pattern.replaceAll("*", "").length
    if (!best || score > best.score) best = { pattern: raw.trim(), score }
  }
  return best
}

function parseUrl(pageUrl: string): URL | null {
  try {
    return new URL(pageUrl)
  } catch {
    return null
  }
}

/**
 * Picks the project whose URL pattern matches the page. Patterns are globs (`*` = anything) matched
 * against `host/path?query`, or against the full URL when they include a scheme. The most specific
 * pattern (most literal characters) wins.
 */
export function matchProject<T extends ProjectWithPatterns>(projects: readonly T[], pageUrl: string): T | null {
  const url = parseUrl(pageUrl)
  if (!url) return null
  let best: { project: T; score: number } | null = null
  for (const project of projects) {
    const found = bestPattern(project.urlPatterns, url)
    if (found && (!best || found.score > best.score)) best = { project, score: found.score }
  }
  return best?.project ?? null
}

/** Which of these patterns catches the page, by the same rules as matchProject; null for none or a bad URL. */
export function matchingPattern(patterns: readonly string[], pageUrl: string): string | null {
  const url = parseUrl(pageUrl)
  return url ? (bestPattern(patterns, url)?.pattern ?? null) : null
}
