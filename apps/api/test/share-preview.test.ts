import { beforeEach, describe, expect, test } from "bun:test"
import { SHARE_PREVIEWS_PER_MINUTE } from "../src/modules/share"
import { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

const THUMBNAIL = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

beforeEach(async () => {
  ctx = await setupTestApp()
  member = await createUserWithToken(ctx.db, { email: "ana@kantor.test", name: "Ana" })
  projectId = (await createProject(ctx.db)).id
})

const get = (path: string, ip = "203.0.113.7") => ctx.app.handle(new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } }))
const text = async (slug: string) => (await get(`/api/share/${slug}/meta`)).text()

async function publicReport(overrides: Parameters<typeof createReadyReport>[1] extends infer T ? Partial<T> : never = {}) {
  const created = await createReadyReport(ctx.db, {
    projectId,
    reporterId: member.user.id,
    visibility: "public",
    title: "Cart total is wrong",
    number: 7,
    thumbnailKey: "reports/thumb/thumbnail.jpg",
    debuggerSummary: { logs: 0, errors: 2, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
    ...overrides,
  })
  if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
  if (created.thumbnailKey) await ctx.storage.writeObject(created.thumbnailKey, THUMBNAIL)
  return created
}

describe("GET /api/share/:slug/meta", () => {
  test("a public report's tags name it", async () => {
    const { shareSlug } = await publicReport()
    const response = await get(`/api/share/${shareSlug}/meta`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.text()
    expect(body).toContain("BB-7 · Cart total is wrong")
    expect(body).toContain("Screenshot of app.kantor.test · 2 errors")
    expect(body).toContain(`http://localhost:3000/api/share/${shareSlug}/preview.jpg`)
  })

  test("a workspace-only report, an unknown slug and an unfinished upload answer the same bytes", async () => {
    const hidden = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "workspace" })
    const internal = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "internal" })
    const uploading = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public", uploadStatus: "uploading" })
    const [a, b, c, unknown] = await Promise.all([text(hidden.shareSlug), text(internal.shareSlug), text(uploading.shareSlug), text("nosuchslug00")])
    expect(a).toBe(unknown)
    expect(b).toBe(unknown)
    expect(c).toBe(unknown)
    expect(unknown).toContain("A report on BugBerry")
  })

  test("a report that leaves public loses its preview under the old link", async () => {
    const created = await publicReport()
    const { data } = await ctx.api.api.reports({ id: created.id }).patch({ visibility: "workspace" }, { headers: member.headers })
    expect(await text(created.shareSlug)).toContain("A report on BugBerry")
    expect((await get(`/api/share/${created.shareSlug}/preview.jpg`)).status).toBe(404)
    expect(await text(data?.shareSlug ?? "")).toContain("A report on BugBerry")
  })
})

describe("GET /api/share/:slug/preview.jpg", () => {
  test("a public report's thumbnail is served as it was stored", async () => {
    const { shareSlug } = await publicReport()
    const response = await get(`/api/share/${shareSlug}/preview.jpg`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toBe("private, max-age=300")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(THUMBNAIL)
  })

  test("no image for a workspace-only report, a report without a thumbnail, a missing file or an unknown slug", async () => {
    const hidden = await publicReport({ visibility: "workspace", number: undefined })
    const bare = await publicReport({ thumbnailKey: null, number: undefined })
    const missing = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public", thumbnailKey: "reports/gone/thumbnail.jpg" })
    for (const slug of [hidden.shareSlug, bare.shareSlug, missing.shareSlug, "nosuchslug00"]) {
      const response = await get(`/api/share/${slug}/preview.jpg`)
      expect(response.status).toBe(404)
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
    expect(await text(bare.shareSlug)).toContain("http://localhost:3000/assets/og-image.png")
  })
  test("the image is never sniffed as anything but a JPEG", async () => {
    const { shareSlug } = await publicReport()
    expect((await get(`/api/share/${shareSlug}/preview.jpg`)).headers.get("x-content-type-options")).toBe("nosniff")
  })

  test("a stored file that isn't a JPEG is not served", async () => {
    const created = await publicReport()
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    await ctx.storage.writeObject(created.thumbnailKey!, new TextEncoder().encode("<svg onload=alert(1)>"))
    const response = await get(`/api/share/${created.shareSlug}/preview.jpg`)
    expect(response.status).toBe(404)
  })

  test("storage that fails to read answers like a missing image", async () => {
    const { shareSlug } = await publicReport()
    ctx.storage.read = async () => {
      throw new Error("bucket unreachable")
    }
    const response = await get(`/api/share/${shareSlug}/preview.jpg`)
    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})

describe("the preview's own limit", () => {
  test("room for the crawlers of busy chat apps behind one address", () => {
    expect(SHARE_PREVIEWS_PER_MINUTE).toBe(600)
  })

  test("over the limit: the tags stay generic and the image is refused", async () => {
    const { shareSlug } = await publicReport()
    for (let i = 0; i < SHARE_PREVIEWS_PER_MINUTE; i++) await get(`/api/share/${shareSlug}/meta`)
    const over = await get(`/api/share/${shareSlug}/meta`)
    expect(over.status).toBe(200)
    expect(await over.text()).toContain("A report on BugBerry")
    expect((await get(`/api/share/${shareSlug}/preview.jpg`)).status).toBe(429)
    // The share page itself keeps its own limit.
    expect((await get(`/api/share/${shareSlug}`)).status).toBe(200)
  })
})
