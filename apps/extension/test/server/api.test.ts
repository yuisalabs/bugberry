import { describe, expect, test } from "bun:test"
import { ApiError, createBugberryApi } from "../../lib/server/api"

const settings = { serverUrl: "https://bugberry.kantor.test" }

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = []
  const inits: Array<RequestInit | undefined> = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    inits.push(init)
    return respond(request)
  }) as typeof fetch
  return { fetcher, requests, inits }
}

describe("createBugberryApi", () => {
  test("asks for one workspace's projects", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json([]))
    await createBugberryApi(settings, fetcher).listProjects("w1")
    expect(requests[0]?.url).toBe("https://bugberry.kantor.test/api/projects?workspaceId=w1")
  })

  test("reads a workspace's limits and makes it the dashboard's current one", async () => {
    const { fetcher, requests } = fakeFetch((request) =>
      request.method === "PUT" ? Response.json({ ok: true }) : Response.json({ limited: false }),
    )
    const api = createBugberryApi(settings, fetcher)
    expect(await api.workspaceLimits("w1")).toEqual({ limited: false })
    expect(requests[0]?.url).toBe("https://bugberry.kantor.test/api/workspaces/w1/limits")
    await api.setCurrentWorkspace("w1")
    expect(requests[1]?.method).toBe("PUT")
    expect(requests[1]?.url).toBe("https://bugberry.kantor.test/api/me/workspace")
    expect(await requests[1]?.json()).toEqual({ workspaceId: "w1" })
  })

  test("lists my workspaces", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json([{ id: "w1", name: "Alpha", role: "admin", owner: false, slug: "alpha", logoUrl: null }]))
    expect(await createBugberryApi(settings, fetcher).listWorkspaces()).toEqual([{ id: "w1", name: "Alpha", role: "admin", owner: false, slug: "alpha", logoUrl: null }])
    expect(requests[0]?.url).toBe("https://bugberry.kantor.test/api/workspaces")
  })

  test("calls the server with the dashboard cookie, not a token", async () => {
    const { fetcher, requests, inits } = fakeFetch(() =>
      Response.json({ id: "u1", email: "ana@kantor.test", name: "Ana", image: null, role: "member", owner: false }),
    )
    const me = await createBugberryApi(settings, fetcher).me()
    expect(me.name).toBe("Ana")
    expect(requests[0]?.url).toBe("https://bugberry.kantor.test/api/me")
    expect(inits[0]?.credentials).toBe("include")
    expect(requests[0]?.headers.get("authorization")).toBeNull()
  })

  test("turns the server's error body into an ApiError", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ code: "unauthorized", message: "Login required" }, { status: 401 }))
    const error = await createBugberryApi(settings, fetcher).me().catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: "unauthorized", retryable: false })
    // Known server codes get the extension's own text; the server's text is not shown.
    expect(error.message).toBe("Your session ended. Sign in, then send again.")
  })

  test("unknown error codes keep the server's message", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ code: "something_new", message: "Server says no" }, { status: 400 }))
    const error = await createBugberryApi(settings, fetcher).me().catch((caught) => caught)
    expect(error).toMatchObject({ code: "something_new", message: "Server says no" })
  })

  test("marks network failures, server errors and unfinished uploads as retryable", async () => {
    const offline = fakeFetch(() => {
      throw new TypeError("Failed to fetch")
    })
    const offlineError = await createBugberryApi(settings, offline.fetcher).me().catch((caught) => caught)
    expect(offlineError).toMatchObject({ status: 0, retryable: true })

    const broken = fakeFetch(() => Response.json({ code: "internal", message: "boom" }, { status: 500 }))
    expect(await createBugberryApi(settings, broken.fetcher).listProjects("w1").catch((caught) => caught)).toMatchObject({
      retryable: true,
    })

    const pending = fakeFetch(() => Response.json({ code: "upload_incomplete", message: "later" }, { status: 409 }))
    expect(await createBugberryApi(settings, pending.fetcher).finalize("r1").catch((caught) => caught)).toMatchObject({
      code: "upload_incomplete",
      retryable: true,
    })
  })

  test("posts upload sessions as JSON", async () => {
    const { fetcher, requests } = fakeFetch(() =>
      Response.json({
        reportId: "r1",
        reportUrl: "https://bugberry.kantor.test/r/r1",
        shareUrl: "https://bugberry.kantor.test/s/abc",
        mediaUpload: { method: "PUT", url: "https://up.test/m", headers: { "content-type": "image/png" } },
        debuggerUpload: null,
      }),
    )
    const session = await createBugberryApi(settings, fetcher).createUpload({
      projectId: "p1",
      title: "Bug",
      captureType: "screenshot",
      mediaSize: 10,
      pageUrl: "https://app.test/",
      device: { browser: "Chrome 141", os: "Windows", viewport: "1x1" },
      debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
    })
    expect(session.reportId).toBe("r1")
    expect(requests[0]?.method).toBe("POST")
    expect(await requests[0]?.json()).toMatchObject({ projectId: "p1", mediaSize: 10 })
  })
})
