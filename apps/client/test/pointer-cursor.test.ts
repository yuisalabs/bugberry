import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..", "..")
/** The dashboard, the extension's pages and the shared components. */
const DIRS = ["apps/client/src", "apps/extension/entrypoints", "packages/ui/src"]
/** Not clickable on their own: a table row (a clickable one sets cursor-pointer) and a plain tag. */
const STILL_DEFAULT = new Set(["packages/ui/src/table.tsx", "packages/ui/src/tag-group.tsx"])

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe("the pointer cursor", () => {
  test("the shared theme gives everything clickable the hand, and disabled things the arrow", () => {
    const theme = readFileSync(join(ROOT, "packages/ui/src/theme.css"), "utf8")
    for (const selector of ["button", '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="switch"]', "a[href]", "summary"]) {
      expect(theme).toContain(selector)
    }
    expect(theme).toContain("cursor: pointer")
    expect(theme).toMatch(/:disabled[^{]*\[data-disabled\][^{]*\{\s*cursor: default/)
  })

  test("no clickable control sets the arrow back (a plain cursor-default class)", () => {
    const offenders = DIRS.flatMap((dir) => sources(join(ROOT, dir)))
      .map((path) => ({ name: relative(ROOT, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }))
      // A variant such as disabled:cursor-default is fine; a bare one overrides the theme on a control.
      .filter((file) => !STILL_DEFAULT.has(file.name) && /(?<![\w:-])cursor-default\b/.test(file.text))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })
})
