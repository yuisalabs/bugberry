import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { CAPTURE_PAUSE_EVENT, type CaptureSession, type CaptureWindow, FLUSH_EVENT, FLUSH_REQUEST_EVENT, startCapture } from "../src/session"

let win: Window
let session: CaptureSession

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  win = new Window({ url: "https://app.kantor.test/" })
  win.document.body.innerHTML = `<button id="go">Go</button>`
  ;(win as unknown as { fetch: typeof fetch }).fetch = (async () =>
    new Response('{"ok":true}', { status: 500, headers: { "content-type": "application/json" } })) as unknown as typeof fetch
})

afterEach(async () => {
  session?.stop()
  await win.happyDOM.close()
})

const capture = () => startCapture({ window: win as unknown as CaptureWindow })
const click = () => (win.document.getElementById("go") as unknown as HTMLElement).click()

describe("startCapture", () => {
  test("records console, errors, network and actions into one ordered buffer", async () => {
    session = capture()
    win.console.error("checkout failed")
    await (win as unknown as { fetch: typeof fetch }).fetch("/api/pay")
    click()
    await flush()

    const kinds = session.snapshot().map((event) => event.kind)
    expect(kinds).toEqual(["page", "action", "console", "network", "action"])
    expect(session.summary()).toMatchObject({ logs: 1, errors: 1, requests: 1, failedRequests: 1, actions: 2 })
    expect(session.incomplete).toEqual([])
  })

  test("sdk entries queued before capture, and pushed after, land in the buffer", () => {
    const sdkGlobal = { v: 1, metadata: null, queue: [{ t: Date.now(), level: "info", message: "early" }] as unknown[], push(_entry: unknown) {} }
    ;(win as unknown as Record<string, unknown>).__bugberry__ = sdkGlobal
    session = capture()
    sdkGlobal.push({ t: Date.now(), level: "warn", message: "late" })
    expect(session.snapshot().filter((event) => event.kind === "sdk").map((event) => (event as { message: string }).message)).toEqual(["early", "late"])
    expect(session.incomplete).toEqual([])
  })

  test("a queued sdk entry older than the buffer's age limit is dropped, not stamped as new", () => {
    const host = win as unknown as Record<string, unknown>
    const at = 10 * 60 * 1000
    host.__bugberry__ = { v: 1, metadata: null, queue: [{ t: at - 6 * 60 * 1000, level: "info", message: "stale" }], push() {} }
    session = startCapture({ window: win as unknown as CaptureWindow, now: () => at })
    expect(session.snapshot().some((event) => event.kind === "sdk")).toBe(false)
  })

  test("an unusable SDK global is reported as incomplete sdk", () => {
    ;(win as unknown as Record<string, unknown>).__bugberry__ = "taken"
    session = capture()
    expect(session.incomplete).toEqual(["sdk"])
  })

  test("starting twice on the same page reuses the session and does not double-record", () => {
    session = capture()
    const again = capture()
    click()
    expect(again).toBe(session)
    expect(session.snapshot().filter((event) => event.kind === "action" && event.type === "click")).toHaveLength(1)
  })

  test("a hook that cannot be installed is reported while the others keep working", () => {
    Object.defineProperty(win, "fetch", { value: async () => new Response(""), writable: false, configurable: true })
    session = capture()
    click()
    expect(session.incomplete).toEqual(["fetch"])
    expect(session.summary().incomplete).toEqual(["fetch"])
    expect(session.snapshot().some((event) => event.kind === "action" && event.type === "click")).toBe(true)
  })

  test("stop removes the hooks so a fresh session can start", () => {
    session = capture()
    session.stop()
    const fresh = capture()
    expect(fresh).not.toBe(session)
    session = fresh
    click()
    expect(session.snapshot().filter((event) => event.kind === "action" && event.type === "click")).toHaveLength(1)
  })

  test("after stop, a hook left under a page wrapper records nothing", () => {
    session = capture()
    const pageConsole = (win as unknown as { console: Console }).console
    const ours = pageConsole.log
    pageConsole.log = (...args: unknown[]) => ours.apply(pageConsole, args)
    session.stop()
    const before = session.snapshot().length
    pageConsole.log("after stop")
    expect(session.snapshot()).toHaveLength(before)
  })

  test("a flush request answers synchronously with this document's events", () => {
    session = capture()
    click()
    let detail: unknown = null
    win.document.addEventListener("bugberry:flush", (event) => {
      detail = (event as unknown as CustomEvent).detail
    })
    win.document.dispatchEvent(new win.CustomEvent("bugberry:flush-request"))
    expect(typeof detail).toBe("string")
    const flushed = JSON.parse(detail as unknown as string) as { documentId: string; events: Array<{ kind: string }>; incomplete: string[] }
    expect(flushed.documentId).toBe(session.documentId)
    expect(session.documentId).toMatch(/^[a-z0-9-]{8,64}$/)
    expect(flushed.events.some((event) => event.kind === "action")).toBe(true)
    expect(flushed.incomplete).toEqual([])
  })

  test("readMetadata calls the page's callback, and a failure leaves one sdk warn line behind", () => {
    const host = win as unknown as Record<string, unknown>
    host.__bugberry__ = { v: 1, metadata: () => ({ userId: "u1" }), queue: [], push() {} }
    session = capture()
    expect(session.readMetadata()).toEqual({ fields: { userId: "u1" }, error: null, droppedKeys: 0 })
    ;(host.__bugberry__ as { metadata: unknown }).metadata = () => { throw new Error("store not ready") }
    expect(session.readMetadata().error).toBe("callback threw: store not ready")
    const warn = session.snapshot().find((event) => event.kind === "sdk")
    expect(warn).toMatchObject({ kind: "sdk", level: "warn", message: "metadata callback failed: callback threw: store not ready" })
  })

  test("a flush answer carries the metadata snapshot, even when the callback throws", () => {
    const host = win as unknown as Record<string, unknown>
    host.__bugberry__ = { v: 1, metadata: () => { throw new Error("boom") }, queue: [], push() {} }
    session = capture()
    win.console.log("before leaving")
    let detail: string | undefined
    win.document.addEventListener(FLUSH_EVENT, (event) => { detail = (event as unknown as CustomEvent<string>).detail })
    win.document.dispatchEvent(new win.CustomEvent(FLUSH_REQUEST_EVENT))
    const answer = JSON.parse(detail ?? "{}") as { events: Array<{ kind: string; message?: string }>; metadata: { error: string | null } }
    expect(answer.metadata.error).toBe("callback threw: boom")
    expect(answer.events.some((event) => event.kind === "console")).toBe(true)
    expect(answer.events.some((event) => event.kind === "sdk" && event.message === "metadata callback failed: callback threw: boom")).toBe(true)
  })

  test("without the SDK, a flush answer carries the empty snapshot and no warn line", () => {
    session = capture()
    let detail: string | undefined
    win.document.addEventListener(FLUSH_EVENT, (event) => { detail = (event as unknown as CustomEvent<string>).detail })
    win.document.dispatchEvent(new win.CustomEvent(FLUSH_REQUEST_EVENT))
    const answer = JSON.parse(detail ?? "{}") as { events: Array<{ kind: string }>; metadata: unknown }
    expect(answer.metadata).toEqual({ fields: null, error: null, droppedKeys: 0 })
    expect(answer.events.some((event) => event.kind === "sdk")).toBe(false)
  })

  test("clear empties the buffer", () => {
    session = capture()
    click()
    session.clear()
    expect(session.snapshot()).toEqual([])
  })
})

/** The extension's isolated world telling this script the recording paused ("on") or resumed ("off"). */
const pause = (detail: "on" | "off") =>
  (win.document as unknown as EventTarget).dispatchEvent(new (win.CustomEvent as unknown as typeof CustomEvent)(CAPTURE_PAUSE_EVENT, { detail }))

test("while the recording is paused, the page's buffer keeps nothing, so a noisy pause pushes nothing out", () => {
  session = capture()
  win.console.error("before")
  pause("on")
  win.console.error("typed card number")
  pause("off")
  win.console.error("after")
  const texts = session.snapshot().flatMap((event) => (event.kind === "console" ? [event.args.join(" ")] : []))
  expect(texts).toEqual(["before", "after"])
})
