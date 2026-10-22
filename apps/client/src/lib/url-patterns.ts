import { matchingPattern, matchProject } from "@bugberry/shared"

/** The server's limits on a project's URL patterns. */
export const MAX_PATTERNS = 20
export const MAX_PATTERN_LENGTH = 200

/** The patterns worth saving: trimmed, without blanks or repeats, in the order typed. */
export function cleanPatterns(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))]
}

/** "Save 2 patterns", or "Save" when the list was emptied. */
export function savePatternsLabel(count: number): string {
  if (count === 0) return "Save"
  return `Save ${count} ${count === 1 ? "pattern" : "patterns"}`
}

/** The host a pattern names, without a scheme, `*.` or path; null for a pattern that is only a wildcard. */
function hostOf(pattern: string): string | null {
  const host = pattern
    .trim()
    .replace(/^[a-z*]+:\/\//i, "")
    .split("/")[0]
    ?.replace(/^\*\./, "")
    .replace(/:\d+$/, "")
  return host && !host.includes("*") ? host.toLowerCase() : null
}

/**
 * Three sample patterns built from the project's own domain (the first pattern's host), so the examples read
 * as this project's site; example.com while there is none.
 */
export function patternExamples(patterns: readonly string[]): Array<{ pattern: string; meaning: string }> {
  const host = patterns.map(hostOf).find((value): value is string => value !== null) ?? "app.example.com"
  const labels = host.split(".")
  const domain = labels.length > 2 && !/^\d+$/.test(labels.at(-1) ?? "") ? labels.slice(-2).join(".") : host
  const app = host === domain ? `app.${domain}` : host
  return [
    { pattern: `${domain}/*`, meaning: `every page on ${domain}` },
    { pattern: `*.${domain}/*`, meaning: "every subdomain, like app. or staging." },
    { pattern: `${app}/checkout*`, meaning: "only checkout pages" },
  ]
}

export type UrlTest = { status: "empty" } | { status: "invalid" } | { status: "none" } | { status: "match"; pattern: string }

/** `input` as a URL the patterns can be tried on: a missing scheme reads as https. Null for something that isn't one. */
function asUrl(input: string): string | null {
  const text = input.trim()
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    new URL(url)
    return url
  } catch {
    return null
  }
}

export type ProjectUrlTest<T> =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "none" }
  | { status: "match"; project: T; pattern: string }

/** Which project the extension would file a bug recorded on `input` under, and the pattern that decides it. */
export function testProjects<T extends { id: string; urlPatterns: readonly string[] }>(projects: readonly T[], input: string): ProjectUrlTest<T> {
  if (!input.trim()) return { status: "empty" }
  const url = asUrl(input)
  if (!url) return { status: "invalid" }
  const project = matchProject(projects, url)
  const pattern = project && matchingPattern(project.urlPatterns, url)
  return project && pattern ? { status: "match", project, pattern } : { status: "none" }
}

/** The pattern that catches a page and everything under it: `staging.quinella.ai/checkout*`, or `blog.test/*` for a host. */
export function patternForPage(page: string): string {
  return page.includes("/") ? `${page}*` : `${page}/*`
}

/** Whether these patterns would send a bug recorded on `input` to the project. A missing scheme reads as https. */
export function testUrl(patterns: readonly string[], input: string): UrlTest {
  if (!input.trim()) return { status: "empty" }
  const url = asUrl(input)
  if (!url) return { status: "invalid" }
  const pattern = matchingPattern(cleanPatterns(patterns), url)
  return pattern ? { status: "match", pattern } : { status: "none" }
}
