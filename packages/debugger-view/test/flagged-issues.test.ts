import { describe, expect, test } from "bun:test"
import { normalizePayload } from "../src/debugger-events"
import { flaggedIssues } from "../src/flagged-issues"
import { networkRows } from "../src/network-view"

const view = (events: unknown[], recordingStartedAt: number | null = 1000) =>
  normalizePayload({ version: 1, capturedAt: 99_000, recordingStartedAt, incomplete: [], events })
const VIDEO = { startedAt: 1000, durationMs: 60_000 }

describe("flaggedIssues", () => {
  test("ranks errors, 5xx, no-response and rage, then 4xx and console.error", () => {
    const issues = flaggedIssues(
      view([
        { kind: "console", t: 1100, level: "error", args: ["[payments] retry failed"] },
        { kind: "network", t: 1200, method: "GET", url: "https://shop.test/api/me", status: 404 },
        { kind: "action", t: 1300, type: "rage-click", target: "button#pay", value: "4" },
        { kind: "network", t: 1400, method: "GET", url: "https://shop.test/api/cart", failed: "TypeError: Failed to fetch" },
        { kind: "network", t: 1500, method: "POST", url: "https://shop.test/api/orders", status: 500 },
        { kind: "error", t: 1600, message: "TypeError: x is undefined", source: "https://shop.test/js/app.js:3:9" },
      ]),
      VIDEO,
    )
    expect(issues.map((issue) => [issue.level, issue.text])).toEqual([
      [1, "Uncaught TypeError: x is undefined"],
      [2, "POST /api/orders → 500"],
      [3, "Rage click ×4 on button#pay"],
      [3, "GET /api/cart, no response"],
      [4, "console.error: [payments] retry failed"],
      [4, "GET /api/me → 404"],
    ])
    expect(issues[0]?.source).toBe("app.js:3")
    expect(issues.map((issue) => issue.target.tab)).toEqual(["console", "network", "actions", "network", "console", "network"])
  })

  test("the same request merges, ignoring the query", () => {
    const payload = view([
      { kind: "network", t: 2000, method: "POST", url: "https://shop.test/api/orders?id=1", status: 500 },
      { kind: "network", t: 3000, method: "POST", url: "https://shop.test/api/orders?id=2", status: 500 },
    ])
    const [issue] = flaggedIssues(payload, VIDEO)
    expect(issue).toMatchObject({ level: 2, text: "POST /api/orders → 500 ×2", count: 2 })
    expect(issue?.target).toEqual({ tab: "network", rowKey: networkRows(payload.events)[0]?.key ?? "" })
  })

  test("a console.error repeating an uncaught error joins its row", () => {
    const issues = flaggedIssues(
      view([
        { kind: "error", t: 2000, message: "TypeError: x is undefined", source: "https://shop.test/app.js:1:2" },
        { kind: "console", t: 2001, level: "error", args: ["Uncaught TypeError: x is undefined"] },
        { kind: "console", t: 2002, level: "error", args: ["something else"] },
      ]),
      VIDEO,
    )
    expect(issues.map((issue) => [issue.level, issue.text, issue.count])).toEqual([
      [1, "Uncaught TypeError: x is undefined ×2", 2],
      [4, "console.error: something else", 1],
    ])
  })

  test("rage clicks on one element merge, keeping the largest count", () => {
    const [issue] = flaggedIssues(
      view([
        { kind: "action", t: 2000, type: "rage-click", target: "button#pay", value: "4" },
        { kind: "action", t: 5000, type: "rage-click", target: "button#pay", value: "2" },
      ]),
      VIDEO,
    )
    expect(issue).toMatchObject({ level: 3, text: "Rage click ×4 on button#pay · 2 times", count: 2 })
  })

  test("no-response requests are level 3", () => {
    const issues = flaggedIssues(
      view([
        { kind: "network", t: 2000, method: "GET", url: "https://shop.test/api/cart", failed: "aborted" },
        { kind: "network", t: 2100, method: "GET", url: "https://shop.test/api/cart", pending: true },
      ]),
      VIDEO,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 3, text: "GET /api/cart, no response ×2" })
  })

  test("times outside the video are labelled, not jumped to", () => {
    const at = (t: number, video: { startedAt: number | null; durationMs: number | null } | null, startedAt: number | null = 1000) =>
      flaggedIssues(view([{ kind: "network", t, method: "GET", url: "https://a.test/x", status: 500 }], startedAt), video)[0]?.time
    const recorded = { startedAt: 1000, durationMs: 4000 }
    expect(at(500, recorded)).toEqual({ kind: "before" })
    expect(at(3000, recorded)).toEqual({ kind: "video", offsetMs: 2000 })
    expect(at(9000, recorded)).toEqual({ kind: "after" })
    expect(at(9000, { startedAt: 1000, durationMs: null })).toEqual({ kind: "video", offsetMs: 8000 })
    expect(at(3000, { startedAt: null, durationMs: 4000 }, null)).toEqual({ kind: "none" })
    expect(at(3000, null)).toEqual({ kind: "none" })
  })

  test("a merged row takes its first time inside the video", () => {
    const [issue] = flaggedIssues(
      view([
        { kind: "network", t: 500, method: "GET", url: "https://a.test/x", status: 500 },
        { kind: "network", t: 2500, method: "GET", url: "https://a.test/x", status: 500 },
      ]),
      VIDEO,
    )
    expect(issue?.time).toEqual({ kind: "video", offsetMs: 1500 })
  })

  test("five thousand events are grouped quickly and correctly", () => {
    const events = Array.from({ length: 5000 }, (_, index) => ({
      kind: "network",
      t: 2000 + index,
      method: "POST",
      url: `https://shop.test/api/orders?n=${index}`,
      status: 500,
    }))
    const payload = view(events)
    const started = performance.now()
    const issues = flaggedIssues(payload, VIDEO)
    expect(performance.now() - started).toBeLessThan(200)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.count).toBe(5000)
  })

  test("nothing to flag gives an empty list", () => {
    expect(
      flaggedIssues(
        view([
          { kind: "network", t: 2000, method: "GET", url: "https://a.test/ok", status: 200 },
          { kind: "console", t: 2100, level: "log", args: ["hello"] },
          { kind: "action", t: 2200, type: "click", target: "a" },
        ]),
        VIDEO,
      ),
    ).toEqual([])
  })
})

describe("joining console errors to uncaught errors", () => {
  test("a short error message does not swallow unrelated console errors", () => {
    const issues = flaggedIssues(
      view([
        { kind: "error", t: 2000, message: "Uncaught Error" },
        { kind: "console", t: 2001, level: "error", args: ["Error: payment declined"] },
        { kind: "console", t: 9000, level: "error", args: ["[api] TypeError: failed to fetch"] },
      ]),
      VIDEO,
    )
    expect(issues.map((issue) => issue.text)).toEqual([
      "Uncaught Error",
      "console.error: Error: payment declined",
      "console.error: [api] TypeError: failed to fetch",
    ])
  })

  test("a long message joins only when the console line comes right after the error", () => {
    const issues = flaggedIssues(
      view([
        { kind: "error", t: 2000, message: "TypeError: cart.items is undefined" },
        { kind: "console", t: 2400, level: "error", args: ["The above error occurred: TypeError: cart.items is undefined"] },
        { kind: "console", t: 30000, level: "error", args: ["Retry failed: TypeError: cart.items is undefined"] },
      ]),
      VIDEO,
    )
    expect(issues.map((issue) => [issue.level, issue.count])).toEqual([
      [1, 2],
      [4, 1],
    ])
  })
})
