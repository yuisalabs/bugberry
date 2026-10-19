import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = join(import.meta.dir, "..", "..", "..")
/** Where the words people read live: the dashboard, the extension, the server's messages and emails, the player. */
const PLACES = ["apps/client/src", "apps/extension/entrypoints", "apps/extension/lib", "apps/api/src", "packages"]

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return ["node_modules", "dist", "test", ".output"].includes(entry.name) ? [] : sources(path)
    return /\.(tsx?|html|css)$/.test(entry.name) ? [path] : []
  })
}

/** The code without its comments (line, block and JSX ones), which nobody using BugBerry reads. */
function withoutComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

describe("copy", () => {
  test("no em-dash in anything people read", () => {
    const found = PLACES.flatMap((place) => sources(join(REPO, place))).flatMap((path) =>
      withoutComments(readFileSync(path, "utf8"))
        .split("\n")
        .filter((line) => line.includes("\u2014"))
        .map((line) => `${relative(REPO, path).replaceAll("\\", "/")}: ${line.trim()}`),
    )
    expect(found).toEqual([])
  })
})
