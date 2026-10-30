import { describe, expect, test } from "bun:test"
import { ApiError } from "../../lib/server/api"
import { fullWarning, isFull, lengthWarning, limitsFor, sendBlocked, usageLine, type WorkspaceLimits } from "../../lib/server/limits"
import type { UploadSessionState } from "../../lib/types"

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

describe("recording length", () => {
  const timed: WorkspaceLimits = { limited: true, screenshots: { used: 1, max: 5 }, recordings: { used: 1, max: 5 }, maxRecordingMs: 120_000 }

  test("usage counts reports only, even when a 0.7.0 server sends its storage", () => {
    const older = { ...timed, storage: { used: 1, max: 2 }, maxFileBytes: 3 } as WorkspaceLimits
    expect(usageLine(older)).toBe("Screenshots 1/5 · Recordings 1/5")
    expect(usageLine(older, "video")).toBe("Recordings 1/5")
  })

  test("a recording over the workspace's length, past its 2 s of slack", () => {
    expect(lengthWarning(timed, 190_000, admin)).toBe(
      "This recording is 3:10; this workspace takes recordings up to 2:00. Trim it or record a shorter one, or pick another workspace.",
    )
    expect(lengthWarning(timed, 190_000, { isAdmin: false, hasOtherWorkspaces: false })).toBe(
      "This recording is 3:10; this workspace takes recordings up to 2:00. Trim it or record a shorter one.",
    )
    expect(lengthWarning(timed, 125_000, admin)).toBeNull()
    expect(lengthWarning(full, 190_000, admin)).toBeNull()
    expect(lengthWarning({ limited: false }, 190_000, admin)).toBeNull()
  })

  test("Create report waits for a recording that is too long, unless it resumes its own upload", () => {
    const resuming = { session: { reportId: "r1" } as UploadSessionState, form: { workspaceId: "w1" } as never }
    expect(sendBlocked(timed, "video", null, "w1", 180_000)).toBe(true)
    expect(sendBlocked(timed, "video", null, "w1", 90_000)).toBe(false)
    expect(sendBlocked(timed, "video", resuming, "w1", 180_000)).toBe(false)
    expect(sendBlocked(timed, "screenshot", null, "w1", 180_000)).toBe(false)
  })
})
