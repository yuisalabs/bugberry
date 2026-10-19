import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(import.meta.dir, "..", "src")
/** Intent UI's own files, and the categorical status/priority colours, may name palette colours. */
const ALLOWED = new Set(["lib/labels.ts"])
const PALETTE = /\b[a-z:-]*-(slate|gray|zinc|sky|blue|red|amber|yellow|orange|emerald|green)-\d{2,3}\b|\bbg-white\b/g

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return path.endsWith(join("components", "ui")) ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe("theme", () => {
  test("pages and components use Intent UI's theme tokens, not hard-coded palette colours", () => {
    const leftovers = sources(SRC).flatMap((path) => {
      const name = relative(SRC, path).replaceAll("\\", "/")
      if (ALLOWED.has(name)) return []
      return [...readFileSync(path, "utf8").matchAll(PALETTE)].map((match) => `${name}: ${match[0]}`)
    })
    expect(leftovers).toEqual([])
  })
})
