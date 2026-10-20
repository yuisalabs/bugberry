import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const styles = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")

describe("the DevTools width variable", () => {
  test("is not inherited, so a drag restyles the page grid alone, not every row inside the panel", () => {
    const rule = styles.match(/@property\s+--devtools-width\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(rule).toContain("inherits: false")
  })
})
