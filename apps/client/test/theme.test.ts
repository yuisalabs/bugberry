import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", ...parts), "utf8")

describe("BugBerry theme", () => {
  test("the theme uses BugBerry's colours and fonts", () => {
    // The theme is shared with the extension, in packages/ui.
    const css = read("..", "..", "packages", "ui", "src", "theme.css")
    const start = css.indexOf(":root")
    const root = css.slice(start, css.indexOf("}", start))
    for (const [token, value] of [
      ["--primary", "#D61F69"],
      ["--foreground", "#1C1022"],
      ["--muted-foreground", "#635A6B"],
      ["--border", "#E6E1EC"],
      ["--danger", "#E5484D"],
    ]) {
      expect(root).toContain(`${token}: ${value};`)
    }
    expect(css).toContain('"DM Sans Variable"')
    expect(css).toContain('"Sora Variable"')
    expect(css).not.toContain("Outfit")
    expect(css).not.toContain("Inter Variable")
  })

  test("headings are Sora in the dashboard and the extension; code stays Geist Mono, notes stay Caveat", () => {
    const client = read("src", "styles.css")
    const extension = read("..", "extension", "assets", "style.css")
    for (const css of [client, extension]) {
      for (const font of ["sora", "dm-sans", "geist-mono"]) expect(css).toContain(`@fontsource-variable/${font}`)
      expect(css).not.toContain("outfit")
    }
    expect(client).toContain("@fontsource-variable/caveat")
  })

  test("the browser tab says BugBerry", () => {
    const html = read("index.html")
    expect(html).toContain("<title>BugBerry</title>")
    // The berry icon as the tab's favicon (and on a phone's home screen), not the old mark.
    expect(html).toContain('<link rel="icon" type="image/png" href="/assets/favicon.png" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />')
    expect(html).not.toContain("favicon.svg")
  })

  test("the favicon files are the berry, at the sizes browsers ask for", () => {
    const size = (file: string) => {
      const png = readFileSync(join(import.meta.dir, "..", "public", "assets", file))
      expect(png.subarray(1, 4).toString()).toBe("PNG")
      return [png.readUInt32BE(16), png.readUInt32BE(20)]
    }
    expect(size("favicon.png")).toEqual([64, 64])
    expect(size("apple-touch-icon.png")).toEqual([180, 180])
  })
})
