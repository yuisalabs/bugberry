import { afterEach, describe, expect, test } from "bun:test"
import { isRedirect } from "@tanstack/react-router"
import { signedInLoginGate } from "../src/features/auth/login-gate"
import { createQueryClient } from "../src/lib/query/client"
import { fakeFetch, restoreFetch } from "./support/fake-fetch"

afterEach(restoreFetch)

const ME = { id: "u1", name: "Hannan Rozen", email: "hannan@northwind.test", image: null, lastWorkspaceId: null }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function page(search = "") {
  const assigned: string[] = []
  return { browser: { search, assign: (url: string) => void assigned.push(url) }, assigned }
}

describe("signedInLoginGate", () => {
  test("someone signed in goes on to `next` before the form renders", async () => {
    fakeFetch(() => json(200, ME))
    const { browser } = page()
    const queryClient = createQueryClient(() => {})
    const thrown = await signedInLoginGate({ context: { queryClient }, search: { next: "/app/settings/ai" }, browser }).catch((error: unknown) => error)
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: { href: string } }).options.href).toBe("/app/settings/ai")
  })

  test("a `next` off this site goes to the dashboard instead", async () => {
    fakeFetch(() => json(200, ME))
    const { browser } = page()
    const thrown = await signedInLoginGate({
      context: { queryClient: createQueryClient(() => {}) },
      search: { next: "https://evil.test/app" },
      browser,
    }).catch((error: unknown) => error)
    expect((thrown as { options: { href: string } }).options.href).toBe("/app")
  })

  test("someone signed out sees the form, and the 401 is not a session that ended", async () => {
    fakeFetch(() => json(401, { message: "Unauthorized" }))
    let ended = 0
    const { browser } = page()
    expect(await signedInLoginGate({ context: { queryClient: createQueryClient(() => ended++) }, search: {}, browser })).toBeUndefined()
    expect(ended).toBe(0)
  })

  test("a failed sign-in shows its message without asking who is there", async () => {
    const { requests } = fakeFetch(() => json(200, ME))
    const { browser } = page()
    expect(await signedInLoginGate({ context: { queryClient: createQueryClient(() => {}) }, search: { error: "access_denied" }, browser })).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  test("a server that hangs shows the form after a short wait", async () => {
    fakeFetch(() => new Promise<Response>(() => {}))
    const { browser } = page()
    const started = Date.now()
    expect(await signedInLoginGate({ context: { queryClient: createQueryClient(() => {}) }, search: {}, browser })).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(2500)
  })

  test("an AI app's sign-in continues to its authorize request", async () => {
    fakeFetch(() => json(200, ME))
    const { browser, assigned } = page("?client_id=abc&sig=xyz")
    void signedInLoginGate({ context: { queryClient: createQueryClient(() => {}) }, search: {}, browser })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(assigned).toEqual(["/api/auth/oauth2/authorize?client_id=abc&sig=xyz"])
  })
})
