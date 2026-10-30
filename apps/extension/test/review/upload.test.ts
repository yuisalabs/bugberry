import { beforeEach, describe, expect, test } from "bun:test"
import { type CaptureEvent, decodeDebuggerPayload } from "@bugberry/capture"
import { ApiError, type CreateUploadBody, type UploadSession } from "../../lib/server/api"
import type { DraftStore } from "../../lib/drafts/draft-store"
import type { ReportDraft, UploadTarget } from "../../lib/shared/types"
import { LOCKED, type PutRequest, putFile, type ReportForm, sha256, submitDraft, type UploadDeps, type UploadProgress } from "../../lib/review/upload"

const form: ReportForm = { workspaceId: "w1", projectId: "p1", title: "Pay button fails", description: "", priority: "high", visibility: "internal" }

function memoryStore(): DraftStore & { drafts: Map<string, ReportDraft> } {
  const drafts = new Map<string, ReportDraft>()
  return {
    drafts,
    put: async (draft) => void drafts.set(draft.id, structuredClone(draft)),
    get: async (id) => drafts.get(id) ?? null,
    list: async () => [...drafts.values()],
    delete: async (id) => void drafts.delete(id),
  }
}

const target = (name: string): UploadTarget => ({ method: "PUT", url: `https://up.test/${name}`, headers: {} })

function session(id: string): UploadSession {
  return {
    reportId: id,
    reportUrl: `https://bugberry.test/r/${id}`,
    shareUrl: `https://bugberry.test/s/${id}`,
    mediaUpload: target(`${id}-media`),
    mediaParts: null,
    debuggerUpload: target(`${id}-debugger`),
    thumbnailUpload: target(`${id}-thumbnail`),
  }
}

let store: ReturnType<typeof memoryStore>
let calls: string[]
let bodies: CreateUploadBody[]
let uploaded: Map<string, Blob>
let sleeps: number[]
let deps: UploadDeps
let failures: Array<() => never>
let sessions: number

const media = new Blob(["annotated-png"], { type: "image/png" })

beforeEach(async () => {
  store = memoryStore()
  calls = []
  bodies = []
  uploaded = new Map()
  sleeps = []
  failures = []
  sessions = 0
  await store.put({
    id: "d1",
    createdAt: 1,
    captureType: "screenshot",
    page: { url: "https://app.test/pay", title: "Bayar" },
    device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
    screenshot: new Blob(["original"]),
    debuggerPayload: {
      version: 1,
      capturedAt: 1,
      recordingStartedAt: null,
      incomplete: [],
      events: [{ kind: "console", t: 1, level: "error", args: ["boom"] }],
    },
    debuggerGzip: null,
    status: "editing",
    error: null,
    session: null,
    form: null,
    annotations: [],
  })
  deps = {
    api: {
      createUpload: async (body) => {
        calls.push("createUpload")
        bodies.push(body)
        sessions += 1
        return session(`r${sessions}`)
      },
      finalize: async (reportId) => {
        calls.push(`finalize:${reportId}`)
        const failure = failures.shift()
        if (failure) failure()
        return { id: reportId, uploadStatus: "ready" as const, reportUrl: `https://bugberry.test/r/${reportId}`, shareUrl: `https://bugberry.test/s/${reportId}` }
      },
    },
    store,
    putFile: async (uploadTarget, body) => {
      calls.push(`put:${uploadTarget.url.split("/").at(-1)}`)
      uploaded.set(uploadTarget.url, body)
    },
    sleep: async (ms) => void sleeps.push(ms),
    serverUrl: "https://b.test",
  }
})

describe("the reporter's city", () => {
  const JAKARTA = { latitude: -6.21, longitude: 106.85 }

  test("a report with a location posts it after finalize", async () => {
    const posted: unknown[] = []
    deps.api.setLocation = async (reportId, coords) => {
      calls.push(`location:${reportId}`)
      posted.push(coords)
      return { location: "Jakarta, Indonesia" }
    }
    await submitDraft("d1", form, media, deps, null, { location: JAKARTA })
    expect(calls.slice(-2)).toEqual(["finalize:r1", "location:r1"])
    expect(posted).toEqual([JAKARTA])
  })

  test("an older server without the location endpoint still gets the report", async () => {
    deps.api.setLocation = async () => {
      throw new ApiError(404, "not_found", "Not found")
    }
    expect(await submitDraft("d1", form, media, deps, null, { location: JAKARTA })).toEqual({
      id: "r1",
      reportUrl: "https://bugberry.test/r/r1",
      shareUrl: "https://bugberry.test/s/r1",
    })
  })

  test("without a location nothing is posted", async () => {
    deps.api.setLocation = async () => {
      throw new Error("must not be called")
    }
    await submitDraft("d1", form, media, deps)
    expect(calls.some((call) => call.startsWith("location"))).toBe(false)
  })

  test("the draft never holds coordinates", async () => {
    const saved: string[] = []
    const put = store.put
    store.put = async (draft) => {
      saved.push(JSON.stringify(draft))
      await put(draft)
    }
    deps.api.setLocation = async () => ({ location: null })
    failures.push(() => {
      throw new ApiError(503, "unavailable", "Try later")
    })
    await submitDraft("d1", form, media, deps, null, { location: JAKARTA })
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.some((json) => json.includes("106.85") || json.includes("latitude"))).toBe(false)
  })
})

describe("thumbnails", () => {
  const thumb = new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" })

  test("uploads the thumbnail with the media and declares its size", async () => {
    await submitDraft("d1", form, media, deps, thumb)
    expect(bodies[0]).toMatchObject({ thumbnailSize: 3 })
    expect(calls).toContain("put:r1-thumbnail")
    expect(uploaded.get("https://up.test/r1-thumbnail")).toBe(thumb)
    expect(calls.at(-1)).toBe("finalize:r1")
  })

  test("declares no thumbnail when there is none", async () => {
    await submitDraft("d1", form, media, deps, null)
    expect(bodies[0]).not.toHaveProperty("thumbnailSize")
    expect(calls).not.toContain("put:r1-thumbnail")
  })

  test("a failed thumbnail upload never fails the report", async () => {
    const putThumbnailFails: UploadDeps["putFile"] = async (uploadTarget, body) => {
      if (uploadTarget.url.endsWith("-thumbnail")) throw new ApiError(500, "upload_failed", "boom")
      return deps.putFile(uploadTarget, body)
    }
    const result = await submitDraft("d1", form, media, { ...deps, putFile: putThumbnailFails }, thumb)
    expect(result.reportUrl).toContain("r1")
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  test("resumes a session saved before thumbnails existed", async () => {
    const draft = await store.get("d1")
    if (!draft) throw new Error("expected draft")
    const { thumbnailUpload: _dropped, ...oldSession } = session("r7")
    await store.put({
      ...draft,
      form,
      debuggerGzip: new Blob(["gz"]),
      session: { ...oldSession, mediaSize: media.size, mediaHash: await sha256(media), mediaUploaded: true, debuggerUploaded: true },
    })
    await submitDraft("d1", form, media, deps, thumb)
    expect(calls).toEqual(["finalize:r7"])
  })
})

describe("submitDraft", () => {
  test("sends no projectId when the form has none", async () => {
    await submitDraft("d1", { ...form, projectId: "" }, media, deps)
    expect(bodies[0]).not.toHaveProperty("projectId")
  })

  test("changing the project to none starts a new session", async () => {
    failures.push(() => {
      throw new ApiError(422, "rejected", "ditolak")
    })
    await submitDraft("d1", form, media, deps).catch(() => {})
    await submitDraft("d1", { ...form, projectId: "" }, media, deps)
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(2)
    expect(bodies[1]).not.toHaveProperty("projectId")
  })

  test("video drafts send their duration with the upload session", async () => {
    await store.put({
      id: "v1",
      createdAt: 2,
      captureType: "video",
      page: { url: "https://app.test/pay", title: "Bayar" },
      device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
      video: new Blob(["webm"]),
      durationMs: 12_345,
      recordingStartedAt: 1000,
      debuggerPayload: null,
      debuggerGzip: null,
      status: "editing",
      error: null,
      session: null,
      form: null,
    })
    const video = new Blob(["webm-bytes"], { type: "video/webm" })
    await submitDraft("v1", form, video, deps)
    expect(bodies[0]).toMatchObject({ captureType: "video", durationMs: 12_345, mediaSize: video.size })
    expect(bodies[0]?.debuggerSize).toBeUndefined()
    expect(calls).toEqual(["createUpload", "put:r1-media", "finalize:r1"])
  })

  test("a trimmed send uploads the given payload and length, and leaves the draft's own payload whole", async () => {
    const kept: CaptureEvent = { kind: "console", t: 2000, level: "error", args: ["kept"] }
    const events: CaptureEvent[] = [kept, { kind: "console", t: 9000, level: "error", args: ["cut"] }, { kind: "action", t: 9500, type: "click", target: "b" }]
    const whole = { version: 1 as const, capturedAt: 1, recordingStartedAt: 1000, incomplete: [], events }
    await store.put({
      id: "v2",
      createdAt: 2,
      captureType: "video",
      page: { url: "https://app.test/pay", title: "Bayar" },
      device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
      video: new Blob(["webm"]),
      durationMs: 42_000,
      recordingStartedAt: 1000,
      debuggerPayload: whole,
      debuggerGzip: null,
      status: "editing",
      error: null,
      session: null,
      form: null,
    })
    // Kept as failed, so the draft can be read afterwards.
    failures.push(() => {
      throw new ApiError(400, "invalid", "nope")
    })
    const cut = { ...whole, recordingStartedAt: 1500, events: [kept] }
    await expect(submitDraft("v2", form, new Blob(["cut-webm"]), deps, null, { payload: cut, durationMs: 29_000 })).rejects.toThrow()

    expect(bodies[0]).toMatchObject({ durationMs: 29_000, debuggerSummary: { errors: 1, actions: 0 } })
    const gzip = [...uploaded].find(([url]) => url.includes("debugger"))?.[1] as Blob
    expect((await decodeDebuggerPayload(gzip)).events).toEqual([kept])
    expect((await store.get("v2"))?.debuggerPayload?.events).toHaveLength(3)
  })

  test("creates the session, uploads both files, finalizes and removes the draft", async () => {
    const result = await submitDraft("d1", form, media, deps)
    expect(result).toEqual({ id: "r1", reportUrl: "https://bugberry.test/r/r1", shareUrl: "https://bugberry.test/s/r1" })
    expect(calls).toEqual(["createUpload", "put:r1-media", "put:r1-debugger", "finalize:r1"])
    expect(bodies[0]).toMatchObject({
      projectId: "p1",
      title: "Pay button fails",
      priority: "high",
      captureType: "screenshot",
      mediaSize: media.size,
      pageUrl: "https://app.test/pay",
      debuggerSummary: { logs: 1, errors: 1 },
    })
    const gzip = uploaded.get("https://up.test/r1-debugger") as Blob
    expect(bodies[0]?.debuggerSize).toBe(gzip.size)
    expect((await decodeDebuggerPayload(gzip)).events).toHaveLength(1)
    expect(await store.get("d1")).toBeNull()
  })

  test("retries retryable failures with 1s, 3s backoff", async () => {
    failures = [
      () => {
        throw new ApiError(0, "network", "offline")
      },
      () => {
        throw new ApiError(503, "unavailable", "busy")
      },
    ]
    await submitDraft("d1", form, media, deps)
    expect(sleeps).toEqual([1000, 3000])
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
  })

  test("after four failed attempts the draft is kept as failed and resumes later without a second report", async () => {
    const offline = () => {
      throw new ApiError(0, "network", "Can't reach the BugBerry server")
    }
    failures = [offline, offline, offline, offline]
    await expect(submitDraft("d1", form, media, deps)).rejects.toThrow("Can't reach the BugBerry server")
    expect(sleeps).toEqual([1000, 3000, 9000])
    const failed = await store.get("d1")
    expect(failed).toMatchObject({ status: "failed", error: "Can't reach the BugBerry server" })
    expect(failed?.session).toMatchObject({ reportId: "r1", mediaUploaded: true, debuggerUploaded: true })

    calls = []
    await submitDraft("d1", form, media, deps)
    expect(calls).toEqual(["finalize:r1"])
  })

  test("does not retry errors the user must fix", async () => {
    deps.api.createUpload = async () => {
      throw new ApiError(401, "unauthorized", "Login required")
    }
    await expect(submitDraft("d1", form, media, deps)).rejects.toThrow("Login required")
    expect(sleeps).toEqual([])
    expect(await store.get("d1")).toMatchObject({ status: "failed", error: "Login required" })
  })

  test("an expired upload link starts a new session", async () => {
    let expired = true
    const put = deps.putFile
    deps.putFile = async (uploadTarget, body) => {
      if (expired && uploadTarget.url.endsWith("r1-media")) {
        expired = false
        throw new ApiError(403, "upload_expired", "The upload link has expired")
      }
      return put(uploadTarget, body)
    }
    const result = await submitDraft("d1", form, media, deps)
    expect(result.reportUrl).toBe("https://bugberry.test/r/r2")
  })

  test("a changed annotation after a failed attempt starts a new session", async () => {
    const offline = () => {
      throw new ApiError(0, "network", "offline")
    }
    failures = [offline, offline, offline, offline]
    await submitDraft("d1", form, media, deps).catch(() => {})
    const edited = new Blob(["annotated-png-with-more-arrows"], { type: "image/png" })
    const result = await submitDraft("d1", form, edited, deps)
    expect(result.reportUrl).toBe("https://bugberry.test/r/r2")
    expect(bodies[1]?.mediaSize).toBe(edited.size)
  })

  test("a changed annotation of exactly the same size still starts a new session", async () => {
    const offline = () => {
      throw new ApiError(0, "network", "offline")
    }
    failures = [offline, offline, offline, offline]
    await submitDraft("d1", form, media, deps).catch(() => {})
    const sameSize = new Blob(["annotated-PNG"], { type: "image/png" })
    expect(sameSize.size).toBe(media.size)
    const result = await submitDraft("d1", form, sameSize, deps)
    expect(result.reportUrl).toBe("https://bugberry.test/r/r2")
  })

  test("the media and debugger files upload at the same time", async () => {
    const started: string[] = []
    const release: Array<() => void> = []
    deps.putFile = (uploadTarget) => {
      started.push(uploadTarget.url.split("/").at(-1) ?? "")
      return new Promise<void>((resolve) => release.push(resolve))
    }
    const submitting = submitDraft("d1", form, media, deps)
    for (let tick = 0; tick < 20 && started.length < 2; tick++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual(["r1-media", "r1-debugger"])
    for (const resolve of release) resolve()
    expect((await submitting).reportUrl).toBe("https://bugberry.test/r/r1")
  })

  test("the same draft sent from two editor tabs at once becomes one report", async () => {
    const held = new Set<string>()
    deps.lock = async (name, work) => {
      if (held.has(name)) return LOCKED
      held.add(name)
      try {
        return await work()
      } finally {
        held.delete(name)
      }
    }
    const results = await Promise.allSettled([submitDraft("d1", form, media, deps), submitDraft("d1", form, media, deps)])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(String(refused.reason)).toContain("being sent from another tab")
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
  })

  test("a finalize that lost its report starts a new session", async () => {
    failures = [
      () => {
        throw new ApiError(404, "report_not_found", "Report not found")
      },
    ]
    const result = await submitDraft("d1", form, media, deps)
    expect(result.reportUrl).toBe("https://bugberry.test/r/r2")
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(2)
  })

  test("changing the form after a failed attempt starts a new session with the new values", async () => {
    const offline = () => {
      throw new ApiError(0, "network", "offline")
    }
    failures = [offline, offline, offline, offline]
    const publicForm: ReportForm = { ...form, visibility: "public" }
    await submitDraft("d1", publicForm, media, deps).catch(() => {})
    expect((await store.get("d1"))?.form).toEqual(publicForm)

    const result = await submitDraft("d1", { ...form, visibility: "internal" }, media, deps)
    expect(result.reportUrl).toBe("https://bugberry.test/r/r2")
    expect(bodies[1]?.visibility).toBe("internal")
  })
})

describe("media in parts", () => {
  // 10 bytes in parts of 4: "0123", "4567", "89".
  const video = new Blob(["0123456789"], { type: "video/webm" })

  beforeEach(() => {
    deps.api.createUpload = async (body) => {
      calls.push("createUpload")
      bodies.push(body)
      sessions += 1
      const id = `r${sessions}`
      return {
        ...session(id),
        mediaUpload: null,
        mediaParts: { partSize: 4, parts: [target(`${id}-part1`), target(`${id}-part2`), target(`${id}-part3`)] },
      }
    }
  })

  const textOf = async (name: string) => {
    const body = uploaded.get(`https://up.test/${name}`)
    return body ? await body.text() : undefined
  }

  test("asks for parts, sends each slice in order, then finalizes", async () => {
    await submitDraft("d1", form, video, deps)
    expect(bodies[0]?.multipart).toBe(true)
    expect(calls.filter((call) => call.includes("part"))).toEqual(["put:r1-part1", "put:r1-part2", "put:r1-part3"])
    expect([await textOf("r1-part1"), await textOf("r1-part2"), await textOf("r1-part3")]).toEqual(["0123", "4567", "89"])
    expect(calls.at(-1)).toBe("finalize:r1")
    expect(calls.some((call) => call === "put:r1-media")).toBe(false)
  })

  test("a failed part is sent again without the parts before it", async () => {
    let failed = false
    const put = deps.putFile
    deps.putFile = async (uploadTarget, body) => {
      if (!failed && uploadTarget.url.endsWith("r1-part2")) {
        failed = true
        calls.push("fail:r1-part2")
        throw new ApiError(0, "network", "Upload interrupted")
      }
      return put(uploadTarget, body)
    }
    await submitDraft("d1", form, video, deps)
    expect(calls.filter((call) => call.includes("part"))).toEqual(["put:r1-part1", "fail:r1-part2", "put:r1-part2", "put:r1-part3"])
    expect(sleeps).toEqual([1000])
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
  })

  test("a draft that failed keeps how far the parts got, and goes on from there later", async () => {
    deps.putFile = async (uploadTarget, body) => {
      if (uploadTarget.url.endsWith("r1-part3")) throw new ApiError(0, "network", "Upload interrupted")
      calls.push(`put:${uploadTarget.url.split("/").at(-1)}`)
      uploaded.set(uploadTarget.url, body)
    }
    await expect(submitDraft("d1", form, video, deps)).rejects.toThrow("Upload interrupted")
    expect((await store.get("d1"))?.session).toMatchObject({ reportId: "r1", mediaPartsUploaded: 2, mediaUploaded: false })

    calls = []
    deps.putFile = async (uploadTarget) => void calls.push(`put:${uploadTarget.url.split("/").at(-1)}`)
    await submitDraft("d1", form, video, deps)
    expect(calls.filter((call) => call.includes("part"))).toEqual(["put:r1-part3"])
    expect(calls.at(-1)).toBe("finalize:r1")
  })

  test("the draft is written as often for ten parts as for three: never once per part", async () => {
    const original = await store.get("d1")
    if (!original) throw new Error("expected the draft")
    let writes = 0
    const put = store.put
    store.put = async (draft) => {
      writes++
      await put(draft)
    }
    await submitDraft("d1", form, video, deps)
    const threeParts = writes

    await put(original)
    writes = 0
    deps.api.createUpload = async () => ({
      ...session("r9"),
      mediaUpload: null,
      mediaParts: { partSize: 1, parts: Array.from({ length: 10 }, (_, index) => target(`r9-part${index + 1}`)) },
    })
    await submitDraft("d1", form, video, deps)
    expect(calls.filter((call) => call.startsWith("put:r9-part"))).toHaveLength(10)
    expect(writes).toBe(threeParts)
  })

  test("an expired part link is signed again and the same upload goes on", async () => {
    const put = deps.putFile
    deps.putFile = async (uploadTarget, body) => {
      if (uploadTarget.url.endsWith("r1-part2")) throw new ApiError(403, "upload_expired", "The upload link has expired")
      return put(uploadTarget, body)
    }
    deps.api.mediaParts = async (reportId) => {
      calls.push(`mediaParts:${reportId}`)
      return { partSize: 4, parts: [target("r1-new1"), target("r1-new2"), target("r1-new3")] }
    }
    const result = await submitDraft("d1", form, video, deps)
    expect(result.id).toBe("r1")
    expect(calls.filter((call) => /part|Parts|new/.test(call))).toEqual([
      "put:r1-part1",
      "mediaParts:r1",
      "put:r1-new2",
      "put:r1-new3",
    ])
    expect(await textOf("r1-new2")).toBe("4567")
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
  })

  test("when new links can't be had, an expired part link starts a new report as before", async () => {
    const put = deps.putFile
    deps.putFile = async (uploadTarget, body) => {
      if (uploadTarget.url.endsWith("r1-part2")) throw new ApiError(403, "upload_expired", "The upload link has expired")
      return put(uploadTarget, body)
    }
    deps.api.mediaParts = async () => {
      throw new ApiError(409, "not_in_parts", "This report has no upload in parts to go on with")
    }
    const result = await submitDraft("d1", form, video, deps)
    expect(result.id).toBe("r2")
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(2)
  })

  test("links that don't match the file are refused", async () => {
    deps.api.createUpload = async () => ({ ...session("r1"), mediaUpload: null, mediaParts: { partSize: 4, parts: [target("r1-part1")] } })
    await expect(submitDraft("d1", form, video, deps)).rejects.toThrow("The server's upload links don't match the file")
    expect(calls.some((call) => call.startsWith("put:r1-part"))).toBe(false)
  })
})

describe("sessions and workspaces", () => {
  test("changing the workspace starts a new upload session", async () => {
    failures = [
      () => {
        throw new ApiError(422, "validation", "nope")
      },
    ]
    await expect(submitDraft("d1", form, media, deps)).rejects.toThrow()
    calls = []
    await submitDraft("d1", { ...form, workspaceId: "w2", projectId: "" }, media, deps)
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
    expect(bodies.at(-1)).toMatchObject({ workspaceId: "w2" })
  })
})

describe("sessions and servers", () => {
  async function storeSession(serverUrl: string | undefined) {
    const draft = await store.get("d1")
    if (!draft) throw new Error("expected draft")
    await store.put({
      ...draft,
      form,
      debuggerGzip: new Blob(["gz"]),
      session: {
        ...session("r7"),
        ...(serverUrl ? { serverUrl } : {}),
        mediaSize: media.size,
        mediaHash: await sha256(media),
        mediaUploaded: true,
        debuggerUploaded: true,
        thumbnailUploaded: true,
      },
    })
  }

  test("a session made on another server is not reused", async () => {
    await storeSession("https://a.test")
    await submitDraft("d1", form, media, deps)
    expect(calls.filter((call) => call === "createUpload")).toHaveLength(1)
    expect(calls.at(-1)).toBe("finalize:r1")
  })

  test("a new session remembers its server", async () => {
    failures = [
      () => {
        throw new ApiError(422, "validation", "nope")
      },
    ]
    await expect(submitDraft("d1", form, media, deps)).rejects.toThrow()
    expect((await store.get("d1"))?.session?.serverUrl).toBe("https://b.test")
  })

  test("a legacy session without serverUrl is reused", async () => {
    await storeSession(undefined)
    await submitDraft("d1", form, media, deps)
    expect(calls).toEqual(["finalize:r7"])
  })

  test("401 keeps the session for the next try", async () => {
    failures = [
      () => {
        throw new ApiError(401, "unauthorized", "Your session ended. Sign in, then send again.")
      },
    ]
    await expect(submitDraft("d1", form, media, deps)).rejects.toMatchObject({ status: 401 })
    expect(sleeps).toEqual([])
    const failed = await store.get("d1")
    expect(failed).toMatchObject({ status: "failed" })
    expect(failed?.session).toMatchObject({ reportId: "r1", mediaUploaded: true })

    calls = []
    await submitDraft("d1", form, media, deps)
    expect(calls).toEqual(["finalize:r1"])
  })
})

describe("putFile", () => {
  const respond = (status: number): PutRequest => async (_target, body, onProgress) => {
    onProgress(body.size)
    return status
  }

  test("accepts success and 'already uploaded'", async () => {
    await putFile(target("a"), media, undefined, respond(200))
    await putFile(target("a"), media, undefined, respond(204))
    await putFile(target("a"), media, undefined, respond(409))
  })

  test("passes on how much has been sent", async () => {
    const seen: number[] = []
    const request: PutRequest = async (_target, _body, onProgress) => {
      for (const bytes of [3, 8, 13]) onProgress(bytes)
      return 200
    }
    await putFile(target("a"), media, (bytes) => seen.push(bytes), request)
    expect(seen).toEqual([3, 8, 13])
  })

  test("maps expired links, other failures and network errors", async () => {
    const failed = (request: PutRequest) => putFile(target("a"), media, undefined, request).catch((error) => error)
    expect(await failed(respond(403))).toMatchObject({ code: "upload_expired" })
    expect(await failed(respond(500))).toMatchObject({ status: 500, retryable: true })
    expect(await failed(respond(0))).toMatchObject({ status: 0, retryable: true })
    expect(
      await failed(async () => {
        throw new Error("Upload interrupted")
      }),
    ).toMatchObject({ status: 0, retryable: true })
  })
})

describe("upload progress", () => {
  const video = new Blob(["0123456789"], { type: "video/webm" })
  let reports: UploadProgress[]

  beforeEach(() => {
    reports = []
    // Each PUT reports its body in two halves, as a browser would.
    deps.putFile = async (uploadTarget, body, onProgress) => {
      onProgress?.(Math.floor(body.size / 2))
      onProgress?.(body.size)
      calls.push(`put:${uploadTarget.url.split("/").at(-1)}`)
    }
  })

  test("counts all files together, never past the total, and reaches it before finalize", async () => {
    const thumbnail = new Blob(["thumb"])
    let atFinalize: UploadProgress | undefined
    const finalize = deps.api.finalize
    deps.api.finalize = async (reportId) => {
      atFinalize = reports.at(-1)
      return finalize(reportId)
    }
    await submitDraft("d1", form, video, deps, thumbnail, { onProgress: (progress) => reports.push(progress) })
    const total = reports[0]?.total ?? 0
    // The video, the thumbnail and the gzipped debugger data.
    expect(total).toBeGreaterThan(video.size + thumbnail.size)
    expect(reports.every((progress) => progress.total === total && progress.sent <= total)).toBe(true)
    expect(reports[0]?.sent).toBe(0)
    expect(atFinalize).toEqual({ sent: total, total })
  })

  test("parts add up: a part's bytes count from where it starts in the file", async () => {
    deps.api.createUpload = async () => ({
      ...session("r1"),
      debuggerUpload: null,
      thumbnailUpload: null,
      mediaUpload: null,
      mediaParts: { partSize: 4, parts: [target("r1-part1"), target("r1-part2"), target("r1-part3")] },
    })
    await submitDraft("d1", form, video, deps, null, { onProgress: (progress) => reports.push(progress) })
    expect(reports.map((progress) => progress.sent)).toEqual([0, 2, 4, 6, 8, 9, 10, 10])
    expect(reports.every((progress) => progress.total === 10)).toBe(true)
  })

  test("a draft resumed after its first parts went up starts from there", async () => {
    deps.api.createUpload = async () => ({
      ...session("r1"),
      debuggerUpload: null,
      thumbnailUpload: null,
      mediaUpload: null,
      mediaParts: { partSize: 4, parts: [target("r1-part1"), target("r1-part2"), target("r1-part3")] },
    })
    const put = deps.putFile
    deps.putFile = async (uploadTarget, body, onProgress) => {
      if (uploadTarget.url.endsWith("r1-part3")) throw new ApiError(400, "upload_failed", "Upload failed (HTTP 400)")
      return put(uploadTarget, body, onProgress)
    }
    await expect(submitDraft("d1", form, video, deps)).rejects.toThrow("HTTP 400")

    deps.putFile = put
    await submitDraft("d1", form, video, deps, null, { onProgress: (progress) => reports.push(progress) })
    expect(reports.map((progress) => progress.sent)).toEqual([8, 9, 10, 10])
  })
})
