import { describe, expect, test } from "bun:test"
import { encodeReplayMedia } from "@bugberry/shared"
import { loadReplay, loadReplayWithRefresh } from "../src/features/reports/debugger/replay"

const META = { type: 4, timestamp: 10_000, data: { href: "http://localhost:3000/", width: 800, height: 600 } }
const SNAP = { type: 2, timestamp: 10_000, data: {} }
const frame = (timestamp: number) => ({ type: 5, timestamp, data: { tag: "bugberry:frame", payload: { jpeg: "/9j/" } } })

function fakeServer(routes: Record<string, () => Response>) {
  const requested: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    return routes[url]?.() ?? new Response("missing", { status: 404 })
  }) as typeof fetch
  return { fetcher, requested }
}

const media = () => encodeReplayMedia({ version: 1, events: [META, SNAP, frame(15_000), frame(20_000)] })

describe("loadReplay", () => {
  test("downloads and unzips the events, with their frames and length", async () => {
    const gz = await media()
    const { fetcher } = fakeServer({ "https://files.test/m.gz": () => new Response(gz) })
    const replay = await loadReplay("https://files.test/m.gz", fetcher)
    expect(replay.events).toHaveLength(4)
    expect(replay.durationMs).toBe(10_000)
    expect(replay.frames).toEqual([
      { atMs: 5_000, jpeg: "/9j/" },
      { atMs: 10_000, jpeg: "/9j/" },
    ])
  })

  test("a gzip of the wrong shape is refused", async () => {
    const { fetcher } = fakeServer({ "https://files.test/bad.gz": () => new Response(Bun.gzipSync(JSON.stringify({ hello: 1 }))) })
    await expect(loadReplay("https://files.test/bad.gz", fetcher)).rejects.toThrow("Unsupported replay media")
  })
})

describe("loadReplayWithRefresh", () => {
  test("asks for a fresh URL once when the old one has expired", async () => {
    const gz = await media()
    const { fetcher, requested } = fakeServer({
      "https://files.test/old.gz": () => new Response("expired", { status: 403 }),
      "https://files.test/new.gz": () => new Response(gz),
    })
    const replay = await loadReplayWithRefresh("https://files.test/old.gz", async () => "https://files.test/new.gz", fetcher)
    expect(replay.durationMs).toBe(10_000)
    expect(requested).toEqual(["https://files.test/old.gz", "https://files.test/new.gz"])
  })

  test("gives up when no fresh URL comes", async () => {
    const { fetcher } = fakeServer({ "https://files.test/old.gz": () => new Response("expired", { status: 403 }) })
    await expect(loadReplayWithRefresh("https://files.test/old.gz", async () => null, fetcher)).rejects.toThrow("HTTP 403")
  })
})
