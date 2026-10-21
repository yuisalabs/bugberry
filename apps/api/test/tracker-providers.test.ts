import { describe, expect, test } from "bun:test"
import type { IssueContent } from "../src/lib/trackers/content"
import { HostGuardError, PRIVATE_HOST_MESSAGE } from "../src/lib/net/host-guard"
import { createTrackerFactory, TrackerError } from "../src/lib/trackers/providers"

const content: IssueContent = {
  title: "Pay button fails",
  description: "Clicking Pay does nothing",
  facts: [["Page", "https://app.kantor.test/"]],
  errors: [],
  reportUrl: "https://bugberry.kantor.test/r/r1",
}

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return respond(request)
  }) as unknown as typeof fetch
  return { fetcher, requests }
}

const github = { owner: "kantor", repo: "web", labels: ["bug", "bugberry"] }
const activecollab = { baseUrl: "https://ac.kantor.test", projectId: 12, taskListId: 3 }

describe("GitHub client", () => {
  test("creates an issue with the token, API version and labels", async () => {
    const { fetcher, requests } = fakeFetch(() =>
      Response.json({ number: 42, html_url: "https://github.com/kantor/web/issues/42" }, { status: 201 }),
    )
    const issue = await createTrackerFactory(fetcher)("github", github, "ghp_token").createIssue(content)
    expect(issue).toEqual({ externalId: "42", url: "https://github.com/kantor/web/issues/42" })
    const request = requests[0] as Request
    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://api.github.com/repos/kantor/web/issues")
    expect(request.headers.get("authorization")).toBe("Bearer ghp_token")
    expect(request.headers.get("x-github-api-version")).toBe("2022-11-28")
    expect(request.headers.get("user-agent")).toBe("BugBerry")
    const body = (await request.json()) as { title: string; body: string; labels: string[] }
    expect(body.title).toBe("Pay button fails")
    expect(body.labels).toEqual(["bug", "bugberry"])
    expect(body.body).toContain("[Open the report in BugBerry](https://bugberry.kantor.test/r/r1)")
  })

  test("tests access by reading the repository", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ full_name: "kantor/web" }))
    await createTrackerFactory(fetcher)("github", github, "ghp_token").test()
    expect(requests[0]?.method).toBe("GET")
    expect(requests[0]?.url).toBe("https://api.github.com/repos/kantor/web")
  })

  test("explains auth, access and other failures without echoing the token", async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /GitHub token is invalid/],
      [404, /repo was not found/],
      [410, /Issues are turned off/],
      [422, /Validation Failed/],
    ]
    for (const [status, message] of cases) {
      const { fetcher } = fakeFetch(() => Response.json({ message: "Validation Failed" }, { status }))
      const error = await createTrackerFactory(fetcher)("github", github, "ghp_token").createIssue(content).catch((caught) => caught)
      expect(error).toBeInstanceOf(TrackerError)
      expect(error.message).toMatch(message)
      expect(error.message).not.toContain("ghp_token")
    }
  })
})

describe("GitHub connection test", () => {
  const check = (body: object, headers: Record<string, string> = {}) => {
    const { fetcher } = fakeFetch(() => Response.json(body, { headers }))
    return createTrackerFactory(fetcher)("github", github, "ghp_token").test()
  }

  test("catches what would only fail at the first send: Issues off, or a classic token without repo scope", async () => {
    await expect(check({ private: false, has_issues: false })).rejects.toThrow(/Issues are turned off/)
    await expect(check({ private: false, has_issues: true }, { "x-oauth-scopes": "read:user, gist" })).rejects.toThrow(
      /scope/,
    )
    await expect(check({ private: true, has_issues: true }, { "x-oauth-scopes": "public_repo" })).rejects.toThrow(/scope/)
  })

  test("accepts classic tokens with the right scope, and fine-grained tokens (which list no scopes)", async () => {
    await expect(check({ private: true, has_issues: true }, { "x-oauth-scopes": "repo, read:org" })).resolves.toBeUndefined()
    await expect(check({ private: false, has_issues: true }, { "x-oauth-scopes": "public_repo" })).resolves.toBeUndefined()
    await expect(check({ private: true, has_issues: true })).resolves.toBeUndefined()
  })
})

describe("GitHub rate limits", () => {
  test("a rate-limited request says so instead of blaming the repo or token", async () => {
    const limited = [
      new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      new Response("{}", { status: 403, headers: { "retry-after": "60" } }),
      new Response("{}", { status: 429 }),
    ]
    for (const response of limited) {
      const { fetcher } = fakeFetch(() => response)
      await expect(createTrackerFactory(fetcher)("github", github, "ghp_token").createIssue(content)).rejects.toThrow(
        /GitHub is limiting requests/,
      )
    }
  })
})

describe("ActiveCollab client", () => {
  test("creates a task in the configured task list with an HTML body", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ single: { id: 77, url_path: "/projects/12/tasks/77" } }))
    const issue = await createTrackerFactory(fetcher)("activecollab", activecollab, "ac-token").createIssue(content)
    expect(issue).toEqual({ externalId: "77", url: "https://ac.kantor.test/projects/12/tasks/77" })
    const request = requests[0] as Request
    expect(request.url).toBe("https://ac.kantor.test/api/v1/projects/12/tasks")
    expect(request.headers.get("x-angie-authapitoken")).toBe("ac-token")
    const body = (await request.json()) as { name: string; body: string; task_list_id: number }
    expect(body).toMatchObject({ name: "Pay button fails", task_list_id: 3 })
    expect(body.body).toContain('<a href="https://bugberry.kantor.test/r/r1">')
  })

  test("falls back to a built URL when url_path is missing or not a path", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ single: { id: 78, url_path: "//evil.test/x" } }))
    const issue = await createTrackerFactory(fetcher)("activecollab", activecollab, "ac-token").createIssue(content)
    expect(issue.url).toBe("https://ac.kantor.test/projects/12/tasks/78")
  })

  test("tests access by reading the project and maps auth failures", async () => {
    const ok = fakeFetch(() => Response.json({ single: { id: 12 } }))
    await createTrackerFactory(ok.fetcher)("activecollab", activecollab, "ac-token").test()
    expect(ok.requests[0]?.url).toBe("https://ac.kantor.test/api/v1/projects/12")

    const denied = fakeFetch(() => Response.json({ message: "nope" }, { status: 401 }))
    await expect(createTrackerFactory(denied.fetcher)("activecollab", activecollab, "ac-token").test()).rejects.toThrow(
      /ActiveCollab token is invalid/,
    )
  })
})

describe("redirects", () => {
  test("a redirect to another host is refused, so the token never leaves the configured tracker", async () => {
    const { fetcher, requests } = fakeFetch(
      () => new Response(null, { status: 301, headers: { location: "https://evil.test/api/v1/projects/12/tasks" } }),
    )
    await expect(createTrackerFactory(fetcher)("activecollab", activecollab, "ac-token").createIssue(content)).rejects.toThrow(
      /redirected to another address/,
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]?.redirect).toBe("manual")
  })

  test("a same-host redirect (renamed GitHub repo) is followed with the same method", async () => {
    const { fetcher, requests } = fakeFetch((request) =>
      request.url.endsWith("/repos/kantor/web/issues")
        ? new Response(null, { status: 307, headers: { location: "https://api.github.com/repositories/7/issues" } })
        : Response.json({ number: 5, html_url: "https://github.com/kantor/web-baru/issues/5" }, { status: 201 }),
    )
    const issue = await createTrackerFactory(fetcher)("github", github, "ghp_token").createIssue(content)
    expect(issue.externalId).toBe("5")
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://api.github.com/repos/kantor/web/issues",
      "POST https://api.github.com/repositories/7/issues",
    ])
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer ghp_token")
  })
})

describe("a create that times out", () => {
  test("warns that the issue may exist already; a connection test does not", async () => {
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      })) as unknown as typeof fetch
    const client = createTrackerFactory(hanging, 20)("github", github, "ghp_token")
    await expect(client.createIssue(content)).rejects.toThrow(/check GitHub before sending again/)
    const testError = (await client.test().catch((caught) => caught)) as Error
    expect(testError.message).not.toContain("kirim ulang")
  })
})

describe("network problems", () => {
  test("a tracker that never answers times out with a readable error", async () => {
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      })) as unknown as typeof fetch
    await expect(createTrackerFactory(hanging, 20)("github", github, "ghp_token").createIssue(content)).rejects.toThrow(
      /GitHub did not respond/,
    )
  })

  test("an unreachable tracker is reported, not thrown raw", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await expect(createTrackerFactory(offline)("activecollab", activecollab, "ac-token").test()).rejects.toThrow(
      /ActiveCollab could not be reached/,
    )
  })
})

describe("guarded factory", () => {
  test("checks the address before sending, and sends nothing when it is refused", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({}))
    const refuse = async () => {
      throw new HostGuardError(PRIVATE_HOST_MESSAGE)
    }
    await expect(createTrackerFactory(fetcher, 1000, refuse)("activecollab", activecollab, "token").test()).rejects.toThrow("private network")
    expect(requests).toHaveLength(0)
  })
})
