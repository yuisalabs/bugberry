import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { dashboardApp, withDashboard } from "../scripts/e2e-dashboard"
import { setupTestApp } from "./helpers"

function buildDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "bugberry-web-"))
  writeFileSync(join(dir, "index.html"), '<!doctype html><div id="root"></div>')
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log('app')")
  writeFileSync(join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>")
  // A file right next to the build folder, which must never be reachable.
  writeFileSync(join(dirname(dir), `${basename(dir)}-secret.txt`), "TOP SECRET")
  return dir
}

const dist = buildDist()
const secretName = `${basename(dist)}-secret.txt`
const web = dashboardApp(dist)
const get = (path: string) => web.handle(new Request(`http://localhost${path}`))

describe("dashboardApp", () => {
  test("client-side routes get index.html", async () => {
    for (const path of ["/", "/login", "/p/web-app", "/r/0199-abc", "/s/AbCdEf123456", "/extension/connect?extId=abc"]) {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(await response.text()).toContain('<div id="root">')
    }
  })

  test("a missing file is a 404, not the app shell", async () => {
    const response = await get("/assets/missing-123.js")
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("root")
  })

  test("API paths are never answered with the app shell", async () => {
    for (const path of ["/api", "/api/nope"]) {
      const response = await get(path)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: "not_found" })
    }
  })

  test("paths cannot reach files outside the build folder", async () => {
    for (const path of [`/..%2F${secretName}`, `/..%5C${secretName}`, `/assets/..%2F..%2F${secretName}`]) {
      const response = await get(path)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain("TOP SECRET")
    }
  })

  test("explains how to build when the dashboard is missing", async () => {
    const empty = dashboardApp(mkdtempSync(join(tmpdir(), "bugberry-empty-")))
    const response = await empty.handle(new Request("http://localhost/p/web"))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("isn't built yet")
  })
})

describe("withDashboard", () => {
  test("API routes keep working next to the dashboard", async () => {
    const ctx = await setupTestApp()
    const http = withDashboard(ctx.app, dist)
    const health = await http.handle(new Request("http://localhost/api/health"))
    expect(await health.json()).toEqual({ ok: true })
    const unknown = await http.handle(new Request("http://localhost/api/nope"))
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: "not_found" })
    const page = await http.handle(new Request("http://localhost/r/123"))
    expect(await page.text()).toContain('<div id="root">')
  })

  test("Better Auth GET routes (OAuth callback, session) are not swallowed by the app shell", async () => {
    const ctx = await setupTestApp()
    const http = withDashboard(ctx.app, dist)
    const session = await http.handle(new Request("http://localhost:3000/api/auth/get-session"))
    expect(session.status).toBe(200)
    const callback = await http.handle(new Request("http://localhost:3000/api/auth/callback/google?code=x&state=y"))
    expect(callback.status).toBe(302)
  })
})
