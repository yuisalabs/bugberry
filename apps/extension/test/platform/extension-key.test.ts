import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extensionIdFromPublicKey } from "../../lib/platform/manifest"

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "extension-key.ts")

function run(pemPath: string | null, cwd?: string) {
  const result = Bun.spawnSync(["bun", SCRIPT, ...(pemPath ? [pemPath] : [])], { cwd })
  const output = result.stdout.toString()
  const key = output.match(/^VITE_EXTENSION_KEY=(\S+)$/m)?.[1]
  const id = output.match(/^EXTENSION_ID=([a-p]{32})$/m)?.[1]
  return { exitCode: result.exitCode, key, id }
}

describe("extension-key script", () => {
  test("creates a key once and reads the same key back later", () => {
    const pemPath = join(mkdtempSync(join(tmpdir(), "bugberry-key-")), "bugberry-extension.pem")
    const first = run(pemPath)
    expect(first.exitCode).toBe(0)
    expect(existsSync(pemPath)).toBe(true)
    expect(first.id).toBe(extensionIdFromPublicKey(first.key ?? ""))

    const again = run(pemPath)
    expect(again).toEqual(first)
  })

  test("without a path, a team's older fdebag-extension.pem keeps its extension ID", () => {
    const dir = mkdtempSync(join(tmpdir(), "bugberry-key-"))
    const legacy = run(join(dir, "fdebag-extension.pem"))
    expect(run(null, dir)).toEqual(legacy)
    expect(existsSync(join(dir, "bugberry-extension.pem"))).toBe(false)
  })

  test("without a path, a new key is bugberry-extension.pem", () => {
    const dir = mkdtempSync(join(tmpdir(), "bugberry-key-"))
    expect(run(null, dir).exitCode).toBe(0)
    expect(existsSync(join(dir, "bugberry-extension.pem"))).toBe(true)
  })
})
