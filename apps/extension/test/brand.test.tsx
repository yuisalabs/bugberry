import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")
const LOGO = "/assets/bugberry_logo_small.webp"
const ICON = "/assets/bugberry_icon_small.webp"

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(tsx?|css|html)$/.test(entry.name) ? [path] : []
  })
}

const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8")

describe("the BugBerry logo in the extension", () => {
  test("the popup's header shows the logo, icon and name in one image", () => {
    const popup = read("entrypoints", "popup", "PopupView.tsx")
    expect(popup).toContain(`src="${LOGO}" alt="BugBerry"`)
  })

  test("the review and the prompts show the logo", () => {
    expect(read("entrypoints", "review", "ReviewView.tsx")).toContain(`src="${LOGO}" alt="BugBerry"`)
    expect(read("lib", "prompt-page.tsx")).toContain(`src="${LOGO}" alt="BugBerry"`)
  })

  test("nothing points at the old files", () => {
    const old = sources(join(ROOT, "entrypoints"))
      .filter((path) => /bugberry-mark\.svg|bugberry-logo\.webp|bugberry-typeface\.webp/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
    expect(old).toEqual([])
    expect(existsSync(join(ROOT, "public", "bugberry-logo.webp"))).toBe(false)
    expect(existsSync(join(ROOT, "public", "bugberry-typeface.webp"))).toBe(false)
  })

  test("the images ship as small copies", () => {
    for (const file of [LOGO, ICON]) expect(statSync(join(ROOT, "public", file)).size).toBeLessThan(60_000)
  })
})

describe("the extension's own icon", () => {
  test("the berry at every size Chrome shows it (toolbar, extensions page, install dialog), where WXT finds it", () => {
    for (const size of [16, 32, 48, 128]) {
      const png = readFileSync(join(ROOT, "public", "icon", `${size}.png`))
      expect(png.subarray(1, 4).toString()).toBe("PNG")
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
  })
})
