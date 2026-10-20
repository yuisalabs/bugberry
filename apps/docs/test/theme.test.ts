import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const APP_THEME = readFileSync(join(import.meta.dir, "..", "..", "..", "packages", "ui", "src", "theme.css"), "utf8")
const DOCS_THEME = readFileSync(join(import.meta.dir, "..", "src", "app", "global.css"), "utf8")

/** The colours the docs take from the app; the rest of the app theme is not used here. */
const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "primary",
  "primary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "ring",
]

/** `--name: value;` pairs inside the first `<selector> {` block of a stylesheet. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return {}
  const block = css.slice(start, css.indexOf("}", start))
  const values: Record<string, string> = {}
  for (const name of TOKENS) {
    const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
    if (match) values[name] = match[1]!.trim()
  }
  return values
}

/**
 * The app never turns on dark mode, so its .dark primary is still Intent UI's blue. The docs use BugBerry's pink
 * there, a little lighter than #D61F69 so links stay readable on the dark background (about 4.9:1 instead of 3.8:1).
 */
const DOCS_DARK_PRIMARY = "#E8457F"

describe("docs theme", () => {
  test(":root colours match packages/ui/src/theme.css", () => {
    expect(Object.keys(tokens(APP_THEME, ":root"))).toEqual(TOKENS)
    expect(tokens(DOCS_THEME, ":root")).toEqual(tokens(APP_THEME, ":root"))
  })

  test(".dark colours match packages/ui/src/theme.css, except the pink primary", () => {
    expect(Object.keys(tokens(APP_THEME, ".dark"))).toEqual(TOKENS)
    expect(tokens(DOCS_THEME, ".dark")).toEqual({ ...tokens(APP_THEME, ".dark"), primary: DOCS_DARK_PRIMARY, ring: DOCS_DARK_PRIMARY })
  })
})
