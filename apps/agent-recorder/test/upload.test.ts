import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { StoredRecording } from "../src/session"
import { submitRecording } from "../src/upload"

const SERVER = "https://bugs.kantor.test"
const LINK = `${SERVER}/api/agent-uploads/tok`

let dir: string
let recording: StoredRecording

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "upload-test-"))
  const file = (name: string, bytes: number[]) => {
    const path = join(dir, name)
    writeFileSync(path, Buffer.from(bytes))
    return path
  }
  recording = {
    recordingId: "rec-1",
    draftId: "d1",
    dir,
    mediaPath: file("media.webm", [1, 2, 3, 4, 5, 6, 7]),
    debuggerPath: file("debugger.json.gz", [9, 9]),
    thumbnailPath: file("thumbnail.jpg", [5]),
  }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

interface Call {
  method: string
  url: string
  body: number[]
}

/** A server answering the link's GET with `targets`, PUTs with `putStatus(call)`, and finalize with ready. */
function fakeServer(targets: Record<string, unknown>, putStatus: (call: Call, attempt: number) => number = () => 200, getStatus = 200) {
  const calls: Call[] = []
  const attempts = new Map<string, number>()
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? [...new Uint8Array(await new Response(init.body).arrayBuffer())] : []
    const call = { method, url: String(url), body }
    calls.push(call)
    if (method === "GET") {
      return new Response(JSON.stringify(getStatus === 200 ? targets : { code: "upload_link_expired", message: "This upload link expired. Call createUpload again." }), {
        status: getStatus,
      })
    }
    if (method === "PUT") {
      const attempt = (attempts.get(call.url) ?? 0) + 1
      attempts.set(call.url, attempt)
      return new Response(null, { status: putStatus(call, attempt) })
    }
    return new Response(JSON.stringify({ id: "r1", uploadStatus: "ready", reportUrl: `${SERVER}/app/r/r1` }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

const put = (url: string) => ({ method: "PUT", url, headers: {} })
const noWait = async () => {}

describe("submitRecording", () => {
  test("refuses a link on another origin", async () => {
    const { fetcher, calls } = fakeServer({})
    await expect(submitRecording(recording, "https://evil.test/api/agent-uploads/tok", { server: SERVER, fetcher })).rejects.toThrow(
      `This upload link is not on ${SERVER}`,
    )
    expect(calls).toEqual([])
  })

  test("a link on the right server but another path is refused before anything is fetched", async () => {
    const { fetcher, calls } = fakeServer({})
    for (const link of [
      `${SERVER}/api/avatars/u1/a1.png`,
      `${SERVER}/api/files/read-token`,
      `${LINK}?next=https://evil.test`,
      `${LINK}#x`,
      `${SERVER}/api/agent-uploads/tok/../../files/x`,
    ]) {
      await expect(submitRecording(recording, link, { server: SERVER, fetcher })).rejects.toThrow("not an upload link")
    }
    expect(calls).toEqual([])
  })

  test("never follows a redirect", async () => {
    const { fetcher, calls } = fakeServer({})
    const seen: Array<RequestInit | undefined> = []
    const watching = (async (url: string | URL, init?: RequestInit) => {
      seen.push(init)
      return fetcher(url, init)
    }) as unknown as typeof fetch
    await submitRecording(recording, LINK, { server: SERVER, fetcher: watching, sleep: noWait }).catch(() => {})
    expect(calls.length).toBeGreaterThan(0)
    for (const init of seen) expect(init?.redirect).toBe("error")
  })

  // Storage (S3) links are on another host, always https; the local driver serves from the server itself.
  test("targets that send the files anywhere but https or the server are refused", async () => {
    for (const url of ["http://evil.test/collect", "ftp://x/y", "not a url"]) {
      const { fetcher, calls } = fakeServer({ mediaUpload: put(url), mediaParts: null, debuggerUpload: null, thumbnailUpload: null })
      await expect(submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: noWait })).rejects.toThrow("unexpected")
      expect(calls.filter((call) => call.method === "PUT")).toEqual([])
    }
  })

  test("sends one link per file then finalizes", async () => {
    const { fetcher, calls } = fakeServer({
      mediaUpload: put(`${SERVER}/s/media`),
      mediaParts: null,
      debuggerUpload: put(`${SERVER}/s/debugger`),
      thumbnailUpload: put(`${SERVER}/s/thumb`),
    })
    expect(await submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: noWait })).toEqual({ reportUrl: `${SERVER}/app/r/r1` })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${LINK}`,
      `PUT ${SERVER}/s/media`,
      `PUT ${SERVER}/s/debugger`,
      `PUT ${SERVER}/s/thumb`,
      `POST ${LINK}/finalize`,
    ])
    expect(calls[1]?.body).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test("sends parts in order then finalizes", async () => {
    const { fetcher, calls } = fakeServer({
      mediaUpload: null,
      mediaParts: { partSize: 3, parts: [put(`${SERVER}/p/1`), put(`${SERVER}/p/2`), put(`${SERVER}/p/3`)] },
      debuggerUpload: put(`${SERVER}/s/debugger`),
      thumbnailUpload: null,
    })
    await submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: noWait })
    const parts = calls.filter((call) => call.url.includes("/p/"))
    expect(parts.map((call) => call.body)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })

  test("retries a failed PUT with 1, 3, 9 s waits", async () => {
    const waits: number[] = []
    const { fetcher } = fakeServer(
      { mediaUpload: put(`${SERVER}/s/media`), mediaParts: null, debuggerUpload: put(`${SERVER}/s/debugger`), thumbnailUpload: null },
      (call, attempt) => (call.url.endsWith("/media") && attempt <= 3 ? 503 : 200),
    )
    await submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: async (ms) => void waits.push(ms) })
    expect(waits).toEqual([1000, 3000, 9000])
  })

  test("a PUT that keeps failing gives up after the retries", async () => {
    const { fetcher, calls } = fakeServer(
      { mediaUpload: put(`${SERVER}/s/media`), mediaParts: null, debuggerUpload: null, thumbnailUpload: null },
      () => 503,
    )
    await expect(submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: noWait })).rejects.toThrow("Try submitRecording again")
    expect(calls.some((call) => call.method === "POST")).toBe(false)
  })

  test("expired link tells the agent to call createUpload again", async () => {
    const { fetcher } = fakeServer({}, () => 200, 410)
    await expect(submitRecording(recording, LINK, { server: SERVER, fetcher, sleep: noWait })).rejects.toThrow("Call createUpload again")
  })
})
