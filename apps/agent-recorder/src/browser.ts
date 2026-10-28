import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { type BrowserContext, chromium } from "playwright-core"
import { extensionIdFromPublicKey } from "../../extension/lib/manifest"
import type { RecorderOptions } from "./options"

/** Matches playwright-core in package.json: the Chromium build it drives. */
const PLAYWRIGHT_VERSION = "1.64.1"
/** Headless Chromium otherwise draws an 800×600 page, too small to show most apps. */
const HEADLESS_VIEWPORT = { width: 1280, height: 800 }

export class PortUnavailableError extends Error {
  constructor(readonly port: number) {
    super(
      `Port ${port} is not available: another program uses it, or it is reserved by Windows (Hyper-V). Start the ` +
        `recorder with --port <another port>, and set --cdp-endpoint http://127.0.0.1:<that port> in the bugberry-browser ` +
        "server to the same port.",
    )
    this.name = "PortUnavailableError"
  }
}

export interface BrowserSession {
  context: BrowserContext
  extensionId: string
  port: number
  close(): Promise<void>
}

export interface LaunchDeps {
  chromium: Pick<typeof chromium, "executablePath"> & {
    launchPersistentContext(dir: string, options: Parameters<typeof chromium.launchPersistentContext>[1]): Promise<BrowserContext>
  }
  exists(path: string): boolean
}

/** Chromium refuses to open a debugging port it can't bind, without saying so; asked first, the agent learns why. */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", () => reject(new PortUnavailableError(port)))
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()))
  })
}

/** The extension's ID from the public key in its manifest, the same rule Chrome uses. */
function extensionIdOf(extensionDir: string): string {
  const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8")) as { key?: string }
  if (!manifest.key) throw new Error(`The extension in ${extensionDir} has no key: it is not the recorder build.`)
  return extensionIdFromPublicKey(manifest.key)
}

/**
 * Chromium with the recorder build of the extension, on the kept profile, with its debugging port open for the
 * agent's browser tool. Tab recording needs a click on the extension that automation can't make, so the extension
 * is allowlisted: Chrome then lets it record a tab it names.
 */
export async function launchBrowser(
  opts: RecorderOptions,
  extensionDir: string,
  deps: LaunchDeps = { chromium, exists: existsSync },
): Promise<BrowserSession> {
  if (!deps.exists(deps.chromium.executablePath())) {
    throw new Error(`Chromium for the recorder is not installed. Run: npx playwright@${PLAYWRIGHT_VERSION} install chromium`)
  }
  if (!deps.exists(join(extensionDir, "manifest.json"))) {
    throw new Error(`The BugBerry extension is missing from ${extensionDir}. Reinstall @bugberry/recorder.`)
  }
  await assertPortFree(opts.port)
  const extensionId = extensionIdOf(extensionDir)
  const context = await deps.chromium.launchPersistentContext(opts.profileDir, {
    headless: opts.headless,
    viewport: opts.headless ? HEADLESS_VIEWPORT : null,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--allowlisted-extension-id=${extensionId}`,
      `--remote-debugging-port=${opts.port}`,
      ...(opts.headless ? [] : ["--window-size=1280,900"]),
    ],
  })
  return { context, extensionId, port: opts.port, close: () => context.close() }
}
