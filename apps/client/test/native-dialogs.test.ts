import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..", "..")
/** The dashboard, the extension's pages and the shared components. */
const DIRS = ["apps/client/src", "apps/extension/entrypoints", "apps/extension/lib", "packages/ui/src"]

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/**
 * window.alert, window.confirm and window.prompt, and a bare alert(…) or prompt(…). A bare confirm(…) is left
 * alone: the app's own useConfirm and the extension's confirm step are called that.
 */
const NATIVE = /\bwindow\.(?:alert|confirm|prompt)\s*\(|(?<![\w.])(?:alert|prompt)\s*\(/

describe("dialogs", () => {
  test("nothing uses the browser's own alert, confirm or prompt: the app asks in its own dialogs", () => {
    const offenders = DIRS.flatMap((dir) => sources(join(ROOT, dir)))
      .filter((path) => NATIVE.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
    expect(offenders).toEqual([])
  })
})
