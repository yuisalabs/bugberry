import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "../src/events"
import { summarize } from "../src/summary"

describe("summarize", () => {
  test("counts each kind, with console errors and failed requests called out", () => {
    const events: CaptureEvent[] = [
      { kind: "console", t: 1, level: "log", args: [] },
      { kind: "console", t: 2, level: "error", args: [] },
      { kind: "error", t: 3, message: "boom" },
      { kind: "network", t: 4, method: "GET", url: "a", status: 200 },
      { kind: "network", t: 5, method: "GET", url: "b", status: 503 },
      { kind: "network", t: 6, method: "GET", url: "c", failed: "TypeError: Failed to fetch" },
      { kind: "action", t: 7, type: "click" },
    ]
    expect(summarize(events, ["xhr"])).toEqual({
      logs: 2,
      errors: 2,
      requests: 3,
      failedRequests: 2,
      actions: 1,
      incomplete: ["xhr"],
    })
  })
})
