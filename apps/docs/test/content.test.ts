import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const CONTENT = join(import.meta.dir, "..", "content", "docs")

function mdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return mdxFiles(path)
    return name.endsWith(".mdx") ? [path] : []
  })
}

/** Internal links in a page: markdown `](/x)` and JSX `href="/x"`, without their anchor or query. */
function internalLinks(source: string): string[] {
  const links = [...source.matchAll(/\]\((\/[^)\s]*)\)/g), ...source.matchAll(/href=["'](\/[^"']*)["']/g)].map((match) => match[1]!)
  return links.map((link) => link.replace(/[#?].*$/, ""))
}

function pageExists(link: string): boolean {
  const path = link.replace(/^\/+|\/+$/g, "")
  if (path === "") return existsSync(join(CONTENT, "index.mdx"))
  return existsSync(join(CONTENT, `${path}.mdx`)) || existsSync(join(CONTENT, path, "index.mdx"))
}

const pages = mdxFiles(CONTENT).map((file) => ({ name: relative(CONTENT, file), source: readFileSync(file, "utf8") }))

describe("docs content", () => {
  test("internal links point to existing pages", () => {
    const broken = pages.flatMap((page) =>
      internalLinks(page.source)
        .filter((link) => !link.startsWith("/docs/") && link !== "/docs")
        .filter((link) => !pageExists(link))
        .map((link) => `${page.name} → ${link}`),
    )
    expect(broken).toEqual([])
  })

  test("no link repeats the /docs base path", () => {
    const doubled = pages.flatMap((page) =>
      internalLinks(page.source)
        .filter((link) => link === "/docs" || link.startsWith("/docs/"))
        .map((link) => `${page.name} → ${link}`),
    )
    expect(doubled).toEqual([])
  })

  test("every meta.json lists only existing pages, and every page is listed", () => {
    const folders = [CONTENT, ...readdirSync(CONTENT).map((name) => join(CONTENT, name)).filter((path) => statSync(path).isDirectory())]
    for (const folder of folders) {
      const meta = JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")) as { pages: string[] }
      const entries = readdirSync(folder)
        .filter((name) => name !== "meta.json")
        .map((name) => name.replace(/\.mdx$/, ""))
      expect({ folder: relative(CONTENT, folder), pages: [...meta.pages].sort() }).toEqual({
        folder: relative(CONTENT, folder),
        pages: entries.sort(),
      })
    }
  })
})

describe("env reference", () => {
  const ROOT = join(import.meta.dir, "..", "..", "..")
  const reference = () => readFileSync(join(CONTENT, "self-host", "environment.mdx"), "utf8")
  const undocumented = (names: Iterable<string>) => [...new Set(names)].filter((name) => !reference().includes(`\`${name}\``)).sort()

  test("every variable in .env.docker.example is documented", () => {
    const example = readFileSync(join(ROOT, ".env.docker.example"), "utf8")
    const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!)
    expect(names.length).toBeGreaterThan(20)
    expect(undocumented(names)).toEqual([])
  })

  test("every variable the server reads is documented", () => {
    const config = readFileSync(join(ROOT, "apps", "api", "src", "config.ts"), "utf8")
    const read = [...config.matchAll(/(?:optional|required|integer|list)\("([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]!)
    const oauth = [...config.matchAll(/oauthClient\("([A-Z]+)"/g)].flatMap((match) => [`${match[1]}_CLIENT_ID`, `${match[1]}_CLIENT_SECRET`])
    const names = [...read, ...oauth].filter((name) => name !== "NODE_ENV")
    expect(names.length).toBeGreaterThan(20)
    expect(undocumented(names)).toEqual([])
  })
})
