import { mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type BrowserContext, chromium, expect, type Frame, type Locator, type Page, type Worker } from "@playwright/test"
import type { CapturePrefs } from "../lib/capture-prefs"

declare const chrome: {
  tabs: {
    query(filter: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>
  }
  runtime: { sendMessage(message: unknown): Promise<unknown> }
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } }
}

export interface E2EState {
  serverUrl: string
  token: string
  demoUrl: string
  sessionCookie: { name: string; value: string }
}

export interface Harness {
  context: BrowserContext
  worker: Worker
  extensionId: string
  state: E2EState
  /** The Acme Store checkout (`/shop` on the demo server): the page every overlay picture is taken on. */
  shop: Page
}

const extensionPath = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))
const OUT = fileURLToPath(new URL("../../docs/public/screenshots/", import.meta.url))

/** Chromium with the built extension, signed in to the E2E server by cookie, on the shop page. */
export async function launch(): Promise<Harness> {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as E2EState
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    // The real window's size and scale, not an emulated viewport: the extension's own capture
    // (captureVisibleTab, tab recording) sees the window, and would cut an emulated page short.
    viewport: null,
    colorScheme: "light",
    reducedMotion: "reduce",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--window-size=1280,900",
      "--force-device-scale-factor=2",
    ],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  const shop = context.pages()[0] ?? (await context.newPage())
  await shop.goto(new URL("/shop", state.demoUrl).href)
  return { context, worker, extensionId, state, shop }
}

/** The shop's tab id, as the extension knows it. */
export async function shopTabId(h: Harness, from: Page): Promise<number> {
  const url = h.shop.url()
  const id = await from.evaluate(async (shopUrl) => (await chrome.tabs.query({ url: shopUrl }))[0]?.id, url)
  if (id === undefined) throw new Error("The shop tab is not known to the extension")
  return id
}

/**
 * The toolbar popup, as a page of its own at the popup's width. Opened as a tab it would take itself for the
 * reporter's tab, so its "active tab" lookup is pointed at the shop: the popup itself is the real one.
 */
export async function openPopup(h: Harness, prefs: Partial<CapturePrefs> = {}): Promise<Page> {
  // Not resized: emulating a size drops the window's 2× scale. The popup's body is 380 px wide by itself.
  const page = await h.context.newPage()
  const shopUrl = h.shop.url()
  await page.addInitScript((url) => {
    const query = chrome.tabs.query.bind(chrome.tabs)
    chrome.tabs.query = (filter) => (filter.active && filter.currentWindow ? query({ url }) : query(filter))
  }, shopUrl)
  await page.goto(`chrome-extension://${h.extensionId}/popup.html`)
  await page.evaluate(async (patch) => {
    const key = "capturePrefs"
    const current = ((await (chrome.storage.local as unknown as { get(k: string): Promise<Record<string, unknown>> }).get(key))[key] ?? {}) as object
    await chrome.storage.local.set({ [key]: { ...current, ...patch } })
  }, prefs)
  await page.reload()
  await page.getByRole("radiogroup", { name: "Screenshot" }).waitFor()
  await page.waitForLoadState("networkidle")
  return page
}

/** Writes a picture to apps/docs/public/screenshots/<file>. A popup page is cut to the popup's own height. */
export async function shot(
  target: Page | Locator,
  file: `${string}/${string}.png`,
  options: { clip?: { x: number; y: number; width: number; height: number } } = {},
): Promise<void> {
  const path = `${OUT}${file}`
  mkdirSync(dirname(path), { recursive: true })
  const common = { path, animations: "disabled", caret: "hide", scale: "device" } as const
  if ("goto" in target) {
    const popup = target.url().endsWith("/popup.html")
    const clip = options.clip ?? (popup ? ((await target.locator("main").first().boundingBox()) ?? undefined) : undefined)
    await target.screenshot({ ...common, clip })
  } else {
    await target.screenshot(common)
  }
}

/** The review over the shop, in an extension iframe inside a closed shadow root: found by its URL. */
export async function reviewFrame(h: Harness): Promise<Frame> {
  const find = () => h.shop.frames().find((frame) => frame.url().includes("/review.html"))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const review = find()!
  await review.getByRole("dialog").first().waitFor()
  await h.shop.waitForTimeout(800)
  return review
}

/** `chrome.runtime.sendMessage` from an extension page, as the popup would. Not awaited by the page. */
export async function send(from: Page, message: unknown): Promise<unknown> {
  return from.evaluate((m) => chrome.runtime.sendMessage(m), message)
}
