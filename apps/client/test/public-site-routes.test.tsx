import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { isRedirect } from "@tanstack/react-router"
import { publicSiteGate } from "../src/lib/public-site"
import { createQueryClient } from "../src/lib/query/client"
import { createAppRouter } from "../src/router"
import { fakeFetch, restoreFetch } from "./support/fake-fetch"

afterEach(restoreFetch)

const configRequests = (requests: Request[]) => requests.filter((request) => new URL(request.url).pathname === "/api/client-config")

const PUBLIC_PAGES = ["/", "/pricing", "/integrations", "/ai-agents", "/demo"]

function clientWith(publicSite: boolean) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(["client-config"], { extensionInstallUrl: null, maxUploadMb: 300, publicSite })
  return queryClient
}

describe("public site routes", () => {
  test("the five public pages open without signing in", () => {
    const router = createAppRouter(new QueryClient())
    for (const path of PUBLIC_PAGES) {
      const route = (router.routesByPath as Record<string, { parentRoute?: { id: string } }>)[path]
      expect(route?.parentRoute?.id).toBe("__root__")
    }
  })

  test("a server without PUBLIC_SITE sends them to sign-in", async () => {
    const thrown = await publicSiteGate({ context: { queryClient: clientWith(false) } }).catch((error: unknown) => error)
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: { to: string } }).options.to).toBe("/login")
  })

  test("BugBerry cloud shows them", async () => {
    expect(await publicSiteGate({ context: { queryClient: clientWith(true) } })).toBeUndefined()
  })

  test("when the settings can't be read, the page shows rather than a blank screen", async () => {
    const { requests } = fakeFetch(() => {
      throw new TypeError("offline")
    })
    expect(await publicSiteGate({ context: { queryClient: new QueryClient() } })).toBeUndefined()
    expect(configRequests(requests).length).toBeGreaterThan(0)
  })

  test("with the app's own query client, a failing config is asked once, not retried", async () => {
    const { requests } = fakeFetch(() => {
      throw new TypeError("offline")
    })
    const started = Date.now()
    expect(await publicSiteGate({ context: { queryClient: createQueryClient(() => {}) } })).toBeUndefined()
    expect(configRequests(requests)).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(500)
  })

  test("a config request that hangs shows the page after a short wait instead of a blank screen", async () => {
    fakeFetch(() => new Promise<Response>(() => {}))
    const started = Date.now()
    expect(await publicSiteGate({ context: { queryClient: createQueryClient(() => {}) } })).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(2500)
  })

  test("an older server that doesn't say shows the pages too", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(["client-config"], { extensionInstallUrl: null, maxUploadMb: 300 })
    expect(await publicSiteGate({ context: { queryClient } })).toBeUndefined()
  })
})
