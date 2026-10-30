import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { archiveArgs, buildNotes, reviewSourcesName, SOURCE_PATHSPECS } from "../../scripts/zip-sources"

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url))

function trackedFiles(): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "--", ...SOURCE_PATHSPECS], { cwd: repoRoot })
  return listed.stdout.toString().split("\n").filter(Boolean)
}

describe("the sources zip for store reviewers", () => {
  test("holds what a build needs: the extension, the packages, the workspace files", () => {
    const files = trackedFiles()
    for (const needed of [
      "package.json",
      "bun.lock",
      // Tailwind skips what git ignores; without it a rebuild would scan .output and differ.
      ".gitignore",
      "tsconfig.base.json",
      "apps/extension/package.json",
      "apps/extension/wxt.config.ts",
      "apps/api/package.json",
      "packages/capture/package.json",
      "packages/ui/package.json",
      "packages/player/package.json",
      "packages/shared/package.json",
    ]) {
      expect(files).toContain(needed)
    }
  })

  test("never holds a key, an env file, or what the extension doesn't need", () => {
    const files = trackedFiles()
    expect(files.filter((file) => /\.pem$|(^|\/)\.env/.test(file))).toEqual([])
    expect(files.filter((file) => file.startsWith("apps/client/") || file.startsWith("docs/") || file.startsWith("deploy/"))).toEqual([])
  })

  test("git archive writes it from the commit, with the build notes inside", () => {
    const args = archiveArgs("0.2.4", "/tmp/out.zip", "notes")
    expect(args.slice(0, 4)).toEqual(["archive", "--format=zip", "--output=/tmp/out.zip", "--prefix=bugberry-0.2.4-sources/"])
    expect(args).toContain("--add-virtual-file=bugberry-0.2.4-sources/BUILD.md:notes")
    expect(args).toContain("HEAD")
    expect(args.slice(-SOURCE_PATHSPECS.length)).toEqual([...SOURCE_PATHSPECS])
  })

  test("its own file name, so the sources zip WXT writes next to each package never replaces it", () => {
    expect(reviewSourcesName("0.2.4")).toBe("bugberry-0.2.4-review-sources.zip")
  })

  test("the build notes say how to rebuild each store's package", () => {
    const notes = buildNotes("0.2.4")
    expect(notes).toContain("0.2.4")
    expect(notes).toContain("bun install")
    expect(notes).toContain("bun run zip:firefox")
    expect(notes).toContain("bun run zip:opera")
    expect(notes).toContain("VITE_SERVER_ORIGIN=https://bugberry.yuisalabs.com")
  })
})
