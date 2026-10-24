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
  // While a handle is dragged only the strip follows it; the page (tiles, markers, player) catches up on release.
  // Updating all of it on every move cost about 34 ms a move.
  {
    const handle = await review.getByRole("slider", { name: /Trim start/ }).locator("xpath=../..").boundingBox()
    const frames = await review.getByRole("group", { name: "Trim" }).boundingBox()
    const y = (handle?.y ?? 0) + (handle?.height ?? 0) / 2
    await review.mouse.move((handle?.x ?? 0) + (handle?.width ?? 0) / 2, y)
    await review.mouse.down()
    for (let i = 1; i <= 5; i++) await review.mouse.move((frames?.x ?? 0) + ((frames?.width ?? 0) * 0.5 * i) / 5, y)
    await expect(review.getByText(/^0:00 – 0:04/)).toBeHidden()
    await expect(review.getByText("2 errors", { exact: true })).toBeVisible()
    await review.mouse.up()
    await expect(review.getByText("1 error", { exact: true })).toBeVisible()
    await review.getByRole("button", { name: "Reset" }).click()
    await expect(review.getByText("2 errors", { exact: true })).toBeVisible()
  }

  // The strip is there from the start: a moved handle applies at once.
  const start = review.getByRole("slider", { name: /Trim start/ })
  for (let i = 0; i < 10; i++) await start.press("ArrowRight")
  const end = review.getByRole("slider", { name: /Trim end/ })
  for (let i = 0; i < 10; i++) await end.press("ArrowLeft")
  await expect(review.getByText("0:01 – 0:03 · 2 s of 4 s")).toBeVisible()
  // Both handles line up with the strip of frames, top and bottom.
  const frames = await review.getByRole("group", { name: "Trim" }).locator("xpath=..").boundingBox()
  for (const handle of [start, end]) {
    const box = await handle.locator("xpath=..").locator("xpath=..").boundingBox()
    expect(Math.abs((box?.y ?? 0) - (frames?.y ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs((box?.height ?? 0) - (frames?.height ?? 0))).toBeLessThanOrEqual(1)
  }
  // The error at exactly 3 s is on the boundary and stays; the one at 0.5 s goes.
  await expect(review.getByText("1 error", { exact: true })).toBeVisible()

  const player = review.locator("video")
  const time = () => player.evaluate((video: HTMLVideoElement) => video.currentTime)
  const paused = () => player.evaluate((video: HTMLVideoElement) => video.paused)
  // The preview showed the last handle moved: the end. Play from there starts at 1 s and stops at 3 s.
  expect(await time()).toBeCloseTo(3, 1)
  await review.getByRole("button", { name: "Play selection" }).click()
  await expect.poll(time).toBeLessThan(2)
  await expect(review.getByRole("button", { name: "Pause selection" })).toBeVisible()
  await expect.poll(paused, { timeout: 5_000 }).toBe(true)
  expect(await time()).toBeCloseTo(3, 1)

  // The playhead goes anywhere, outside the kept part too, and stays there.
  await review.getByRole("slider", { name: /Playhead/ }).press("Home")
  await expect.poll(time).toBeCloseTo(0, 1)
  await review.waitForTimeout(500)
  expect(await time()).toBeCloseTo(0, 1)
  // Played from outside the kept part, the preview starts at its start.
  await review.getByRole("button", { name: "Play selection" }).click()
  await expect.poll(time).toBeGreaterThanOrEqual(1)
  await expect.poll(paused, { timeout: 5_000 }).toBe(true)
  expect(await time()).toBeCloseTo(3, 1)
  await review.getByLabel("Title").fill("Trimmed recording")
  // A handle moved right before Create report is what is sent, though its save hasn't come round yet.
  await start.press("ArrowLeft")
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 60_000 })

  const reportId = (await review.getByRole("link", { name: "Open report" }).getAttribute("href"))?.split("/").at(-1)
  const auth = { authorization: `Bearer ${state.token}` }
  const report = (await (await fetch(`${state.serverUrl}/api/reports/${reportId}`, { headers: auth })).json()) as {
    durationMs: number
    mediaUrl: string
    debuggerUrl: string
  }
  expect(Math.abs(report.durationMs - 2100)).toBeLessThanOrEqual(50)

  const debuggerBytes = Buffer.from(await (await fetch(new URL(report.debuggerUrl, state.serverUrl), { headers: auth })).arrayBuffer())
  const payload = JSON.parse(gunzipSync(debuggerBytes).toString("utf8")) as { events: Array<{ message?: string }> }
  expect(payload.events.map((event) => event.message)).toEqual(["kept"])

  // The uploaded file itself is about 2.1 s long and plays.
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
  expect(Math.abs(played.duration - 2.1)).toBeLessThanOrEqual(0.2)
  expect(played.moved).toBe(true)

  await context.close()
})
