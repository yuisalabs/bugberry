import type { Emit, Uninstall } from "../events"
import { MAX_URL_CHARS } from "../limits"
import { createPatcher, installOrUndo } from "../patch"
import { safely } from "../safe"
import { redactUrl } from "../sanitize"

export interface WebSocketHost {
  WebSocket: typeof WebSocket
}

/** Notes each WebSocket the page opens; its messages are not recorded. */
export function installWebSocketHook(host: WebSocketHost, emit: Emit, now: () => number): Uninstall {
  const original = host.WebSocket
  if (typeof original !== "function") throw new Error("WebSocket is not available")
  const patcher = createPatcher()
  // A Proxy keeps `instanceof WebSocket`, the static constants and the prototype exactly as they were.
  const wrapped = new Proxy(original, {
    construct(target, args, newTarget) {
      safely(() =>
        emit({
          kind: "resource",
          t: now(),
          url: redactUrl(String(args[0])).slice(0, MAX_URL_CHARS),
          initiatorType: "websocket",
        }),
      )
      return Reflect.construct(target, args, newTarget)
    },
  })
  installOrUndo(() => patcher.replace(host, "WebSocket", wrapped), patcher.restore)
  return patcher.restore
}
