import { beforeEach, describe, expect, test } from "bun:test"
import { type CameraGrant, cameraTicketReply, createCameraGrants, uiStateReply } from "../lib/camera-grant"

let stored: CameraGrant | null
let timers: Array<() => void>
let tokens: number

function setup() {
  return createCameraGrants({
    store: {
      get: async () => stored,
      set: async (grant) => {
        stored = grant
      },
    },
    newToken: () => `token-${++tokens}`,
    setTimer: (run) => {
      timers.push(run)
      return () => {
        timers = timers.filter((timer) => timer !== run)
      }
    },
  })
}

beforeEach(() => {
  stored = null
  timers = []
  tokens = 0
})

describe("camera grants", () => {
  test("read gives the choice to the granted tab only", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: "cam1", shape: "circle" })
    expect(await grants.read(token, 7)).toEqual({ deviceId: "cam1", shape: "circle" })
    expect(await grants.read(token, 8)).toBeNull()
    expect(await grants.read("other", 7)).toBeNull()
    expect(await grants.read(token, undefined)).toBeNull()
  })

  test("a closed grant gives nothing", async () => {
    const grants = setup()
    const opened = await grants.open(7, { deviceId: null, shape: "circle" })
    expect(await grants.close()).toEqual(opened)
    expect(await grants.read(opened.token, 7)).toBeNull()
    expect(await grants.forTab(7)).toBeNull()
    expect(await grants.close()).toBeNull()
  })

  test("a new grant replaces the old token", async () => {
    const grants = setup()
    const first = await grants.open(7, { deviceId: null, shape: "circle" })
    const second = await grants.open(7, { deviceId: null, shape: "rectangle" })
    expect(await grants.read(first.token, 7)).toBeNull()
    expect(await grants.read(second.token, 7)).toEqual({ deviceId: null, shape: "rectangle" })
  })

  test("waitReady resolves on ready from the granted tab", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: null, shape: "circle" })
    const waiting = grants.waitReady(token, 1500)
    await grants.ready(token, 7)
    expect(await waiting).toBe("ready")
    expect(timers).toHaveLength(0)
  })

  test("a ready from another tab doesn't count; the timeout ends the wait", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: null, shape: "circle" })
    const waiting = grants.waitReady(token, 1500)
    await grants.ready(token, 8)
    for (const timer of timers) timer()
    expect(await waiting).toBe("timeout")
  })

  test("a bubble that can't show the camera ends the wait at once, from the granted tab only", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: null, shape: "circle" })
    const waiting = grants.waitReady(token, 1500)
    await grants.fail(token, 8)
    await grants.fail(token, 7)
    expect(await waiting).toBe("failed")
    expect(timers).toHaveLength(0)
  })

  test("forTab gives token and shape, never the device", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: "cam1", shape: "rectangle" })
    expect(await grants.forTab(7)).toEqual({ token, shape: "rectangle" })
    expect(await grants.forTab(8)).toBeNull()
    expect(await grants.forTab(undefined)).toBeNull()
  })
})

describe("the background's answers", () => {
  test("a camera ticket: read gives the choice, ready and failed end the wait, all from the granted tab", async () => {
    const grants = setup()
    const { token } = await grants.open(7, { deviceId: "cam1", shape: "circle" })
    expect(await cameraTicketReply(grants, { type: "bugberry:camera-ticket", token, action: "read" }, 7)).toEqual({ deviceId: "cam1", shape: "circle" })
    expect(await cameraTicketReply(grants, { type: "bugberry:camera-ticket", token, action: "read" }, 8)).toBeNull()
    const ready = grants.waitReady(token, 1500)
    expect(await cameraTicketReply(grants, { type: "bugberry:camera-ticket", token, action: "ready" }, 7)).toEqual({ ok: true })
    expect(await ready).toBe("ready")
    const failed = grants.waitReady(token, 1500)
    await cameraTicketReply(grants, { type: "bugberry:camera-ticket", token, action: "failed" }, 7)
    expect(await failed).toBe("failed")
  })

  test("ui-state: the recording for its own tab, and the camera whenever this tab has one", () => {
    const state = { tabId: 7, draftId: "d1" }
    const camera = { token: "t", shape: "circle" as const }
    expect(uiStateReply(state, camera, 7)).toEqual({ recording: true, session: "d1", camera })
    expect(uiStateReply(state, null, 8)).toEqual({ recording: false })
    // During the countdown the camera grant exists before the recording state.
    expect(uiStateReply(null, camera, 7)).toEqual({ recording: false, camera })
  })
})
