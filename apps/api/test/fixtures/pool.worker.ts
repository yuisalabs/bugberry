// A worker for worker-pool.test.ts: "echo" answers, "spin" busies its thread, "crash" throws outside a task.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; kind: string; value?: unknown; ms?: number }>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = (event) => {
  const { id, kind } = event.data
  if (kind === "echo") scope.postMessage({ id, ok: true, value: event.data.value })
  else if (kind === "fail") scope.postMessage({ id, ok: false, error: "too_large" })
  else if (kind === "spin") {
    const until = Date.now() + (event.data.ms ?? 0)
    while (Date.now() < until) {}
    scope.postMessage({ id, ok: true, value: "spun" })
  } else if (kind === "crash") throw new Error("boom")
}
