import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const FOLDERS = new Set(["ai", "annotate", "capture", "devices", "drafts", "platform", "prompts", "recording", "review", "server", "shared"])
const MAX_LINES = 500
/** Files split for length; each stays under MAX_LINES. */
const SPLIT: string[] = ["lib/recording/recording-flow.ts"]

type Entry = { name: string; folder: boolean }

/** Entries of lib/ or test/ that sit outside the feature folders. */
function misplaced(dir: "lib" | "test", entries: Entry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.folder) return FOLDERS.has(entry.name) ? [] : [`${entry.name}/`]
    return dir === "test" && entry.name === "setup.ts" ? [] : [entry.name]
  })
}

/** Counts lines the way `wc -l` does. */
function tooLong(text: string): boolean {
  return text.split("\n").length - 1 > MAX_LINES
}

const entries = (dir: string): Entry[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))

describe("structure", () => {
  test("lib/ and test/ hold only feature folders", () => {
    expect([...misplaced("lib", entries("lib")), ...misplaced("test", entries("test"))]).toEqual([])
  })

  test("split files stay under the line ceiling", () => {
    const long = SPLIT.filter((path) => {
      try {
        return tooLong(readFileSync(join(ROOT, path), "utf8"))
      } catch {
        return true
      }
    })
    expect(long).toEqual([])
  })

  test("the rules catch what they are for", () => {
    const file = (name: string): Entry => ({ name, folder: false })
    const folder = (name: string): Entry => ({ name, folder: true })
    expect(misplaced("lib", [file("new-thing.ts")])).toEqual(["new-thing.ts"])
    expect(misplaced("lib", [folder("misc")])).toEqual(["misc/"])
    expect(misplaced("lib", [folder("server")])).toEqual([])
    expect(misplaced("test", [file("setup.ts")])).toEqual([])
    expect(misplaced("test", [file("x.test.ts")])).toEqual(["x.test.ts"])
    expect(tooLong("a\n".repeat(501))).toBe(true)
    expect(tooLong("a\n".repeat(500))).toBe(false)
  })
})
