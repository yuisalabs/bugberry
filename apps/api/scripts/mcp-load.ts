import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    token: { type: "string", multiple: true },
    url: { type: "string", default: "http://localhost:3000" },
    dashboard: { type: "string" },
    calls: { type: "string", default: "60" },
    tool: { type: "string", default: "listWorkspaces" },
    report: { type: "string" },
  },
})

const tokens = values.token ?? []
if (tokens.length === 0) {
  console.error(
    "Usage: bun scripts/mcp-load.ts --token <token> [--token <another person's token>] [--url http://localhost:3000]\n" +
      "       [--dashboard <url of the app process>] [--calls 60, per token] [--tool listWorkspaces] [--report BB-12]",
  )
  process.exit(1)
}

const mcpUrl = `${values.url}/api/mcp`
const healthUrl = `${values.dashboard ?? values.url}/api/health`
const calls = Number(values.calls)
const toolArgs = values.report ? { report: values.report } : {}

async function callTool(token: string, id: number) {
  const started = performance.now()
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: values.tool, arguments: toolArgs } }),
  })
  const body = (await response.json().catch(() => null)) as {
    error?: { message: string }
    result?: { isError?: boolean; content?: { text?: string }[] }
  } | null
  // A tool that fails still answers 200, with the reason in the body.
  const toolError = response.status === 200 && body?.result?.isError ? (body.result.content?.[0]?.text ?? "unknown") : null
  return {
    token,
    status: toolError ? "200 (tool error)" : String(response.status),
    retryAfter: response.headers.get("retry-after"),
    message: toolError ?? body?.error?.message ?? null,
    ms: performance.now() - started,
  }
}

/** Pings the health check until `done` settles, and returns how long each ping took. */
async function pingUntil(done: Promise<unknown>): Promise<number[]> {
  const times: number[] = []
  let running = true
  void done.finally(() => (running = false))
  while (running) {
    const started = performance.now()
    await fetch(healthUrl).then((response) => response.arrayBuffer())
    times.push(performance.now() - started)
    await Bun.sleep(20)
  }
  return times
}

function summary(times: number[]): string {
  const sorted = [...times].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return `median ${median.toFixed(1)} ms, slowest ${(sorted.at(-1) ?? 0).toFixed(1)} ms (${sorted.length} pings)`
}

const quiet = await pingUntil(Bun.sleep(1000))
// Every token's calls leave together, mixed, as several people's agents would.
const burst = Promise.all(Array.from({ length: calls }, (_, id) => tokens.map((token) => callTool(token, id + 1))).flat())
const loaded = await pingUntil(burst)
const results = await burst

console.info(`MCP        ${mcpUrl}: ${calls} x ${values.tool} at once${tokens.length > 1 ? `, from each of ${tokens.length} tokens` : ""}`)
tokens.forEach((token, index) => {
  const mine = results.filter((result) => result.token === token)
  if (tokens.length > 1) console.info(`  token ${index + 1}`)
  for (const status of [...new Set(mine.map((result) => result.status))].sort()) {
    const matching = mine.filter((result) => result.status === status)
    const waits = [...new Set(matching.map((result) => result.retryAfter).filter(Boolean))].sort()
    const message = status === "200" ? null : matching.find((result) => result.message)?.message
    console.info(
      `  ${status.padEnd(16)} ${String(matching.length).padStart(4)}` +
        (waits.length > 0 ? `   Retry-After: ${waits.join(", ")}` : "") +
        (message ? `   "${message}"` : ""),
    )
  }
})
console.info(`  slowest call ${Math.max(...results.map((result) => result.ms)).toFixed(0)} ms`)
console.info(`Dashboard  ${healthUrl}`)
console.info(`  quiet       ${summary(quiet)}`)
console.info(`  under load  ${summary(loaded)}`)
if (results.some((result) => result.status === "429")) {
  console.info("429 is the limit of 120 calls a minute per person: wait a minute, or lower --calls.")
}
