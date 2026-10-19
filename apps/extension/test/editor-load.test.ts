import { describe, expect, test } from "bun:test"
import { ApiError } from "../lib/api"
import { type EditorDeps, loadEditor } from "../lib/editor-load"
import { blurRegion } from "../lib/render"
import type { ReportDraft } from "../lib/types"

const settings = { serverUrl: "https://bugberry.kantor.test" }
const video: ReportDraft = {
  id: "v1",
  createdAt: 1,
  captureType: "video",
  page: { url: "https://app.test/", title: "App" },
  device: { browser: "Chrome", os: "Windows", viewport: "1440x900" },
  video: new Blob(["webm"]),
  durationMs: 1000,
  recordingStartedAt: 1,
  debuggerPayload: null,
  debuggerGzip: null,
  status: "editing",
  error: null,
  session: null,
  form: null,
}

function deps(overrides: Partial<EditorDeps> = {}) {
  const urls: Blob[] = []
  const value: EditorDeps = {
    loadSettings: async () => settings,
    getDraft: async () => video,
    listWorkspaces: async () => [
      { id: "w1", name: "Alpha", role: "admin" as const, owner: false, slug: "alpha", logoUrl: null },
      { id: "w2", name: "Beta", role: "member" as const, owner: false, slug: "beta", logoUrl: null },
    ],
    me: async () => ({ email: "budi@ptmaju.com", name: "Budi" }),
    lastWorkspaceId: async () => "w2",
    listProjects: async (_settings, workspaceId) => [{ id: `p-${workspaceId}`, name: "Web", slug: "web", urlPatterns: [] }] as never,
    createObjectURL: (blob) => {
      urls.push(blob)
      return "blob:video"
    },
    createImageBitmap: async () => ({}) as ImageBitmap,
    ...overrides,
  }
  return { urls, deps: value }
}

describe("loadEditor", () => {
  test("loads my workspaces and the projects of the one I used last", async () => {
    const { deps: ok } = deps()
    expect(await loadEditor("v1", ok, () => false)).toMatchObject({
      kind: "loaded",
      workspaceId: "w2",
      workspaces: [{ id: "w1" }, { id: "w2" }],
      projects: [{ id: "p-w2" }],
      email: "budi@ptmaju.com",
      name: "Budi",
    })
  })

  test("when the workspace list cannot load, the remembered workspace is kept", async () => {
    const { deps: down } = deps({
      listWorkspaces: async () => {
        throw new ApiError(0, "network", "offline")
      },
    })
    expect(await loadEditor("v1", down, () => false)).toMatchObject({ kind: "loaded", workspaceId: "w2", projectsError: "offline" })
  })

  test("no workspace at all leaves nothing to send to", async () => {
    const { deps: none } = deps({ listWorkspaces: async () => [] })
    expect(await loadEditor("v1", none, () => false)).toMatchObject({ kind: "loaded", workspaceId: null, projects: [] })
  })

  test("without a server the editor says where to choose one", async () => {
    const { deps: none } = deps({ loadSettings: async () => null })
    expect(await loadEditor("d1", none, () => false)).toEqual({
      kind: "error",
      message: "Choose your BugBerry server in the extension settings first.",
    })
  })

  test("opens the draft even when the server is down; the project list can be loaded later", async () => {
    const { deps: down } = deps({
      listProjects: async () => {
        throw new ApiError(0, "network", "Can't reach the BugBerry server")
      },
    })
    const state = await loadEditor("v1", down, () => false)
    expect(state).toMatchObject({ kind: "loaded", videoUrl: "blob:video", projects: [], projectsError: "Can't reach the BugBerry server" })
  })

  test("a draft left 'uploading' by a closed editor is marked as interrupted, ready to send again", async () => {
    const { deps: interrupted } = deps({ getDraft: async () => ({ ...video, status: "uploading" }) })
    expect(await loadEditor("v1", interrupted, () => false)).toMatchObject({ kind: "loaded", interrupted: true })
  })

  test("a page closed before loading finished never creates an object URL that nobody revokes", async () => {
    let cancelled = false
    const { urls, deps: slow } = deps({
      getDraft: async () => {
        cancelled = true
        return video
      },
    })
    expect(await loadEditor("v1", slow, () => cancelled)).toBeNull()
    expect(urls).toEqual([])
  })
})

describe("blurRegion", () => {
  test("covers every pixel the rectangle touches and never reaches outside the image", () => {
    const size = { width: 100, height: 50 }
    expect(blurRegion({ x: 10.5, y: 4.5, width: 5, height: 5 }, size)).toEqual({ x: 10, y: 4, width: 6, height: 6 })
    expect(blurRegion({ x: -3, y: -3, width: 10, height: 10 }, size)).toEqual({ x: 0, y: 0, width: 7, height: 7 })
    expect(blurRegion({ x: 95.2, y: 40, width: 20, height: 20 }, size)).toEqual({ x: 95, y: 40, width: 5, height: 10 })
    expect(blurRegion({ x: 120, y: 0, width: 5, height: 5 }, size)).toBeNull()
  })
})
