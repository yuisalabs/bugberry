import { beforeEach, expect, mock, test } from "bun:test"
import { createSentAwayStorage, type SentAway, type SentAwayStorage } from "../../lib/drafts/sent-away"
import { createOutboxRunner, type OutboxDeps, SERVER_KEPT_FAILING_ERROR } from "../../lib/drafts/outbox-runner"
import { OUTBOX_MAX_SERVER_TRIES } from "../../lib/drafts/outbox"
import type { DraftStore } from "../../lib/drafts/draft-store"
import { ApiError, type BugberryApi } from "../../lib/server/api"
import { LOCKED, type UploadDeps } from "../../lib/review/upload"
import type { DraftOutbox, ReportDraft, ReportForm } from "../../lib/shared/types"

const NOW = 1_000_000
const DRAFT_ID = "d1"
const SERVER = "https://bb.test"
const form: ReportForm = { workspaceId: "w1", projectId: "p1", title: "Pay fails", description: "", priority: "high", visibility: "internal" }

function memoryStore(): DraftStore {
  const drafts = new Map<string, ReportDraft>()
  return {
    put: async (draft) => void drafts.set(draft.id, structuredClone(draft)),
    get: async (id) => (drafts.has(id) ? structuredClone(drafts.get(id)!) : null),
    list: async () => [...drafts.values()].map((draft) => structuredClone(draft)),
    delete: async (id) => void drafts.delete(id),
  }
}

const outbox = (overrides: Partial<DraftOutbox> = {}): DraftOutbox => ({
  screenshot: new Blob(["exported"], { type: "image/png" }),
  thumbnail: null,
  serverUrl: SERVER,
  tries: 0,
  nextTryAt: NOW,
  ...overrides,
})

const queued = (overrides: Partial<ReportDraft> = {}): ReportDraft =>
  ({
    id: DRAFT_ID,
    createdAt: 1,
    captureType: "screenshot",
    page: { url: "https://app.test/pay", title: "Pay" },
    device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
    screenshot: new Blob(["raw"]),
    annotations: [],
    debuggerPayload: null,
    debuggerGzip: null,
    status: "queued",
    error: "Upload interrupted",
    session: null,
    form,
    outbox: outbox(),
    ...overrides,
  }) as ReportDraft

let store: DraftStore
let sentAway: SentAwayStorage
let api: {
  createUpload: ReturnType<typeof mock>
  finalize: ReturnType<typeof mock>
  updateReport: ReturnType<typeof mock>
}
let putFile: UploadDeps["putFile"]
let lock: UploadDeps["lock"]
let online: boolean
let settings: { serverUrl: string } | null
let run: () => Promise<{ sent: number; waiting: number }>

const target = (name: string) => ({ method: "PUT" as const, url: `https://up.test/${name}`, headers: {} })

beforeEach(async () => {
  store = memoryStore()
  let stored: SentAway[] | null = null
  sentAway = createSentAwayStorage({ get: async () => stored, set: async (value) => void (stored = value) })
  api = {
    createUpload: mock(async () => ({
      reportId: "r1",
      reportUrl: `${SERVER}/app/r/r1`,
      shareUrl: `${SERVER}/s/r1`,
      mediaUpload: target("media"),
      mediaParts: null,
      debuggerUpload: null,
      thumbnailUpload: null,
    })),
    finalize: mock(async (id: string) => ({ id, uploadStatus: "ready", reportUrl: `${SERVER}/app/r/${id}`, shareUrl: `${SERVER}/s/${id}` })),
    updateReport: mock(async () => ({})),
  }
  putFile = async () => {}
  lock = undefined
  online = true
  settings = { serverUrl: SERVER }
  await store.put(queued())
  const deps: OutboxDeps = {
    store,
    settings: async () => settings,
    apiFor: () => api as unknown as BugberryApi,
    uploadDeps: (current) => ({
      api: api as unknown as UploadDeps["api"],
      store,
      putFile: (...args) => putFile(...args),
      sleep: async () => {},
      lock,
      serverUrl: current.serverUrl,
    }),
    online: () => online,
    now: () => NOW,
    sentAway,
    setLastWorkspace: async () => {},
  }
  run = createOutboxRunner(deps)
})

const unreachable = () => {
  putFile = async () => {
    throw new ApiError(0, "network", "Upload interrupted")
  }
}

test("offline: nothing is tried", async () => {
  online = false
  expect(await run()).toEqual({ sent: 0, waiting: 1 })
  expect(api.createUpload).not.toHaveBeenCalled()
})

test("no settings: nothing is tried", async () => {
  settings = null
  expect(await run()).toEqual({ sent: 0, waiting: 1 })
  expect(api.createUpload).not.toHaveBeenCalled()
})

test("a due draft is sent, removed, and listed as sent while away", async () => {
  expect(await run()).toEqual({ sent: 1, waiting: 0 })
  expect(await store.get(DRAFT_ID)).toBeNull()
  expect(await sentAway.list()).toMatchObject([{ draftId: DRAFT_ID, title: "Pay fails", reportUrl: "https://bb.test/app/r/r1", sentAt: NOW }])
})

test("a draft not due yet is left for later", async () => {
  await store.put(queued({ outbox: outbox({ nextTryAt: NOW + 1 }) }))
  expect(await run()).toEqual({ sent: 0, waiting: 1 })
  expect(api.createUpload).not.toHaveBeenCalled()
})

test("the assignee is set after the send", async () => {
  await store.put(queued({ form: { ...form, assigneeId: "u2" } }))
  await run()
  expect(api.updateReport).toHaveBeenCalledWith("r1", { assigneeId: "u2" })
})

test("still unreachable: tries goes up and the next try moves out", async () => {
  unreachable()
  expect(await run()).toEqual({ sent: 0, waiting: 1 })
  const after = await store.get(DRAFT_ID)
  expect(after?.status).toBe("queued")
  expect(after?.outbox).toMatchObject({ tries: 1, nextTryAt: NOW + 2 * 60_000 })
})

test("signed out: the draft fails and is not tried again", async () => {
  api.createUpload.mockImplementation(async () => {
    throw new ApiError(401, "unauthorized", "Login required")
  })
  await run()
  expect((await store.get(DRAFT_ID))?.status).toBe("failed")
  await run()
  expect(api.createUpload).toHaveBeenCalledTimes(1)
})

test("a draft queued for another server is failed, never sent", async () => {
  await store.put(queued({ outbox: outbox({ serverUrl: "https://a.test" }) }))
  settings = { serverUrl: "https://b.test" }
  await run()
  expect(await store.get(DRAFT_ID)).toMatchObject({ status: "failed", error: "This draft was made for another server. Open it to send it again." })
  expect(api.createUpload).not.toHaveBeenCalled()
})

test("a draft whose lock is held is left exactly as it was", async () => {
  const before = await store.get(DRAFT_ID)
  lock = async () => LOCKED
  expect(await run()).toEqual({ sent: 0, waiting: 1 })
  expect(await store.get(DRAFT_ID)).toEqual(before)
})

test("a draft that can't be sent without the editor fails with a message", async () => {
  await store.put(queued({ outbox: outbox({ screenshot: null }) }))
  await run()
  expect(await store.get(DRAFT_ID)).toMatchObject({ status: "failed", error: "Open this draft to send it." })
  expect(api.createUpload).not.toHaveBeenCalled()
})

test("the next try is booked before the send starts", async () => {
  let seen: DraftOutbox | null | undefined
  putFile = async () => {
    seen = (await store.get(DRAFT_ID))?.outbox
  }
  await run()
  expect(seen).toMatchObject({ tries: 1, nextTryAt: NOW + 2 * 60_000 })
})

test("a draft taken out of the queue before the lock was had is not sent", async () => {
  lock = async (_name, work) => {
    const current = (await store.get(DRAFT_ID))!
    await store.put({ ...current, status: "editing" })
    return work()
  }
  await run()
  expect(api.createUpload).not.toHaveBeenCalled()
  expect((await store.get(DRAFT_ID))?.status).toBe("editing")
})

test("a draft for another server that is being sent elsewhere is left as it was", async () => {
  await store.put(queued({ outbox: outbox({ serverUrl: "https://a.test" }) }))
  const before = await store.get(DRAFT_ID)
  lock = async () => LOCKED
  await run()
  expect(await store.get(DRAFT_ID)).toEqual(before)
})

test("two calls at once run one flush", async () => {
  await Promise.all([run(), run()])
  expect(api.createUpload).toHaveBeenCalledTimes(1)
})

const serverDown = () => {
  api.finalize.mockImplementation(async () => {
    throw new ApiError(503, "unavailable", "Service unavailable")
  })
}

test("a server that answers with an error leaves the draft waiting for the server, not the connection", async () => {
  serverDown()
  await run()
  expect((await store.get(DRAFT_ID))?.outbox).toMatchObject({ tries: 1, lastError: "server" })
})

test("a lost connection leaves the draft waiting for the connection", async () => {
  unreachable()
  await run()
  expect((await store.get(DRAFT_ID))?.outbox).toMatchObject({ lastError: "network" })
})

test("a server that keeps failing: the last try fails the draft with a message", async () => {
  serverDown()
  await store.put(queued({ outbox: outbox({ tries: OUTBOX_MAX_SERVER_TRIES - 1 }) }))
  await run()
  expect(await store.get(DRAFT_ID)).toMatchObject({ status: "failed", error: SERVER_KEPT_FAILING_ERROR })
})

test("a lost connection is tried for as long as it takes", async () => {
  unreachable()
  await store.put(queued({ outbox: outbox({ tries: OUTBOX_MAX_SERVER_TRIES + 5 }) }))
  await run()
  expect((await store.get(DRAFT_ID))?.status).toBe("queued")
})
