import { describe, expect, test } from "bun:test"
import { ApiError } from "../lib/api"
import { fullWarning, isFull, limitsFor, recordingCap, sendBlocked, sizeProblem, sizeWarning, usageLine, type WorkspaceLimits } from "../lib/limits"
import type { UploadSessionState } from "../lib/types"

const full: WorkspaceLimits = { limited: true, screenshots: { used: 3, max: 5 }, recordings: { used: 5, max: 5 } }
const admin = { isAdmin: true, hasOtherWorkspaces: true }

describe("limitsFor", () => {
  test("the server's answer", async () => {
    expect(await limitsFor({ workspaceLimits: async () => full }, "w1")).toEqual(full)
  })

  test("an older server without the endpoint means no limits", async () => {
    const api = { workspaceLimits: async (): Promise<WorkspaceLimits> => Promise.reject(new ApiError(404, "not_found", "x")) }
    expect(await limitsFor(api, "w1")).toEqual({ limited: false })
  })

  test("any other failure is unknown", async () => {
    const api = { workspaceLimits: async (): Promise<WorkspaceLimits> => Promise.reject(new ApiError(0, "network", "x")) }
    expect(await limitsFor(api, "w1")).toBeNull()
  })
})

describe("isFull and usageLine", () => {
  test("full when used reaches max, also when over", () => {
    expect(isFull(full, "video")).toBe(true)
    expect(isFull(full, "screenshot")).toBe(false)
    expect(isFull({ limited: true, screenshots: { used: 7, max: 5 }, recordings: { used: 0, max: 5 } }, "screenshot")).toBe(true)
    expect(isFull(null, "video")).toBe(false)
    expect(isFull({ limited: false }, "video")).toBe(false)
  })

  test("both kinds in the popup, one kind on review", () => {
    expect(usageLine(full)).toBe("Screenshots 3/5 · Recordings 5/5")
    expect(usageLine(full, "video")).toBe("Recordings 5/5")
    expect(usageLine(null)).toBeNull()
    expect(usageLine({ limited: false }, "video")).toBeNull()
  })
})

describe("fullWarning", () => {
  test("popup, admin with other workspaces", () => {
    expect(fullWarning(full, "video", "popup", admin)).toBe(
      "This workspace is full for recordings. Delete one in the dashboard, or send to another workspace.",
    )
  })

  test("review, admin with only this workspace", () => {
    expect(fullWarning(full, "video", "review", { isAdmin: true, hasOtherWorkspaces: false })).toBe(
      "This workspace already has 5 recordings. Delete one in the dashboard.",
    )
  })

  test("review, not an admin", () => {
    expect(fullWarning(full, "video", "review", { isAdmin: false, hasOtherWorkspaces: true })).toBe(
      "This workspace already has 5 recordings. Ask a workspace admin to delete one, or pick another workspace.",
    )
  })

  test("nothing while there is room, singular at a max of 1", () => {
    expect(fullWarning(full, "screenshot", "popup", admin)).toBeNull()
    const one: WorkspaceLimits = { limited: true, screenshots: { used: 0, max: 1 }, recordings: { used: 1, max: 1 } }
    expect(fullWarning(one, "video", "review", { isAdmin: true, hasOtherWorkspaces: false })).toBe(
      "This workspace already has 1 recording. Delete one in the dashboard.",
    )
  })
})

describe("sendBlocked", () => {
  const resuming = { session: { reportId: "r1" } as UploadSessionState, form: { workspaceId: "w1" } as never }

  test("blocked only for a full workspace", () => {
    expect(sendBlocked(full, "video", null, "w1")).toBe(true)
    expect(sendBlocked(full, "screenshot", null, "w1")).toBe(false)
    expect(sendBlocked(null, "video", null, "w1")).toBe(false)
  })

  test("never for a draft resuming its own upload into that workspace", () => {
    expect(sendBlocked(full, "video", resuming, "w1")).toBe(false)
    expect(sendBlocked(full, "video", resuming, "w2")).toBe(true)
  })
})

describe("size limits", () => {
  const MB = 1024 * 1024
  const sized = (usedMb: number): WorkspaceLimits => ({
    limited: true,
    screenshots: { used: 1, max: 5 },
    recordings: { used: 1, max: 5 },
    storage: { used: usedMb * MB, max: 250 * MB },
    maxFileBytes: 50 * MB,
  })

  test("usage shows the storage too, when the server sends it", () => {
    expect(usageLine(sized(120))).toBe("Screenshots 1/5 · Recordings 1/5 · 120 MB of 250 MB")
    expect(usageLine(sized(120), "video")).toBe("Recordings 1/5 · 120 MB of 250 MB")
  })

  test("a file over the limit, or more than the room left", () => {
    expect(sizeProblem(sized(0), 51 * MB)).toBe("file")
    expect(sizeProblem(sized(230), 30 * MB)).toBe("storage")
    expect(sizeProblem(sized(200), 50 * MB)).toBeNull()
    expect(sizeProblem({ limited: false }, 500 * MB)).toBeNull()
    expect(sizeWarning(sized(0), "video", 62 * MB, admin)).toBe(
      "This recording is 62 MB; this workspace takes files up to 50 MB. Record a shorter one, or pick another workspace.",
    )
    expect(sizeWarning(sized(240), "screenshot", 12 * MB, { isAdmin: false, hasOtherWorkspaces: false })).toBe(
      "This screenshot needs 12 MB, but this workspace has 10 MB left. Ask a workspace admin to delete a report.",
    )
  })

  test("Create report waits for a capture that doesn't fit, unless it resumes its own upload", () => {
    expect(sendBlocked(sized(0), "video", null, "w1", 51 * MB)).toBe(true)
    expect(sendBlocked(sized(0), "video", null, "w1", 10 * MB)).toBe(false)
  })

  test("a recording stops at 95% of the file limit or of the room left", () => {
    expect(recordingCap(sized(0))).toBe(Math.floor(50 * MB * 0.95))
    expect(recordingCap(sized(230))).toBe(Math.floor(20 * MB * 0.95))
    // Out of room: not capped by it (the popup warns instead).
    expect(recordingCap(sized(250))).toBe(Math.floor(50 * MB * 0.95))
    expect(recordingCap(full)).toBeNull()
    expect(recordingCap({ limited: false })).toBeNull()
  })

  test("a workspace out of storage warns in the popup like a full one", () => {
    expect(fullWarning(sized(250), "video", "popup", admin)).toBe(
      "This workspace has no storage left. Delete a report in the dashboard to make room, or send to another workspace.",
    )
    expect(fullWarning(sized(100), "video", "popup", admin)).toBeNull()
  })
})
