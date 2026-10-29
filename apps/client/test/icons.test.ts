import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(import.meta.dir, "..", "src")
/**
 * Drawn by hand on purpose: the sign-in buttons' brand logos, and Intent UI's own shapes (the avatar's
 * placeholder, the spinner, the popover's and tooltip's arrows, the empty table's picture and drag handle), and the
 * status pages' drawings (their hand-drawn arrows and the 504's vines).
 */
const OWN_SVG = new Set([
  "features/auth/LoginView.tsx",
  "components/ui/avatar.tsx",
  "components/ui/loader.tsx",
  "components/ui/popover.tsx",
  "components/ui/tooltip.tsx",
  "components/ui/table.tsx",
  "components/status/StatusFrame.tsx",
  "components/status/StatusPage.tsx",
])

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const files = () => sources(SRC).map((path) => ({ name: relative(SRC, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }))

describe("icons", () => {
  test("every icon comes from Remix Icon: nothing imports Heroicons", () => {
    expect(files().filter((file) => file.text.includes("@heroicons/")).map((file) => file.name)).toEqual([])
  })

  test("no icon is drawn by hand outside the logos and Intent UI's own shapes", () => {
    expect(files().filter((file) => !OWN_SVG.has(file.name) && file.text.includes("<svg")).map((file) => file.name)).toEqual([])
  })

  test("the package list carries Remix Icon, not Heroicons", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { dependencies: Record<string, string> }
    expect(manifest.dependencies["@remixicon/react"]).toBe("4.9.0")
    expect(manifest.dependencies["@heroicons/react"]).toBeUndefined()
  })
})
