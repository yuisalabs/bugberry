import { callSite } from "../callsite"
import type { Emit, Uninstall } from "../events"
import { MAX_STACK_CHARS } from "../limits"
import { safely } from "../safe"
import { truncate } from "../sanitize"
import { stringifyArg } from "../serialize"

export interface ErrorHost {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

function stackOf(value: unknown): { stack?: string } {
  return value instanceof Error && value.stack ? { stack: truncate(value.stack, MAX_STACK_CHARS) } : {}
}

export function installErrorHooks(host: ErrorHost, emit: Emit, now: () => number): Uninstall {
  const onError = (event: Event) =>
    safely(() => {
      const error = event as ErrorEvent
      const source = error.filename ? `${error.filename}:${error.lineno}:${error.colno}` : undefined
      emit({
        kind: "error",
        t: now(),
        message: error.message || stringifyArg(error.error),
        ...stackOf(error.error),
        ...(source ? { source } : {}),
      })
    })

  const onRejection = (event: Event) =>
    safely(() => {
      const reason = (event as PromiseRejectionEvent).reason
      const detail = reason instanceof Error ? reason.message : stringifyArg(reason)
      const source = reason instanceof Error ? callSite(reason.stack) : undefined
      emit({ kind: "error", t: now(), message: `Unhandled rejection: ${detail}`, ...stackOf(reason), ...(source ? { source } : {}) })
    })

  host.addEventListener("error", onError)
  host.addEventListener("unhandledrejection", onRejection)
  return () => {
    host.removeEventListener("error", onError)
    host.removeEventListener("unhandledrejection", onRejection)
  }
}
