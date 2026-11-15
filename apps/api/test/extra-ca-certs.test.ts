import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/tls/${name}`, import.meta.url))

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    tls: { cert: await Bun.file(fixture("server.pem")).text(), key: await Bun.file(fixture("server-key.pem")).text() },
    fetch: () => new Response("ok"),
  })
})

afterAll(async () => {
  await server.stop(true)
})

/** Fetches the TLS server from a fresh Bun process, as the API would fetch a company IdP. */
async function exitCodeOfFetch(extraEnv: Record<string, string>): Promise<number> {
  const script = "const r = await fetch(process.argv[1]).catch(() => null); process.exit(r?.ok ? 0 : 1)"
  const child = Bun.spawn([process.execPath, "-e", script, `https://localhost:${server.port}/`], {
    env: { ...process.env, ...extraEnv },
    stdout: "ignore",
    stderr: "ignore",
  })
  return child.exited
}

// The self-host docs tell admins with an internal CA to set NODE_EXTRA_CA_CERTS; this pins that Bun honours it.
describe("internal certificate authorities", () => {
  test("Bun trusts a CA given through NODE_EXTRA_CA_CERTS", async () => {
    expect(await exitCodeOfFetch({ NODE_EXTRA_CA_CERTS: "" })).not.toBe(0)
    expect(await exitCodeOfFetch({ NODE_EXTRA_CA_CERTS: fixture("ca.pem") })).toBe(0)
  })
})
