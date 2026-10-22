import { describe, expect, test } from "bun:test"
import { ApiError } from "../lib/api"
import { checkSession, isBugBerryServer, serverLabel, signInUrl } from "../lib/session"
import { sessionFrom } from "../lib/browser-settings"

const settings = { serverUrl: "https://bugberry.kantor.com" }
const me = { name: "Ana", email: "ana@kantor.test" }

describe("checkSession", () => {
  test("a signed-in person", async () => {
    expect(await checkSession(settings, async () => me)).toEqual({ kind: "signed-in", name: "Ana", email: "ana@kantor.test" })
  })

  test("401 means signed out", async () => {
    const state = await checkSession(settings, async () => {
      throw new ApiError(401, "unauthorized", "x")
    })
    expect(state).toEqual({ kind: "signed-out" })
  })

  test("a network failure names the host it could not reach", async () => {
    const state = await checkSession(settings, async () => {
      throw new ApiError(0, "network", "x")
    })
    expect(state).toEqual({ kind: "unreachable", host: "bugberry.kantor.com" })
  })

  test("no server chosen yet", async () => {
    expect(await checkSession(null, async () => me)).toEqual({ kind: "no-server" })
  })
})

describe("isBugBerryServer", () => {
  const answering = (response: () => Response) => (async () => response()) as unknown as typeof fetch

  test("a server that lists its sign-in methods is BugBerry", async () => {
    const fetcher = answering(() => Response.json({ github: false, gitlab: false, google: true, emailOtp: true }))
    expect(await isBugBerryServer("https://bugberry.kantor.com", fetcher)).toBe(true)
  })

  test("anything else is not", async () => {
    expect(await isBugBerryServer("https://a.test", answering(() => new Response("nope", { status: 404 })))).toBe(false)
    expect(await isBugBerryServer("https://a.test", answering(() => new Response("<html></html>")))).toBe(false)
    expect(await isBugBerryServer("https://a.test", answering(() => Response.json({ ok: true })))).toBe(false)
    const throwing = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    expect(await isBugBerryServer("https://a.test", throwing)).toBe(false)
  })

  test("asks the server's auth-methods endpoint", async () => {
    const urls: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return Response.json({ github: true, gitlab: true, google: true, emailOtp: false })
    }) as unknown as typeof fetch
    await isBugBerryServer("https://bugberry.kantor.com", fetcher)
    expect(urls).toEqual(["https://bugberry.kantor.com/api/auth-methods"])
  })
})

describe("signInUrl and serverLabel", () => {
  test("sign-in goes to the dashboard login page", () => {
    expect(signInUrl("https://bugberry.kantor.com")).toBe("https://bugberry.kantor.com/login")
  })

  test("the build-time server is BugBerry cloud; others show their host", () => {
    expect(serverLabel("https://app.bugberry.dev", "https://app.bugberry.dev")).toBe("BugBerry cloud")
    expect(serverLabel("https://bugberry.kantor.com", "https://app.bugberry.dev")).toBe("bugberry.kantor.com")
    expect(serverLabel("http://localhost:5173", "")).toBe("localhost:5173")
  })
})

describe("sessionFrom", () => {
  test("a stored session the popup can start from; anything else is none", () => {
    expect(sessionFrom({ kind: "signed-out" })).toEqual({ kind: "signed-out" })
    expect(sessionFrom({ kind: "signed-in", name: "Dana", email: "dana@acme.io", extra: 1 })).toEqual({ kind: "signed-in", name: "Dana", email: "dana@acme.io" })
    expect(sessionFrom({ kind: "signed-in", name: "Dana" })).toBeNull()
    expect(sessionFrom({ kind: "unreachable", host: "b.test" })).toEqual({ kind: "unreachable", host: "b.test" })
    expect(sessionFrom(undefined)).toBeNull()
    expect(sessionFrom("signed-out")).toBeNull()
  })
})
