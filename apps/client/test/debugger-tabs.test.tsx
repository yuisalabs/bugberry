import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { ActionsTab } from "../src/components/debugger/ActionsTab"
import { ConsoleTab } from "../src/components/debugger/ConsoleTab"
import { type DebuggerFocus, DebuggerTabs } from "../src/components/debugger/DebuggerTabs"
import { InfoTab } from "../src/components/debugger/InfoTab"
import { NetworkTab } from "../src/components/debugger/NetworkTab"
import { normalizePayload } from "@bugberry/debugger-view"
import { networkRows } from "@bugberry/debugger-view"
import { reportFixture } from "./fixtures"
import { choose } from "./fields"
import { type OnboardingContext, OnboardingTestProvider } from "../src/components/onboarding/OnboardingProvider"

const HOSTILE = "<img src=x onerror=alert(1)>"

describe("ConsoleTab", () => {
  const { events } = normalizePayload({
    events: [
      { kind: "console", t: 1000, level: "log", args: ["hello"] },
      { kind: "console", t: 1001, level: "warn", args: ["careful"] },
      { kind: "error", t: 1002, message: HOSTILE, stack: "at pay (app.js:1)" },
    ],
  })

  test("renders page-controlled text as text, with errors marked", () => {
    render(<ConsoleTab events={events} base={1000} />)
    const row = screen.getByText(HOSTILE)
    expect(document.querySelector("img")).toBeNull()
    expect(row.closest("li")?.className).toContain("text-danger")
    expect(screen.getByText("at pay (app.js:1)")).toBeTruthy()
  })

  test("filters by level and text, and counts each level", () => {
    render(<ConsoleTab events={events} base={1000} />)
    expect(screen.getByText("1 errors")).toBeTruthy()
    choose("Level", "Warnings")
    expect(screen.queryByText("hello")).toBeNull()
    expect(screen.getByText("careful")).toBeTruthy()
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter logs" }), { target: { value: "nothing" } })
    expect(screen.getByText("No logs match.")).toBeTruthy()
  })
})

describe("NetworkTab with page resources", () => {
  const { events } = normalizePayload({
    events: [
      { kind: "page", t: 900, url: "https://app.kantor.test/checkout", via: "load", domContentLoadedMs: 412, loadMs: 890, transferSize: 18_600 },
      {
        kind: "resource",
        t: 1000,
        url: "https://app.kantor.test/js/app.js",
        initiatorType: "script",
        durationMs: 40,
        transferSize: 18_400,
        decodedSize: 52_000,
        timing: { queueMs: 2, dnsMs: 8, connectMs: 5, tlsMs: 5, ttfbMs: 10, downloadMs: 9 },
      },
      { kind: "resource", t: 1100, url: "https://cdn.other.test/lib.js", initiatorType: "script", durationMs: 30 },
    ],
  })

  test("shows type, size, the totals line and filters by type", () => {
    render(<NetworkTab events={events} base={900} />)
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "#",
      "Name",
      "Status",
      "Method",
      "Type",
      "Size",
      "Time",
      "Initiator",
      "Domain",
      "Waterfall",
    ])
    expect(screen.getByText("18.4 kB")).toBeTruthy()
    expect(screen.getByText("37.0 kB transferred · 52.0 kB resources · Finish: 890 ms · DOMContentLoaded: 412 ms · Load: 890 ms")).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Doc" }))
    expect(screen.getByRole("button", { name: /^checkout/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^app\.js/ })).toBeNull()
  })

  test("a file with timing details has a Timing tab; one without has none", () => {
    render(<NetworkTab events={events} base={900} />)
    fireEvent.click(screen.getByRole("button", { name: /^app\.js/ }))
    fireEvent.click(screen.getByRole("tab", { name: "Timing" }))
    expect(screen.getByText("Waiting for server (TTFB)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close request" }))
    fireEvent.click(screen.getByRole("button", { name: /^lib\.js/ }))
    expect(screen.queryByRole("tab", { name: "Timing" })).toBeNull()
  })

  test("opening a page shows its own DOMContentLoaded and Load", () => {
    render(<NetworkTab events={events} base={900} />)
    fireEvent.click(screen.getByRole("button", { name: /^checkout/ }))
    const fact = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent
    expect(fact("DOMContentLoaded")).toBe("412 ms")
    expect(fact("Load")).toBe("890 ms")
  })
})

describe("NetworkTab", () => {
  const { events } = normalizePayload({
    events: [
      { kind: "network", t: 1000, method: "GET", url: "https://app.kantor.test/api/user", status: 200, durationMs: 40 },
      {
        kind: "network",
        t: 1001,
        method: "POST",
        url: "https://app.kantor.test/api/pay",
        status: 500,
        durationMs: 120,
        responseHeaders: { "content-type": "application/json" },
        responseBody: '{"error":"boom"}',
      },
      { kind: "network", t: 1002, method: "GET", url: "javascript:alert(1)", failed: "TypeError: Failed to fetch" },
    ],
  })

  test("a request still waiting when the report was taken counts as canceled", () => {
    const waiting = normalizePayload({
      events: [{ kind: "network", t: 1000, method: "GET", url: "https://app.kantor.test/api/slow", pending: true }],
    }).events
    expect(waiting[0]).toMatchObject({ pending: true })
    render(<NetworkTab events={waiting} base={1000} />)
    expect(screen.getByText("(canceled)")).toBeTruthy()
    expect(screen.getByText("1 requests · 0 failed · 1 canceled")).toBeTruthy()
  })

  test("Errors only and the filter narrow the table", () => {
    render(<NetworkTab events={events} base={1000} />)
    expect(screen.getByRole("button", { name: /^user/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Errors only" }))
    expect(screen.queryByRole("button", { name: /^user/ })).toBeNull()
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter requests" }), { target: { value: "PAY" } })
    expect(screen.queryByText("javascript:alert(1)")).toBeNull()
    expect(screen.getByRole("button", { name: /^pay/ })).toBeTruthy()
  })

  test("failed rows are red and the footer counts them", () => {
    render(<NetworkTab events={events} base={1000} />)
    expect(screen.getByRole("button", { name: /^pay/ }).closest("tr")?.className).toContain("text-danger")
    expect(screen.getByText("3 requests · 1 failed · 1 canceled")).toBeTruthy()
  })

  test("a row opens the request under the table, as plain text", () => {
    const seek = mock()
    render(<NetworkTab events={events} base={1000} playback={{ currentMs: null, seek }} />)
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    expect(screen.getByText("POST /api/pay")).toBeTruthy()
    expect(screen.getByText("500 Internal Server Error")).toBeTruthy()
    // The table stays, with the opened row marked.
    expect(screen.getByRole("button", { name: /^user/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^pay/ }).closest("tr")?.dataset.selected).toBe("true")
    fireEvent.click(screen.getByRole("tab", { name: "Response" }))
    expect(screen.getByText('"error": "boom"')).toBeTruthy()
    expect(screen.getByText("content-type")).toBeTruthy()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Jump to 0:00" }))
    expect(seek).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole("button", { name: "Close request" }))
    expect(screen.queryByText("POST /api/pay")).toBeNull()
    expect(screen.getByRole("button", { name: /^pay/ }).closest("tr")?.dataset.selected).toBeUndefined()
  })

  test("on a phone: one row per request, and the request opens in a sheet", () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({ matches: query === "(max-width: 767px)", media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    try {
      render(<NetworkTab events={events} base={1000} />)
      // No columns to scroll sideways: method, path, type and time, and the status as a pill.
      expect(screen.queryAllByRole("columnheader")).toHaveLength(0)
      const pay = screen.getByRole("button", { name: "/api/pay" })
      const row = pay.closest("tr") as HTMLElement
      expect(within(row).getByText("POST")).toBeTruthy()
      expect(within(row).getByText("500").className).toContain("bg-danger-subtle")
      fireEvent.click(pay)
      // Only in the sheet: the table has no detail of its own on a phone.
      expect(screen.getByText("POST /api/pay").closest("[data-slot=sheet]")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Close request" }))
      expect(screen.queryByText("POST /api/pay")).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })

  test("another row swaps the detail, and filtering keeps it open", () => {
    render(<NetworkTab events={events} base={1000} />)
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    fireEvent.click(screen.getByRole("button", { name: /^user/ }))
    expect(screen.queryByText("POST /api/pay")).toBeNull()
    expect(screen.getByText("GET /api/user")).toBeTruthy()
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter requests" }), { target: { value: "pay" } })
    expect(screen.getByText("GET /api/user")).toBeTruthy()
  })
})

describe("DebuggerTabs", () => {
  test("the tabs count errors and failed requests", () => {
    const summary = { logs: 4, errors: 3, requests: 25, failedRequests: 6, actions: 9, incomplete: [] }
    render(<DebuggerTabs report={reportFixture({ debuggerSummary: summary })} state={{ status: "none" }} onRetry={() => {}} />)
    expect(screen.getByRole("heading", { name: /DevTools/ })).toBeTruthy()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Activity", "Console3", "Network6"])
  })

  test("opens on Overview, even when the report has errors; Console shows them", () => {
    const view = normalizePayload({ capturedAt: 2000, events: [{ kind: "console", t: 1500, level: "error", args: ["boom"] }] })
    render(<DebuggerTabs report={reportFixture()} state={{ status: "ready", view }} onRetry={() => {}} />)
    expect(screen.getByRole("tab", { name: /Overview/ }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("Chrome 140")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }))
    expect(screen.getByText("boom")).toBeTruthy()
  })

  test("below 1280 px a tab previews a few rows; View all opens the rest", () => {
    const summary = { logs: 4, errors: 0, requests: 25, failedRequests: 0, actions: 3, incomplete: [] }
    const view = normalizePayload({ capturedAt: 2000, events: [{ kind: "console", t: 1500, level: "log", args: ["hi"] }] })
    render(<DebuggerTabs report={reportFixture({ debuggerSummary: summary })} state={{ status: "ready", view }} onRetry={() => {}} />)
    // Three actions fit in the preview: nothing more to open.
    expect(screen.queryByRole("button", { name: /View all/ })).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: /Network/ }))
    const panel = () => screen.getByRole("tabpanel")
    expect(panel().className).toContain("max-h-96")
    fireEvent.click(screen.getByRole("button", { name: "View all 25 requests" }))
    expect(panel().className).toContain("max-h-[70vh]")
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy()
  })

  test("explains reports without debugger data", () => {
    const summary = { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] }
    render(<DebuggerTabs report={reportFixture({ debuggerSummary: summary })} state={{ status: "none" }} onRetry={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }))
    expect(screen.getByText(/has no console, network or action data/)).toBeTruthy()
  })

  test("offers a retry when the payload cannot be loaded", () => {
    const onRetry = mock()
    render(<DebuggerTabs report={reportFixture()} state={{ status: "error" }} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }))
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test("Overview links the page only for http(s) URLs and lists missing data", () => {
    const report = reportFixture({
      pageUrl: "javascript:alert(1)",
      debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: ["not-injected"] },
    })
    render(<DebuggerTabs report={report} state={{ status: "none" }} onRetry={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText(/capture script wasn't installed/)).toBeTruthy()
  })
})

test("Info explains a recording made from a page that isn't a web page", () => {
  const view = normalizePayload({ recordingStartedAt: 1000, incomplete: ["not-web-page"], events: [] })
  render(<DebuggerTabs report={reportFixture({ captureType: "video" })} state={{ status: "ready", view }} onRetry={() => {}} />)
  fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
  expect(screen.getByText("This wasn't a regular web page, so there is no console, network or action data.")).toBeTruthy()
})

test("Info explains a recording that moved to another page", () => {
  const view = normalizePayload({ recordingStartedAt: 1000, incomplete: ["navigated"], events: [] })
  render(<DebuggerTabs report={reportFixture({ captureType: "video" })} state={{ status: "ready", view }} onRetry={() => {}} />)
  fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
  expect(screen.getByText(/navigated to another page during the recording/)).toBeTruthy()
})

describe("video timeline", () => {
  const { events } = normalizePayload({
    recordingStartedAt: 1000,
    events: [
      { kind: "action", t: 500, type: "click", target: "a#early" },
      { kind: "action", t: 3000, type: "click", target: "button#pay" },
      { kind: "action", t: 5000, type: "submit", target: "form#checkout" },
      { kind: "network", t: 3500, method: "POST", url: "https://app.kantor.test/api/pay", status: 500 },
    ],
  })
  const rowOf = (text: string) => screen.getByText(text).closest("li")

  test("clicking an event time seeks the video to that moment", () => {
    const seek = mock()
    render(<ActionsTab events={events} base={1000} playback={{ currentMs: null, seek }} />)
    fireEvent.click(screen.getByRole("button", { name: "Play video from 0:02" }))
    expect(seek).toHaveBeenLastCalledWith(2000)
  })

  test("a click anywhere on an action's row seeks there, and on its time only once", () => {
    const seek = mock()
    render(<ActionsTab events={events} base={1000} playback={{ currentMs: null, seek }} />)
    expect(rowOf("button#pay")?.className).toContain("cursor-pointer")
    fireEvent.click(screen.getByText("button#pay"))
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenLastCalledWith(2000)
    fireEvent.click(screen.getByRole("button", { name: "Play video from 0:02" }))
    expect(seek).toHaveBeenCalledTimes(2)
  })

  test("a click on a console line seeks there; its Stack toggle and a text selection do not", () => {
    const { events: logs } = normalizePayload({
      recordingStartedAt: 1000,
      events: [
        { kind: "console", t: 2000, level: "log", args: ["cart restored"] },
        { kind: "error", t: 4000, message: "TypeError: sku", stack: "at pay (app.js:1)" },
      ],
    })
    const seek = mock()
    render(<ConsoleTab events={logs} base={1000} playback={{ currentMs: null, seek }} />)
    fireEvent.click(screen.getByText("cart restored"))
    expect(seek).toHaveBeenLastCalledWith(1000)
    fireEvent.click(screen.getByRole("button", { name: /Stack/ }))
    expect(seek).toHaveBeenCalledTimes(1)
    const getSelection = window.getSelection
    window.getSelection = () => ({ toString: () => "TypeError" }) as Selection
    try {
      fireEvent.click(screen.getByText("TypeError: sku"))
      expect(seek).toHaveBeenCalledTimes(1)
    } finally {
      window.getSelection = getSelection
    }
    fireEvent.click(screen.getByText("TypeError: sku"))
    expect(seek).toHaveBeenLastCalledWith(3000)
  })

  test("the event just before the playhead is highlighted", () => {
    const seek = () => {}
    const { rerender } = render(<ActionsTab events={events} base={1000} playback={{ currentMs: 2500, seek }} />)
    expect(rowOf("button#pay")?.getAttribute("aria-current")).toBe("true")
    expect(rowOf("a#early")?.getAttribute("aria-current")).toBeNull()
    rerender(<ActionsTab events={events} base={1000} playback={{ currentMs: 6000, seek }} />)
    expect(rowOf("form#checkout")?.getAttribute("aria-current")).toBe("true")
    expect(rowOf("button#pay")?.getAttribute("aria-current")).toBeNull()
  })

  test("screenshots keep plain times, and rows that do nothing when clicked", () => {
    render(<ActionsTab events={events} base={1000} />)
    expect(screen.queryAllByRole("button", { name: /Play video/ })).toHaveLength(0)
    expect(rowOf("button#pay")?.className).not.toContain("cursor-pointer")
  })
})

describe("InfoTab", () => {
  const view = normalizePayload({
    recordingStartedAt: 1000,
    events: [
      { kind: "action", t: 1000, type: "navigate", url: "https://app.kantor.test/checkout" },
      { kind: "action", t: 2000, type: "input", target: "input#card", value: "••••" },
    ],
  })

  test("members see the reporter's email, the pages visited and what was masked", () => {
    render(<InfoTab report={reportFixture({ pageUrl: "https://app.kantor.test/checkout" })} view={view} />)
    expect(screen.getByText("Ana, ana@kantor.test")).toBeTruthy()
    expect(screen.getByText("Bug here")).toBeTruthy()
    expect(screen.getByText("1 field masked before upload")).toBeTruthy()
    expect(screen.getByText("1440 × 900")).toBeTruthy()
  })

  test("members see the reporter's city", () => {
    render(<InfoTab report={reportFixture({ location: "Jakarta, Indonesia" })} view={view} />)
    expect(screen.getByText("Jakarta, Indonesia")).toBeTruthy()
  })

  test("share viewers see the name only, and no Privacy without masked fields", () => {
    render(<InfoTab report={reportFixture({ reporterEmail: undefined })} view={null} />)
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.queryByText(/masked before upload/)).toBeNull()
  })
})

describe("ActionsTab", () => {
  test("reads each action as a sentence, with spaces around the element", () => {
    const { events } = normalizePayload({
      events: [
        { kind: "action", t: 1000, type: "click", target: "button#pay" },
        { kind: "action", t: 2000, type: "input", target: "input#card", value: "••••" },
      ],
    })
    render(<ActionsTab events={events} base={1000} />)
    const rows = screen.getAllByRole("listitem").map((row) => row.querySelector("p")?.textContent)
    expect(rows).toEqual(["Clicked button#pay", "Typed into input#card •••• Masked"])
    expect(screen.getAllByRole("radio", { checked: false }).map((chip) => chip.textContent)).toEqual([
      "Clicks 1",
      "Inputs 1",
      "Navigation 0",
      "Tab 0",
    ])
    fireEvent.click(screen.getByRole("radio", { name: "Inputs 1" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  test("a rage click carries the Frustration signal tag", () => {
    const { events } = normalizePayload({ events: [{ kind: "action", t: 1000, type: "rage-click", target: "button#pay", value: "4" }] })
    render(<ActionsTab events={events} base={1000} />)
    expect(screen.getByText("Frustration signal")).toBeTruthy()
  })
})

describe("pointing the DevTools panel at something", () => {
  const view = normalizePayload({
    capturedAt: 2000,
    events: [
      { kind: "console", t: 1500, level: "error", args: ["boom"] },
      { kind: "network", t: 1600, method: "GET", url: "https://app.kantor.test/api/user", status: 200 },
      { kind: "network", t: 1700, method: "POST", url: "https://app.kantor.test/api/pay", status: 500 },
    ],
  })
  const payKey = networkRows(view.events).find((row) => row.url.endsWith("/api/pay"))?.key ?? ""
  const tabs = (focus: DebuggerFocus | null) => (
    <DebuggerTabs report={reportFixture()} state={{ status: "ready", view }} onRetry={() => {}} focus={focus} />
  )

  test("a focus opens the Console tab", () => {
    const { rerender } = render(tabs(null))
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
    rerender(tabs({ tab: "console", nonce: 1 }))
    expect(screen.getByRole("tab", { name: /Console/ }).getAttribute("aria-selected")).toBe("true")
  })

  test("a focus on a request opens its detail in the Network tab", () => {
    render(tabs({ tab: "network", rowKey: payKey, nonce: 1 }))
    expect(screen.getByText("POST /api/pay")).toBeTruthy()
    expect(screen.getByText("500 Internal Server Error")).toBeTruthy()
  })

  test("the same focus again re-opens after the person moved away", () => {
    const { rerender } = render(tabs({ tab: "network", rowKey: payKey, nonce: 1 }))
    fireEvent.click(screen.getByRole("button", { name: "Close request" }))
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
    rerender(tabs({ tab: "network", rowKey: payKey, nonce: 2 }))
    expect(screen.getByText("POST /api/pay")).toBeTruthy()
  })

  test("coming back to the Network tab shows the table, not the request opened earlier", () => {
    render(tabs({ tab: "network", rowKey: payKey, nonce: 1 }))
    expect(screen.getByText("POST /api/pay")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close request" }))
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Network/ }))
    expect(screen.queryByText("POST /api/pay")).toBeNull()
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy()
  })
})

test("Info lists the recording's notes, and a note's time moves the video there", () => {
  const view = normalizePayload({
    recordingStartedAt: 1000,
    events: [],
    notes: [{ n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }],
  })
  const seek = mock()
  render(
    <DebuggerTabs
      report={reportFixture({ captureType: "video" })}
      state={{ status: "ready", view }}
      onRetry={() => {}}
      playback={{ currentMs: null, seek }}
    />,
  )
  fireEvent.click(screen.getByRole("tab", { name: /Overview/ }))
  expect(screen.getByText("Notes")).toBeTruthy()
  expect(screen.getByText("Spins forever")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "0:31" }))
  expect(seek).toHaveBeenCalledWith(31_000)
})

describe("onboarding in the DevTools panel", () => {
  const view = normalizePayload({ capturedAt: 2000, events: [{ kind: "console", t: 1500, level: "error", args: ["boom"] }] })
  const onboarding = (record = mock()): OnboardingContext => ({
    progress: { phase: "required", steps: [{ id: "devtools", done: false }], collapsed: false, reportTarget: null, trackerTarget: null },
    next: "devtools",
    record,
    setCollapsed: mock(),
  })
  const tabs = (focus: DebuggerFocus | null = null) => (
    <DebuggerTabs report={reportFixture()} state={{ status: "ready", view }} onRetry={() => {}} focus={focus} />
  )

  test("the Console and Network tabs pulse while DevTools is next, and choosing one counts", () => {
    const record = mock()
    render(<OnboardingTestProvider value={onboarding(record)}>{tabs()}</OnboardingTestProvider>)
    expect(screen.getByRole("tab", { name: /Console/ }).hasAttribute("data-onboarding-pulse")).toBe(true)
    expect(screen.getByRole("tab", { name: /Network/ }).hasAttribute("data-onboarding-pulse")).toBe(true)
    expect(screen.getByText("These errors and requests happened alongside the video. Take a look.")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }))
    expect(record).toHaveBeenCalledWith("devtools")
  })

  test("an automatic tab switch does not count", () => {
    const record = mock()
    render(<OnboardingTestProvider value={onboarding(record)}>{tabs({ tab: "console", nonce: 1 })}</OnboardingTestProvider>)
    expect(screen.getByRole("tab", { name: /Console/ }).getAttribute("aria-selected")).toBe("true")
    expect(record).not.toHaveBeenCalled()
  })

  test("opening Console counts even before DevTools is next", () => {
    const record = mock()
    const early: OnboardingContext = {
      ...onboarding(record),
      next: "video",
      progress: { phase: "required", steps: [{ id: "video", done: false }, { id: "devtools", done: false }], collapsed: false, reportTarget: null, trackerTarget: null },
    }
    render(<OnboardingTestProvider value={early}>{tabs()}</OnboardingTestProvider>)
    expect(document.querySelector("[data-onboarding-pulse]")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: /Network/ }))
    expect(record).toHaveBeenCalledWith("devtools")
  })

  test("no pulse without onboarding", () => {
    render(tabs())
    expect(document.querySelector("[data-onboarding-pulse]")).toBeNull()
  })
})
