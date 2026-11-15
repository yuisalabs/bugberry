import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A throwaway CA and a localhost certificate are made for each run, so no key lives in the repository.
// Without openssl on the PATH the test is skipped.
const openssl = Bun.which("openssl")

let dir = ""
let server: ReturnType<typeof Bun.serve> | null = null

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn([openssl ?? "openssl", ...args], { cwd: dir, stdout: "ignore", stderr: "pipe" })
  if ((await child.exited) !== 0) throw new Error(`openssl ${args[0]} failed: ${await new Response(child.stderr).text()}`)
}

beforeAll(async () => {
  if (!openssl) return
  dir = mkdtempSync(join(tmpdir(), "bugberry-tls-"))
  await run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=BugBerry test CA", "-keyout", "ca-key.pem", "-out", "ca.pem"])
  await run(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "server-key.pem", "-out", "server.csr"])
  writeFileSync(join(dir, "san.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1")
  await run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-days", "2", "-extfile", "san.ext", "-out", "server.pem"])
  server = Bun.serve({
    port: 0,
    tls: { cert: await Bun.file(join(dir, "server.pem")).text(), key: await Bun.file(join(dir, "server-key.pem")).text() },
    fetch: () => new Response("ok"),
  })
})

afterAll(async () => {
  await server?.stop(true)
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Fetches the TLS server from a fresh Bun process, as the API would fetch a company IdP. */
async function exitCodeOfFetch(extraEnv: Record<string, string>): Promise<number> {
  const script = "const r = await fetch(process.argv[1]).catch(() => null); process.exit(r?.ok ? 0 : 1)"
  const child = Bun.spawn([process.execPath, "-e", script, `https://localhost:${server?.port}/`], {
    env: { ...process.env, ...extraEnv },
    stdout: "ignore",
    stderr: "ignore",
  })
  return child.exited
}

// The self-host docs tell admins with an internal CA to set NODE_EXTRA_CA_CERTS; this pins that Bun honours it.
describe("internal certificate authorities", () => {
  test.skipIf(!openssl)("Bun trusts a CA given through NODE_EXTRA_CA_CERTS", async () => {
    expect(await exitCodeOfFetch({ NODE_EXTRA_CA_CERTS: "" })).not.toBe(0)
    expect(await exitCodeOfFetch({ NODE_EXTRA_CA_CERTS: join(dir, "ca.pem") })).toBe(0)
  })
})
