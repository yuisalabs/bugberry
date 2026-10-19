import { describe, expect, mock, test } from "bun:test"
import type { CaptureResult } from "../lib/capture-flow"
import { createTakeAgain } from "../lib/take-again"
import type { ReportDraft } from "../lib/types"

const draft = { id: "d1", captureType: "screenshot", tabId: 7, screenshotMode: "area" } as unknown as ReportDraft
const tab = { id: 7, windowId: 1, url: "https://app.test/" }

function setup(result: CaptureResult, stored: ReportDraft | null = draft) {
  const order: string[] = []
  const deps = {
    getDraft: mock(async () => stored),
    getTab: mock(async () => tab),
    deleteDraft: mock(async (id: string) => void order.push(`delete ${id}`)),
    hideReview: mock(async () => void order.push("hide")),
    showReview: mock(async (id: string) => void order.push(`show ${id}`)),
    screenshot: mock(async () => {
      order.push("screenshot")
      return result
    }),
    record: mock(async () => {
      order.push("record")
      return result
    }),
  }
  return { takeAgain: createTakeAgain(deps), deps, order }
}

describe("Record again and Retake", () => {
  test("the old draft goes only once the new capture has started", async () => {
    const { takeAgain, deps, order } = setup({ ok: true, draftId: "d2" })
    expect(await takeAgain("d1")).toEqual({ ok: true, draftId: "d2" })
    expect(order).toEqual(["hide", "screenshot", "delete d1"])
    expect(deps.screenshot).toHaveBeenCalledWith(tab, "area")
  })

  test("a capture that fails or is cancelled keeps the old draft and brings its review back", async () => {
    const { takeAgain, deps, order } = setup({ ok: false, error: "Another recording is still running" })
    expect(await takeAgain("d1")).toMatchObject({ ok: false })
    expect(deps.deleteDraft).not.toHaveBeenCalled()
    expect(order).toEqual(["hide", "screenshot", "show d1"])
  })

  test("a recording is taken again as a recording", async () => {
    const { takeAgain, deps } = setup({ ok: true, draftId: "d2" }, { ...draft, captureType: "video" } as ReportDraft)
    await takeAgain("d1")
    expect(deps.record).toHaveBeenCalledWith(tab)
  })

  test("a gone draft or tab says so and changes nothing", async () => {
    const gone = setup({ ok: true, draftId: "d2" }, null)
    expect(await gone.takeAgain("d1")).toEqual({ ok: false, error: "This report is gone" })
    const closed = setup({ ok: true, draftId: "d2" })
    closed.deps.getTab.mockImplementation(async () => null as never)
    expect(await closed.takeAgain("d1")).toEqual({ ok: false, error: "The page this came from was closed." })
    expect(closed.deps.deleteDraft).not.toHaveBeenCalled()
  })
})
