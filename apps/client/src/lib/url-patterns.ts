import { matchingPattern } from "@bugberry/shared"

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

/** Whether these patterns would send a bug recorded on `input` to the project. A missing scheme reads as https. */
export function testUrl(patterns: readonly string[], input: string): UrlTest {
  const text = input.trim()
  if (!text) return { status: "empty" }
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    new URL(url)
  } catch {
    return { status: "invalid" }
  }
  const pattern = matchingPattern(cleanPatterns(patterns), url)
  return pattern ? { status: "match", pattern } : { status: "none" }
}
