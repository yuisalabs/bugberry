import { describe, expect, mock, test } from "bun:test"
import type { WorkspaceLimits } from "../lib/limits"
import { createReviewLimits, type LimitNote, NO_LIMIT_NOTE, openDashboardFor } from "../lib/review-limits"
import type { UploadSessionState } from "../lib/types"

const full: WorkspaceLimits = { limited: true, screenshots: { used: 0, max: 5 }, recordings: { used: 5, max: 5 } }
const room: WorkspaceLimits = { limited: true, screenshots: { used: 0, max: 5 }, recordings: { used: 2, max: 5 } }
const workspaces = [
  { id: "a", role: "admin" },
  { id: "b", role: "member" },
]

/** fetchLimits answers when the test says so, in any order. */
function controlled() {
  const pending: Array<{ id: string; resolve(limits: WorkspaceLimits | null): void }> = []
  const fetchLimits = (id: string) => new Promise<WorkspaceLimits | null>((resolve) => pending.push({ id, resolve }))
  return { pending, fetchLimits }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createReviewLimits", () => {
  test("switching workspace clears the old full state at once, before the new answer", async () => {
    const notes: LimitNote[] = []
    const { pending, fetchLimits } = controlled()
    const limits = createReviewLimits({ kind: "video", workspaces, fetchLimits, currentDraft: async () => null, onChange: (note) => notes.push(note) }, "a")
    void limits.refresh()
    pending[0]?.resolve(full)
    await settle()
    expect(notes.at(-1)?.blocked).toBe(true)
    void limits.select("b")
    expect(notes.at(-1)).toEqual(NO_LIMIT_NOTE)
    pending[1]?.resolve(room)
    await settle()
    expect(notes.at(-1)).toMatchObject({ blocked: false, warning: null, usage: "Recordings 2/5", admin: false })
  })

  test("a late answer for the workspace left behind is dropped", async () => {
    const notes: LimitNote[] = []
    const { pending, fetchLimits } = controlled()
    const limits = createReviewLimits({ kind: "video", workspaces, fetchLimits, currentDraft: async () => null, onChange: (note) => notes.push(note) }, "a")
    void limits.refresh()
    void limits.select("b")
    pending[1]?.resolve(room)
    await settle()
    pending[0]?.resolve(full)
    await settle()
    expect(notes.at(-1)).toMatchObject({ blocked: false, usage: "Recordings 2/5" })
  })

  test("an older answer for the same workspace can't overwrite a newer one", async () => {
    const notes: LimitNote[] = []
    const { pending, fetchLimits } = controlled()
    const limits = createReviewLimits({ kind: "video", workspaces, fetchLimits, currentDraft: async () => null, onChange: (note) => notes.push(note) }, "a")
    void limits.refresh()
    void limits.refresh()
    pending[1]?.resolve(room)
    await settle()
    pending[0]?.resolve(full)
    await settle()
    expect(notes.at(-1)).toMatchObject({ blocked: false })
  })

  test("the draft is read at each refresh, so a send that started its own upload isn't held back", async () => {
    const notes: LimitNote[] = []
    let draft: { session: UploadSessionState | null; form: { workspaceId: string } | null } | null = null
    const limits = createReviewLimits(
      { kind: "video", workspaces, fetchLimits: async () => full, currentDraft: async () => draft as never, onChange: (note) => notes.push(note) },
      "a",
    )
    await limits.refresh()
    expect(notes.at(-1)).toMatchObject({ blocked: true, admin: true })
    expect(notes.at(-1)?.warning).toBe("This workspace already has 5 recordings. Delete one in the dashboard, or pick another workspace.")
    draft = { session: { reportId: "r1" } as UploadSessionState, form: { workspaceId: "a" } }
    await limits.refresh()
    expect(notes.at(-1)).toMatchObject({ blocked: false, warning: null })
  })
})

describe("openDashboardFor", () => {
  test("switches the dashboard to the workspace, then opens a tab, even when the switch fails", async () => {
    const order: string[] = []
    const openTab = mock((url: string) => void order.push(`open ${url}`))
    await openDashboardFor("a", "https://b.test", { setCurrentWorkspace: async () => void order.push("switch a"), openTab })
    await openDashboardFor("a", "https://b.test", { setCurrentWorkspace: () => Promise.reject(new Error("x")), openTab })
    expect(order).toEqual(["switch a", "open https://b.test/app", "open https://b.test/app"])
  })
})

describe("a recording longer than the workspace takes", () => {
  const timed: WorkspaceLimits = { limited: true, screenshots: { used: 0, max: 5 }, recordings: { used: 1, max: 5 }, maxRecordingMs: 120_000 }
  const noteFor = async (kind: "video" | "screenshot", durationMs: number) => {
    const notes: LimitNote[] = []
    const limits = createReviewLimits(
      { kind, durationMs, workspaces, fetchLimits: async () => timed, currentDraft: async () => null, onChange: (note) => notes.push(note) },
      "a",
    )
    await limits.refresh()
    return notes.at(-1)
  }

  test("holds Create report back and says why", async () => {
    expect(await noteFor("video", 180_000)).toMatchObject({
      blocked: true,
      usage: "Recordings 1/5",
      warning: "This recording is 3:00; this workspace takes recordings up to 2:00. Trim it or record a shorter one, or pick another workspace.",
    })
  })

  test("trimmed to fit, it goes", async () => {
    expect(await noteFor("video", 90_000)).toMatchObject({ blocked: false, warning: null })
  })

  test("a screenshot has no length", async () => {
    expect(await noteFor("screenshot", 180_000)).toMatchObject({ blocked: false, warning: null })
  })
})
