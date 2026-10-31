import { describe, expect, test } from "bun:test"
import { DEBUGGER_CONTENT_TYPE } from "@bugberry/shared"
import {
  buildDebuggerPayload,
  DEBUGGER_PAYLOAD_VERSION,
  decodeDebuggerPayload,
  encodeDebuggerPayload,
} from "../src/payload"
import type { CaptureSession } from "../src/session"

const fakeSession: CaptureSession = {
  documentId: "doc-1",
  snapshot: () => [{ kind: "console", t: 5, level: "warn", args: ["careful"] }],
  summary: () => ({ logs: 1, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: ["xhr"] }),
  incomplete: ["xhr"],
  readMetadata: () => ({ fields: null, error: null, droppedKeys: 0 }),
  clear: () => {},
  stop: () => {},
}

describe("debugger payload", () => {
  test("builds a versioned payload from a session", () => {
    expect(buildDebuggerPayload(fakeSession, { recordingStartedAt: 3, now: () => 9 })).toEqual({
      version: DEBUGGER_PAYLOAD_VERSION,
      capturedAt: 9,
      recordingStartedAt: 3,
      incomplete: ["xhr"],
      events: [{ kind: "console", t: 5, level: "warn", args: ["careful"] }],
    })
  })

  test("round-trips through gzip", async () => {
    const payload = buildDebuggerPayload(fakeSession, { now: () => 1 })
    const blob = await encodeDebuggerPayload(payload)
    expect(blob.type).toBe(DEBUGGER_CONTENT_TYPE)
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]))
    expect(await decodeDebuggerPayload(blob)).toEqual(payload)
  })

  test("rejects payloads it does not understand", async () => {
    const wrongVersion = await encodeDebuggerPayload({ ...buildDebuggerPayload(fakeSession), version: 2 as 1 })
    await expect(decodeDebuggerPayload(wrongVersion)).rejects.toThrow(/Unsupported debugger payload/)
    await expect(decodeDebuggerPayload(new Blob(["plain text"]))).rejects.toThrow()
  })

  test("customFields round-trips through encode and decode", async () => {
    const payload = {
      ...buildDebuggerPayload(fakeSession, { now: () => 9 }),
      customFields: { fields: { userId: "u1" }, error: null, droppedKeys: 0, url: null, t: 9 },
    }
    expect(await decodeDebuggerPayload(await encodeDebuggerPayload(payload))).toEqual(payload)
  })
})
