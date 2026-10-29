import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DOCS_URL } from "../src/features/landing/docs-url"
import { PRODUCT_MENU } from "../src/features/landing/ProductMenu"

const DOCS = join(import.meta.dir, "..", "..", "docs", "content", "docs")

/** Fumadocs' anchor for a heading: lower case, punctuation dropped, spaces as dashes. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ +/g, "-")

describe("Product menu", () => {
  const items = PRODUCT_MENU.flatMap((column) => column.items)

  test("every feature opens the docs page that explains it", () => {
    for (const item of items) expect(item.href.startsWith(`${DOCS_URL}/`)).toBe(true)
  })

  test("each link lands on a docs page that exists, at a heading that exists", () => {
    for (const item of items) {
      const [path, anchor] = item.href.slice(DOCS_URL.length + 1).split("#")
      const file = join(DOCS, `${path}.mdx`)
      expect(existsSync(file)).toBe(true)
      if (anchor) {
        const headings = [...readFileSync(file, "utf8").matchAll(/^#{2,3} (.+)$/gm)].map((match) => slug(match[1]!))
        expect(headings).toContain(anchor)
      }
    }
  })
})
