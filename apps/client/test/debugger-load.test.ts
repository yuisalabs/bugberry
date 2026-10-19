import { describe, expect, test } from "bun:test"
import { type DebuggerPayload, encodeDebuggerPayload } from "@bugberry/capture"
import { loadDebugger, loadDebuggerWithRefresh } from "../src/lib/debugger"

const payload: DebuggerPayload = {
  version: 1,
  capturedAt: 2000,
  recordingStartedAt: null,
  incomplete: [],
  events: [{ kind: "console", t: 1500, level: "error", args: ["boom"] }],
}

function fakeServer(routes: Record<string, () => Response>) {
  const requested: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    return routes[url]?.() ?? new Response("missing", { status: 404 })
  }) as typeof fetch
  return { fetcher, requested }
}

describe("loadDebugger", () => {
  test("downloads, unzips and normalizes the payload", async () => {
    const gz = await encodeDebuggerPayload(payload)
    const { fetcher } = fakeServer({ "https://files.test/a.gz": () => new Response(gz) })
    const view = await loadDebugger("https://files.test/a.gz", fetcher)
    expect(view.capturedAt).toBe(2000)
    expect(view.events).toEqual([{ kind: "console", t: 1500, level: "error", text: "boom", stack: null, source: null }])
  })

  test("rejects a corrupt file", async () => {
    const { fetcher } = fakeServer({ "https://files.test/bad.gz": () => new Response("not gzip") })
    await expect(loadDebugger("https://files.test/bad.gz", fetcher)).rejects.toThrow()
  })
})

describe("loadDebuggerWithRefresh", () => {
  test("asks for a fresh URL once when the old one has expired", async () => {
    const gz = await encodeDebuggerPayload(payload)
    const { fetcher, requested } = fakeServer({
      "https://files.test/old.gz": () => new Response("expired", { status: 403 }),
      "https://files.test/new.gz": () => new Response(gz),
    })
    let refreshes = 0
    const view = await loadDebuggerWithRefresh(
      "https://files.test/old.gz",
      async () => {
        refreshes += 1
        return "https://files.test/new.gz"
      },
      fetcher,
    )
    expect(view.events).toHaveLength(1)
    expect(refreshes).toBe(1)
    expect(requested).toEqual(["https://files.test/old.gz", "https://files.test/new.gz"])
  })

  test("gives up when the server has no different URL", async () => {
    const { fetcher } = fakeServer({})
    await expect(
      loadDebuggerWithRefresh("https://files.test/x.gz", async () => "https://files.test/x.gz", fetcher),
    ).rejects.toThrow(/HTTP 404/)
    await expect(loadDebuggerWithRefresh("https://files.test/x.gz", async () => null, fetcher)).rejects.toThrow(/HTTP 404/)
  })
})
