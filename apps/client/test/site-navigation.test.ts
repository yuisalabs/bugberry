import { describe, expect, test } from "bun:test"
import { openSiteLink } from "../src/pages/landing/SiteNavigation"

const ORIGIN = "https://bugberry.yuisalabs.com"

function open(href: string) {
  const inApp: string[] = []
  const loaded: string[] = []
  openSiteLink(href, { origin: ORIGIN, navigate: (to) => inApp.push(to), load: (to) => loaded.push(to) })
  return { inApp, loaded }
}

describe("openSiteLink", () => {
  test("pages of the app open without reloading it, keeping their query and anchor", () => {
    expect(open("/pricing").inApp).toEqual(["/pricing"])
    expect(open("/#capture").inApp).toEqual(["/#capture"])
    expect(open("/integrations#trackers").inApp).toEqual(["/integrations#trackers"])
    expect(open(`${ORIGIN}/demo?from=menu`).inApp).toEqual(["/demo?from=menu"])
  })

  test("the docs share the host but are another site, so they load in full", () => {
    expect(open(`${ORIGIN}/docs/changelog`)).toEqual({ inApp: [], loaded: [`${ORIGIN}/docs/changelog`] })
    expect(open("/docs").loaded).toEqual(["/docs"])
    expect(open("/api/health").loaded).toEqual(["/api/health"])
  })

  test("other sites load in full", () => {
    expect(open("https://chromewebstore.google.com/detail/x").loaded).toEqual(["https://chromewebstore.google.com/detail/x"])
  })
})
