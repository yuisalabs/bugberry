import { describe, expect, test } from "bun:test"
import { MAX_RECORDING_MS, recordingByteBudget } from "@bugberry/shared"
import { recordingCaps } from "../src/limits"

const answering = (body: unknown, status = 200) => {
  const asked: string[] = []
  const fetcher = (async (url: string | URL) => {
    asked.push(String(url))
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch
  return { fetcher, asked }
}

describe("recordingCaps", () => {
  test("caps from client-config", async () => {
    const { fetcher, asked } = answering({ maxUploadMb: 300, maxRecordingSeconds: 120 })
    expect(await recordingCaps("https://bugs.kantor.test", fetcher)).toEqual({ maxMs: 120_000, maxBytes: recordingByteBudget(300) })
    expect(asked).toEqual(["https://bugs.kantor.test/api/client-config"])
  })

  test("null maxRecordingSeconds falls back to MAX_RECORDING_MS", async () => {
    const { fetcher } = answering({ maxUploadMb: 200, maxRecordingSeconds: null })
    expect((await recordingCaps("https://bugs.kantor.test", fetcher)).maxMs).toBe(MAX_RECORDING_MS)
  })

  test("a server that doesn't answer is named in the error", async () => {
    const { fetcher } = answering({}, 502)
    await expect(recordingCaps("https://bugs.kantor.test", fetcher)).rejects.toThrow("https://bugs.kantor.test")
  })
})
