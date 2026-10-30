import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type BrowserContext, chromium, expect, type Frame, type Locator, type Page, type Worker } from "@playwright/test"
import type { CapturePrefs } from "../lib/capture/capture-prefs"
import type { CameraChoice } from "../lib/shared/messages"

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
const DEBUG_PORT = 9333
const OUT = fileURLToPath(new URL("../../docs/public/screenshots/", import.meta.url))
/** A reporter at their desk, drawn: the camera bubble's picture in the guide. */
const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3e7ee"/><stop offset="1" stop-color="#e4d3de"/></linearGradient></defs>
  <rect width="640" height="480" fill="url(#wall)"/>
  <rect x="440" y="70" width="120" height="150" rx="10" fill="#d9c3d1"/>
  <path d="M150 480 C160 380 230 340 320 340 C410 340 480 380 490 480 Z" fill="#3d5a80"/>
  <rect x="292" y="290" width="56" height="70" rx="20" fill="#e0a982"/>
  <ellipse cx="320" cy="215" rx="92" ry="108" fill="#eab48d"/>
  <path d="M226 205 C222 120 272 92 324 92 C384 92 420 130 414 205 C404 160 380 140 322 140 C266 140 240 160 226 205 Z" fill="#3b2a24"/>
  <ellipse cx="286" cy="222" rx="9" ry="11" fill="#2b211d"/>
  <ellipse cx="354" cy="222" rx="9" ry="11" fill="#2b211d"/>
  <path d="M290 270 Q320 292 350 270" stroke="#9a5a45" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`

/**
 * The camera bubble's picture: inside its page, getUserMedia gives a canvas showing the drawn face. Chrome's
 * own fake camera can't be used, since its flags also stop tab capture.
 */
function drawnCamera(svg: string) {
  if (!location.pathname.endsWith("/camera-bubble.html")) return
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 480
    const image = new Image()
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    await image.decode()
    const context = canvas.getContext("2d")
    const draw = () => context?.drawImage(image, 0, 0)
    draw()
    setInterval(draw, 100)
    return canvas.captureStream(10)
  }
}

/** Chromium with the built extension, signed in to the E2E server by cookie, on the shop page. */
export async function launch(): Promise<Harness> {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as E2EState
  // Tab recording wants the reporter to have clicked the extension on that tab, which automation can't do.
  // Chrome lets an allowlisted extension skip that, so a first launch reads the ID (fixed by the path).
  const probe = await open([])
  const extensionId = probe.id
  await probe.context.close()
  const { context, worker } = await open([`--allowlisted-extension-id=${extensionId}`])
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  const shop = context.pages()[0] ?? (await context.newPage())
  await shop.goto(new URL("/shop", state.demoUrl).href)
  return { context, worker, extensionId, state, shop }
}

async function open(extraArgs: string[]): Promise<{ context: BrowserContext; worker: Worker; id: string }> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    // The real window's size and scale, not an emulated viewport: the extension's own capture
    // (captureVisibleTab, tab recording) sees the window, and would cut an emulated page short.
    viewport: null,
    colorScheme: "light",
    reducedMotion: "reduce",
    // Pictures show times and the report's timezone: never the machine's own.
    locale: "en-US",
    timezoneId: "UTC",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--window-size=1280,900",
      "--force-device-scale-factor=2",
      // So openToolbarPopup can reach the real popup, which the persistent context doesn't list.
      `--remote-debugging-port=${DEBUG_PORT}`,
      ...extraArgs,
    ],
  })
  await context.addInitScript(drawnCamera, FACE_SVG)
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  return { context, worker, id: new URL(worker.url()).host }
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
    if (popup && !(await fitPopup(target))) {
      // The real toolbar popup can't be resized, and Chrome caps its height: Chrome draws it past its window.
      const box = await target.locator("main").first().boundingBox()
      if (!box) throw new Error("No popup content")
      const cdp = await target.context().newCDPSession(target)
      const { data } = (await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { ...box, scale: 1 },
      })) as { data: string }
      writeFileSync(path, Buffer.from(data, "base64"))
      return
    }
    const clip = options.clip ?? (popup ? ((await target.locator("main").first().boundingBox()) ?? undefined) : undefined)
    // A popup taller than its window would be cut off: never picture it.
    if (popup && clip) {
      const height = await target.evaluate(() => window.innerHeight)
      expect(clip.y + clip.height, "the popup is taller than its window").toBeLessThanOrEqual(height + 0.5)
    }
    await target.screenshot({ ...common, clip })
  } else {
    await target.screenshot(common)
  }
}

/**
 * popup.html in a tab: its viewport becomes the popup's own size, at 2×, fitted until it settles (a new height can
 * reflow it a little taller). False for the real toolbar popup, whose window can't be resized.
 */
async function fitPopup(page: Page): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page)
  const bottom = () => page.evaluate(() => Math.ceil(document.querySelector("main")?.getBoundingClientRect().bottom ?? 600))
  for (let height = await bottom(), tries = 0; tries < 4; tries++) {
    const fitted = await cdp
      .send("Emulation.setDeviceMetricsOverride", { width: 380, height, deviceScaleFactor: 2, mobile: false })
      .then(() => true, () => false)
    if (!fitted) return false
    await page.waitForTimeout(300)
    const next = await bottom()
    if (next <= height) break
    height = next
  }
  return true
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

/**
 * Records the shop tab, without the countdown, as the popup's Record button would; resolves with the Recording
 * Bar's frame. Tab capture works here because the request names the tab, as the popup's does.
 */
export async function startRecording(h: Harness, camera: CameraChoice | null = null): Promise<Frame> {
  const popup = await openPopup(h)
  const tabId = await shopTabId(h, popup)
  await h.shop.bringToFront()
  const answer = await send(popup, {
    type: "bugberry:record-start",
    tabId,
    options: { source: "tab", mic: false, systemAudio: false, countdown: false, camera },
  })
  expect(answer, JSON.stringify(answer)).toMatchObject({ ok: true })
  await popup.close()
  const find = () => h.shop.frames().find((frame) => frame.url().includes("/recorder-bar.html"))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const bar = find()!
  await bar.getByRole("button", { name: "Pause" }).waitFor()
  return bar
}

/** **Stop** on the Recording Bar; resolves with the review over the shop. */
export async function stopRecording(h: Harness, bar: Frame): Promise<Frame> {
  await h.shop.bringToFront()
  await bar.getByRole("button", { name: /^Stop/ }).click()
  return reviewFrame(h)
}

/**
 * The real toolbar popup over the shop, as a reporter's click opens it. The background answers some requests
 * (a running recording's status and controls) only to it, never to popup.html in a tab.
 */
export async function openToolbarPopup(h: Harness): Promise<Page> {
  await h.shop.bringToFront()
  await h.worker.evaluate(() => (globalThis as unknown as { chrome: { action: { openPopup(): Promise<void> } } }).chrome.action.openPopup())
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
  const find = () => browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().endsWith("/popup.html"))
  await expect.poll(() => find() !== undefined, { timeout: 10_000 }).toBe(true)
  const popup = find()!
  await popup.getByRole("radiogroup", { name: "Screenshot" }).waitFor()
  return popup
}

/** `chrome.runtime.sendMessage` from an extension page, as the popup would. Not awaited by the page. */
export async function send(from: Page, message: unknown): Promise<unknown> {
  return from.evaluate((m) => chrome.runtime.sendMessage(m), message)
}

/** A dashboard page at a fixed size, at 2×: wide enough for the layout the guide describes. */
export async function dashboardPage(h: Harness, path: string, size = { width: 1440, height: 900 }): Promise<Page> {
  return sizedPage(h, `${h.state.serverUrl}${path}`, size)
}

/** Any page at a fixed size, at 2×. */
export async function sizedPage(h: Harness, url: string, size: { width: number; height: number }): Promise<Page> {
  const page = await h.context.newPage()
  const cdp = await h.context.newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 2, mobile: false })
  await page.goto(url)
  await page.waitForLoadState("networkidle")
  return page
}

/**
 * A screenshot report on the shop, filed through the extension as a reporter would: Pay is clicked first, so the
 * report has an error and a failed request. Resolves with the report's id.
 */
export async function fileScreenshotReport(h: Harness, report: { title: string; description: string; priority: string }): Promise<string> {
  await h.shop.bringToFront()
  await h.shop.getByRole("button", { name: "Pay $48.00" }).click()
  await h.shop.waitForTimeout(400)
  const popup = await openPopup(h)
  const tabId = await shopTabId(h, popup)
  await h.shop.bringToFront()
  expect(await send(popup, { type: "bugberry:screenshot", tabId, mode: "visible" })).toMatchObject({ ok: true })
  await popup.close()
  const review = await reviewFrame(h)
  await review.getByLabel("Title").fill(report.title)
  await review.getByRole("textbox", { name: "What went wrong?" }).fill(report.description)
  await review.getByRole("button", { name: /Priority$/ }).click()
  await review.getByRole("option", { name: report.priority }).click()
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 30_000 })
  const id = (await review.getByRole("link", { name: "Open report" }).getAttribute("href"))?.split("/").at(-1) ?? ""
  // Done takes the review's own frame away, so the click may never hear back: the frame going is the answer.
  await review.getByRole("button", { name: "Done" }).click({ timeout: 10_000, noWaitAfter: true }).catch(() => {})
  await expect.poll(() => h.shop.frames().some((frame) => frame.url().includes("/review.html")), { timeout: 15_000 }).toBe(false)
  return id
}
