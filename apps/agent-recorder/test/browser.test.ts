import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"
import { extensionIdFromPublicKey } from "../../extension/lib/manifest"
import { launchBrowser, PortUnavailableError } from "../src/browser"
import type { RecorderOptions } from "../src/options"

const options = (port: number): RecorderOptions => ({ server: "https://bugs.kantor.test", port, headless: true, profileDir: "/tmp/profile" })

/** A launcher that must never be reached: these tests stop before Chromium starts. */
const noLaunch = {
  executablePath: () => "/chromium",
  launchPersistentContext: async () => {
    throw new Error("launched")
  },
}

describe("launchBrowser", () => {
  test("port in use names the port and both configs", async () => {
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve))
    const port = (taken.address() as { port: number }).port
    try {
      const failure = await launchBrowser(options(port), "/ext", { chromium: noLaunch, exists: () => true }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(PortUnavailableError)
      const message = (failure as Error).message
      for (const part of [String(port), "reserved by Windows", "--port", "bugberry-browser", "--cdp-endpoint"]) expect(message).toContain(part)
    } finally {
      taken.close()
    }
  })

  test("missing Chromium gives the install command", async () => {
    const failure = await launchBrowser(options(0), "/ext", { chromium: noLaunch, exists: (path) => path !== "/chromium" }).catch(
      (error: unknown) => error,
    )
    expect((failure as Error).message).toContain("npx playwright@1.64.1 install chromium")
  })

  test("waits for the extension to start, and says so when it never does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-"))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw1cm" }))
    let closed = false
    const context = {
      serviceWorkers: () => [],
      waitForEvent: async () => {
        throw new Error("Timeout")
      },
      close: async () => {
        closed = true
      },
    }
    const launcher = { executablePath: () => "/chromium", launchPersistentContext: async () => context as never }
    try {
      const failure = await launchBrowser(options(0), dir, { chromium: launcher, exists: () => true }).catch((error: unknown) => error)
      expect((failure as Error).message).toContain("The BugBerry extension didn't start")
      expect(closed).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("headless still launches full Chromium, which can load the extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-"))
    const key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw1cm"
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ key }))
    const seen: Array<Record<string, unknown>> = []
    const worker = { url: () => `chrome-extension://${extensionIdFromPublicKey(key)}/background.js` }
    const context = { serviceWorkers: () => [worker], close: async () => {} }
    const launcher = {
      executablePath: () => "/chromium",
      launchPersistentContext: async (_dir: string, launchOptions: unknown) => {
        seen.push(launchOptions as Record<string, unknown>)
        return context as never
      },
    }
    try {
      await launchBrowser(options(0), dir, { chromium: launcher, exists: () => true })
      expect(seen[0]).toMatchObject({ channel: "chromium", headless: true, viewport: { width: 1280, height: 800 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a missing extension build is named", async () => {
    const failure = await launchBrowser(options(0), "/ext", { chromium: noLaunch, exists: (path) => path === "/chromium" }).catch(
      (error: unknown) => error,
    )
    expect((failure as Error).message).toContain("/ext")
  })
})
