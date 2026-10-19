import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect, test } from "@playwright/test"

const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))

interface State {
  serverUrl: string
  token: string
  sessionCookie: { name: string; value: string }
  colleagueCookie: { name: string; value: string }
}

// Read when a test runs: the E2E server writes this file as it starts.
let loaded: State | null = null
const state = () => {
  loaded ??= JSON.parse(readFileSync(statePath, "utf8")) as State
  return loaded
}
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${state().serverUrl}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${state().token}`, "content-type": "application/json", ...init.headers },
  })

/** The E2E user files a small screenshot report in their workspace. */
async function fileReport(title: string): Promise<string> {
  const media = new Uint8Array([137, 80, 78, 71])
  const session = (await (
    await api("/reports/uploads", {
      method: "POST",
      body: JSON.stringify({
        title,
        captureType: "screenshot",
        mediaSize: media.byteLength,
        pageUrl: "https://app.kantor.test/",
        device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
        debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
      }),
    })
  ).json()) as { reportId: string; mediaUpload: { method: string; url: string; headers: Record<string, string> } }
  await fetch(new URL(session.mediaUpload.url, state().serverUrl), {
    method: session.mediaUpload.method,
    headers: session.mediaUpload.headers,
    body: media,
  })
  expect((await api(`/reports/${session.reportId}/finalize`, { method: "POST" })).status).toBe(200)
  return session.reportId
}

test("a same-domain colleague opens an internal report read-only", async () => {
  // Shared with the reporter's company, not only the workspace.
  const reportId = await fileReport("Internal only bug")
  const shared = (await (
    await api(`/reports/${reportId}`, { method: "PATCH", body: JSON.stringify({ visibility: "internal" }) })
  ).json()) as { shareSlug: string; visibility: string }
  expect(shared.visibility).toBe("internal")

  const browser = await chromium.launch({ channel: "chromium" })
  const context = await browser.newContext()
  await context.addCookies([{ ...state().colleagueCookie, url: state().serverUrl }])
  const page = await context.newPage()
  await page.goto(`${state().serverUrl}/s/${shared.shareSlug}`)
  await expect(page.getByRole("heading", { name: "Internal only bug" })).toBeVisible()

  // The dashboard link of the same report sends the colleague to the share link instead.
  await page.goto(`${state().serverUrl}/app/r/${reportId}`)
  await expect(page).toHaveURL(new RegExp(`/s/${shared.shareSlug}$`))
  await browser.close()
})

test("a member who opens a share link lands on the full report", async () => {
  const reportId = await fileReport("Member opens the share link")
  const report = (await (await api(`/reports/${reportId}`)).json()) as { shareSlug: string }

  const browser = await chromium.launch({ channel: "chromium" })
  const context = await browser.newContext()
  await context.addCookies([{ ...state().sessionCookie, url: state().serverUrl }])
  const page = await context.newPage()
  await page.goto(`${state().serverUrl}/s/${report.shareSlug}?t=3`)
  await expect(page).toHaveURL(new RegExp(`/app/r/${reportId}\\?t=3$`))
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible()
  await browser.close()
})
