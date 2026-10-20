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

describe("docs theme", () => {
  for (const selector of [":root", ".dark"]) {
    test(`${selector} colours match packages/ui/src/theme.css`, () => {
      expect(Object.keys(tokens(APP_THEME, selector))).toEqual(TOKENS)
      expect(tokens(DOCS_THEME, selector)).toEqual(tokens(APP_THEME, selector))
    })
  }
})
