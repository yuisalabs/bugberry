import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "@bugberry/capture"
import { capPages, MAX_MERGED_EVENTS, mergePages } from "../../lib/recording/page-merge"

const log = (t: number, text = "x"): CaptureEvent => ({ kind: "console", t, level: "log", args: [text] })
const resource = (t: number): CaptureEvent => ({ kind: "resource", t, url: `https://shop.test/${t}.png`, initiatorType: "img" })

describe("capPages and custom fields", () => {
  test("only the newest page with fields keeps them, so a reloading page cannot grow the draft", () => {
    const fields = (n: number) => ({ fields: { load: n }, error: null, droppedKeys: 0 })
    const pages = [
      ...Array.from({ length: 50 }, (_, n) => ({ documentId: `p${n}`, events: [], incomplete: [], metadata: fields(n), url: `https://shop.test/${n}` })),
      { documentId: "last", events: [log(10)], incomplete: [] },
    ]
    const kept = capPages(pages)
    expect(kept.filter((page) => page.metadata?.fields)).toEqual([expect.objectContaining({ documentId: "p49", metadata: fields(49) })])
    expect(kept.map((page) => page.documentId)).toEqual(["p49", "last"])
  })
})

describe("mergePages", () => {
  test("pages are merged in time order and the current read replaces its stored copy", () => {
    const merged = mergePages(
      [
        { documentId: "first", events: [log(10, "cart"), log(30, "pay")], incomplete: ["xhr"] },
        { documentId: "second", events: [log(50, "stale")], incomplete: [] },
      ],
      { documentId: "second", events: [log(50, "fresh"), log(70, "done")], incomplete: ["fetch"] },
    )
    expect(merged.events.map((event) => (event.kind === "console" ? event.args[0] : ""))).toEqual(["cart", "pay", "fresh", "done"])
    expect(merged.incomplete).toEqual(["xhr", "fetch"])
  })

  test("a long multi-page recording keeps the newest events and drops resources first", () => {
    const logs = Array.from({ length: MAX_MERGED_EVENTS - 10 }, (_, index) => log(index))
    const resources = Array.from({ length: 50 }, (_, index) => resource(100_000 + index))
    const merged = mergePages([{ documentId: "a", events: [...logs, ...resources], incomplete: [] }], {
      documentId: "b",
      events: [log(200_000)],
      incomplete: [],
    })
    expect(MAX_MERGED_EVENTS).toBe(5000)
    expect(merged.events).toHaveLength(MAX_MERGED_EVENTS)
    expect(merged.events.filter((event) => event.kind === "console")).toHaveLength(MAX_MERGED_EVENTS - 9)
    expect(merged.events.filter((event) => event.kind === "resource").map((event) => event.t)[0]).toBe(100_041)
  })

  test("with no current page, the stored pages are still merged", () => {
    expect(mergePages([{ documentId: "a", events: [log(1)], incomplete: [] }], null).events).toHaveLength(1)
  })
})
