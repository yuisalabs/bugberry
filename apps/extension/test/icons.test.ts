import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx$/.test(entry.name) ? [path] : []
  })
}

describe("icons", () => {
  test("the popup, the recording bar and the review use Remix Icon, not shapes drawn by hand", () => {
    const drawn = ["entrypoints", "components"]
      .flatMap((dir) => {
        try {
          return sources(join(ROOT, dir))
        } catch {
          return []
        }
      })
      .filter((path) => readFileSync(path, "utf8").includes("<svg"))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
    expect(drawn).toEqual([])
  })

  test("the package list carries Remix Icon", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> }
    expect(manifest.dependencies["@remixicon/react"]).toBe("4.9.0")
  })
})
