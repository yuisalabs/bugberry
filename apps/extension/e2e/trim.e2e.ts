import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { chromium, expect, test } from "@playwright/test"

const extensionPath = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))

test("a trimmed recording sends only the kept part, video and logs", async () => {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    serverUrl: string
    token: string
    sessionCookie: { name: string; value: string }
  }
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host

  // A 4 s recording without sound, stored as a video draft, as the recorder would leave it.
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  const draftId = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 320
    canvas.height = 180
    const context2d = canvas.getContext("2d") as CanvasRenderingContext2D
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp9" })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const stopped = new Promise((resolve) => (recorder.onstop = resolve))
    const startedAt = Date.now()
    recorder.start(250)
    const timer = setInterval(() => {
      context2d.fillStyle = `hsl(${(Date.now() - startedAt) / 10}, 80%, 50%)`
      context2d.fillRect(0, 0, 320, 180)
    }, 33)
    await new Promise((resolve) => setTimeout(resolve, 4000))
    recorder.stop()
    await stopped
    clearInterval(timer)

    const id = "trim-e2e"
    const draft = {
      id,
      createdAt: startedAt,
      captureType: "video",
      page: { url: "https://shop.test/checkout", title: "Checkout" },
      device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
      video: new Blob(chunks, { type: "video/webm" }),
      durationMs: 4000,
      recordingStartedAt: startedAt,
      debuggerPayload: {
        version: 1,
        capturedAt: startedAt + 4000,
        recordingStartedAt: startedAt,
        incomplete: [],
        events: [
          { kind: "error", t: startedAt + 500, message: "before the cut" },
          { kind: "error", t: startedAt + 3000, message: "kept" },
        ],
      },
      debuggerGzip: null,
      status: "editing",
      error: null,
      session: null,
      form: null,
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bugberry", 1)
      request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite")
      transaction.objectStore("drafts").put(draft)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    return id
  })

  const review = await context.newPage()
  await review.goto(`chrome-extension://${extensionId}/review.html?draft=${draftId}`)
  await review.getByRole("button", { name: "Trim" }).click()
  const start = review.getByRole("slider", { name: /Trim start/ })
  for (let i = 0; i < 10; i++) await start.press("ArrowRight")
  await expect(review.getByText("0:01 – 0:04 · 3 s of 4 s")).toBeVisible()
  await review.getByRole("button", { name: "Done" }).click()
  await expect(review.getByRole("button", { name: "Trim 0:01–0:04" })).toBeVisible()
  await expect(review.getByText("1 error", { exact: true })).toBeVisible()
  await review.getByLabel("Title").fill("Trimmed recording")
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 60_000 })

  const reportId = (await review.getByRole("link", { name: "Open report" }).getAttribute("href"))?.split("/").at(-1)
  const auth = { authorization: `Bearer ${state.token}` }
  const report = (await (await fetch(`${state.serverUrl}/api/reports/${reportId}`, { headers: auth })).json()) as {
    durationMs: number
    mediaUrl: string
    debuggerUrl: string
  }
  expect(Math.abs(report.durationMs - 3000)).toBeLessThanOrEqual(100)

  const debuggerBytes = Buffer.from(await (await fetch(new URL(report.debuggerUrl, state.serverUrl), { headers: auth })).arrayBuffer())
  const payload = JSON.parse(gunzipSync(debuggerBytes).toString("utf8")) as { events: Array<{ message?: string }> }
  expect(payload.events.map((event) => event.message)).toEqual(["kept"])

  // The uploaded file itself is about 3 s long and plays.
  const media = Buffer.from(await (await fetch(new URL(report.mediaUrl, state.serverUrl), { headers: auth })).arrayBuffer())
  const played = await page.evaluate(async (bytes) => {
    const video = document.createElement("video")
    video.muted = true
    video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/webm" }))
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
    })
    const duration = video.duration
    await video.play()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { duration, moved: video.currentTime > 0 }
  }, [...media])
  expect(Math.abs(played.duration - 3)).toBeLessThanOrEqual(0.2)
  expect(played.moved).toBe(true)

  await context.close()
})
