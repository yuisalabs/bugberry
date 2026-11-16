import { describe, expect, mock, test } from "bun:test"
import { ApiError } from "@bugberry/shared"
import { RequestClosed, type SendDeps, sendRecording } from "../src/features/requests/request-upload"

const target = (name: string) => ({ method: "PUT" as const, url: `https://files.test/${name}`, headers: {} })

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

function setup() {
  const storage = memoryStorage()
  const api = {
    start: mock(async () => ({ uploadToken: "ticket-1", mediaUpload: target("media"), thumbnailUpload: target("thumb") })),
    ticket: mock(async () => ({ mediaUpload: target("media-again"), thumbnailUpload: target("thumb-again") })),
    finalize: mock(async () => ({ id: "r1" })),
  }
  const put = mock(async (_target: { url: string }, _body: Blob, onProgress: (fraction: number) => void) => onProgress(1))
  const sleep = mock(async () => {})
  const deps: SendDeps = { api, put, storage, sleep }
  return { storage, api, put, sleep, deps }
}

const input = {
  media: new Blob([new Uint8Array(4)], { type: "video/webm" }),
  thumbnail: new Blob([new Uint8Array(2)], { type: "image/jpeg" }),
  captureType: "video" as const,
  durationMs: 4000,
  name: "Budi",
  email: "",
  description: "It spins",
  pageUrl: "https://shop.test/cart",
  device: { browser: "Chrome 131", os: "Windows 11", viewport: "1440x900" },
}
const KEY = "bugberry-request-tok"

describe("sending a recording", () => {
  test("starts, uploads, finalizes, and forgets the ticket", async () => {
    const s = setup()
    const progress: number[] = []
    await sendRecording(s.deps, "tok", input, (fraction) => progress.push(fraction))
    expect(s.api.start).toHaveBeenCalledWith("tok", {
      name: "Budi",
      description: "It spins",
      captureType: "video",
      mediaSize: 4,
      thumbnailSize: 2,
      durationMs: 4000,
      pageUrl: "https://shop.test/cart",
      device: input.device,
    })
    expect(s.put.mock.calls.map((call) => call[0].url)).toEqual(["https://files.test/media", "https://files.test/thumb"])
    expect(s.api.finalize).toHaveBeenCalledWith("ticket-1")
    expect(s.storage.data.has(KEY)).toBe(false)
    expect(progress.at(-1)).toBe(1)
  })

  test("the ticket is kept while the upload runs", async () => {
    const s = setup()
    s.put.mockImplementationOnce(async () => {
      expect(JSON.parse(s.storage.getItem(KEY) ?? "{}")).toEqual({ uploadToken: "ticket-1", mediaSize: 4 })
    })
    await sendRecording(s.deps, "tok", input, () => {})
  })

  test("a reload mid-upload goes on with the kept ticket: one start in all", async () => {
    const s = setup()
    s.put.mockImplementation(async () => {
      throw new Error("tab closed")
    })
    await expect(sendRecording(s.deps, "tok", input, () => {})).rejects.toThrow()
    expect(s.storage.data.has(KEY)).toBe(true)
    s.put.mockImplementation(async (_t, _b, onProgress) => onProgress(1))
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.api.start).toHaveBeenCalledTimes(1)
    expect(s.api.ticket).toHaveBeenCalledWith("ticket-1")
    expect(s.api.finalize).toHaveBeenCalledTimes(1)
    expect(s.put.mock.calls.at(-2)?.[0].url).toBe("https://files.test/media-again")
  })

  test("a kept ticket for another file is not used", async () => {
    const s = setup()
    s.storage.setItem(KEY, JSON.stringify({ uploadToken: "old", mediaSize: 999 }))
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.api.ticket).not.toHaveBeenCalled()
    expect(s.api.start).toHaveBeenCalledTimes(1)
  })

  test("a ticket that expired starts once more", async () => {
    const s = setup()
    s.storage.setItem(KEY, JSON.stringify({ uploadToken: "old", mediaSize: 4 }))
    s.api.ticket.mockImplementationOnce(async () => {
      throw new ApiError(410, "upload_link_expired", "expired")
    })
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.api.start).toHaveBeenCalledTimes(1)
    expect(s.api.finalize).toHaveBeenCalledWith("ticket-1")
  })

  test("a kept ticket already used means it was sent: nothing more to do", async () => {
    const s = setup()
    s.storage.setItem(KEY, JSON.stringify({ uploadToken: "old", mediaSize: 4 }))
    s.api.ticket.mockImplementationOnce(async () => {
      throw new ApiError(410, "upload_link_used", "used")
    })
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.api.start).not.toHaveBeenCalled()
    expect(s.storage.data.has(KEY)).toBe(false)
  })

  test("a link that died throws RequestClosed and keeps nothing", async () => {
    const s = setup()
    s.api.start.mockImplementationOnce(async () => {
      throw new ApiError(404, "request_unavailable", "This link doesn't take recordings.")
    })
    await expect(sendRecording(s.deps, "tok", input, () => {})).rejects.toBeInstanceOf(RequestClosed)
    expect(s.storage.data.has(KEY)).toBe(false)
    expect(s.put).not.toHaveBeenCalled()
  })

  test("network failures are tried again after 1, 3 and 9 seconds", async () => {
    const s = setup()
    let failures = 3
    s.api.finalize.mockImplementation(async () => {
      if (failures-- > 0) throw new ApiError(0, "network", "offline")
      return { id: "r1" }
    })
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([1000, 3000, 9000])
  })

  test("the thumbnail failing doesn't fail the send", async () => {
    const s = setup()
    s.put.mockImplementation(async (t, _b, onProgress) => {
      if (t.url.includes("thumb")) throw new Error("nope")
      onProgress(1)
    })
    await sendRecording(s.deps, "tok", input, () => {})
    expect(s.api.finalize).toHaveBeenCalledTimes(1)
  })

  test("a screenshot sends no length and no thumbnail", async () => {
    const s = setup()
    s.api.start.mockImplementationOnce(async () => ({ uploadToken: "ticket-1", mediaUpload: target("media"), thumbnailUpload: null as never }))
    await sendRecording(s.deps, "tok", { ...input, captureType: "screenshot", durationMs: null, thumbnail: null, email: "b@c.test" }, () => {})
    const body = (s.api.start.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(body.durationMs).toBeUndefined()
    expect(body.thumbnailSize).toBeUndefined()
    expect(body.email).toBe("b@c.test")
    expect(s.put).toHaveBeenCalledTimes(1)
  })
})
