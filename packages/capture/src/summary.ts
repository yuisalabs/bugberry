import type { DebuggerSummary } from "@bugberry/shared"
import type { CaptureEvent } from "./events"

export function summarize(events: readonly CaptureEvent[], incomplete: readonly string[]): DebuggerSummary {
  const summary: DebuggerSummary = { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [...incomplete] }
  for (const event of events) {
    switch (event.kind) {
      case "console":
        summary.logs += 1
        if (event.level === "error") summary.errors += 1
        break
      case "error":
        summary.errors += 1
        break
      case "network":
        summary.requests += 1
        if (event.failed || (event.status ?? 0) >= 400) summary.failedRequests += 1
        break
      case "action":
        summary.actions += 1
        break
    }
  }
  return summary
}
