import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { render, screen } from "@testing-library/react"
import { BugBerryLogo } from "../src/components/BugBerryLogo"
import { ReportHeader } from "../src/features/reports/detail/ReportHeader"

const APP = join(import.meta.dir, "..")
const LOGO = "/assets/bugberry_logo_small.webp"
const ICON = "/assets/bugberry_icon_small.webp"

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

describe("the BugBerry logo", () => {
  test("the icon with the name is the one logo image, which names the product", () => {
    render(<BugBerryLogo />)
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual([LOGO])
    expect(screen.getByRole("img", { name: "BugBerry" }).getAttribute("src")).toBe(LOGO)
  })

  test("the icon alone carries the name itself", () => {
    render(<BugBerryLogo withWordmark={false} />)
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual([ICON])
    expect(screen.getByRole("img", { name: "BugBerry" }).getAttribute("src")).toBe(ICON)
  })

  test("a flex column (the landing footer) cannot stretch it out of shape: the image sits in its own inline box", () => {
    for (const withWordmark of [true, false]) {
      const { container, unmount } = render(
        <div className="flex flex-col">
          <BugBerryLogo withWordmark={withWordmark} />
        </div>,
      )
      const box = container.firstElementChild?.firstElementChild
      expect(box?.tagName).toBe("SPAN")
      expect(box?.className).toContain("inline-flex")
      expect(box?.querySelector("img")).toBeTruthy()
      unmount()
    }
  })

  test("the share page's header, which has no way back to the reports, shows the logo", () => {
    render(<ReportHeader back={null}>{null}</ReportHeader>)
    expect(screen.getByRole("img", { name: "BugBerry" }).getAttribute("src")).toBe(LOGO)
  })

  test("only the small copies are used, never the old mark or the originals", () => {
    const wrong = sources(join(APP, "src")).flatMap((path) => {
      const text = readFileSync(path, "utf8")
      const name = relative(APP, path).replaceAll("\\", "/")
      return [/bugberry-mark\.svg|bugberry-logo\.webp|bugberry-typeface\.webp|_original\.webp|_full\.webp/.exec(text)?.[0]]
        .filter(Boolean)
        .map((hit) => `${name}: ${hit}`)
    })
    expect(wrong).toEqual([])
  })

  test("the small copies are small", () => {
    for (const file of [LOGO, ICON]) expect(statSync(join(APP, "public", file)).size).toBeLessThan(60_000)
  })
})
