import { describe, expect, test } from "bun:test"
import { ApiError } from "../lib/api"
import { fullWarning, isFull, limitsFor, sendBlocked, usageLine, type WorkspaceLimits } from "../lib/limits"
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
