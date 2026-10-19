import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "../src/events"
import { installWebSocketHook, type WebSocketHost } from "../src/hooks/websocket"

class FakeSocket {
  static OPEN = 1
  constructor(readonly url: string) {}
}

describe("installWebSocketHook", () => {
  test("a WebSocket is recorded when it is opened", () => {
    const events: CaptureEvent[] = []
    const host = { WebSocket: FakeSocket } as unknown as WebSocketHost
    const uninstall = installWebSocketHook(host, (event) => events.push(event), () => 4000)
    const socket = new host.WebSocket("wss://shop.test/live?token=abc")
    expect(socket).toBeInstanceOf(FakeSocket)
    expect((host.WebSocket as unknown as typeof FakeSocket).OPEN).toBe(1)
    expect(events).toEqual([
      { kind: "resource", t: 4000, url: "wss://shop.test/live?token=[redacted]", initiatorType: "websocket" },
    ])
    uninstall()
    expect(host.WebSocket).toBe(FakeSocket as never)
  })
})
