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

const gitlab = { baseUrl: "https://gitlab.kantor.test", projectPath: "web/shop", labels: ["bug", "bugberry"] }

describe("GitLab client", () => {
  test("creates an issue in the project with the token and labels", async () => {
    const { fetcher, requests } = fakeFetch(() =>
      Response.json({ iid: 42, web_url: "https://gitlab.kantor.test/web/shop/-/issues/42" }, { status: 201 }),
    )
    const issue = await createTrackerFactory(fetcher)("gitlab", gitlab, "glpat-token").createIssue(content)
    expect(issue).toEqual({ externalId: "42", url: "https://gitlab.kantor.test/web/shop/-/issues/42" })
    const request = requests[0] as Request
    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://gitlab.kantor.test/api/v4/projects/web%2Fshop/issues")
    expect(request.headers.get("private-token")).toBe("glpat-token")
    const body = (await request.json()) as { title: string; description: string; labels: string }
    expect(body.title).toBe("Pay button fails")
    expect(body.labels).toBe("bug,bugberry")
    expect(body.description).toContain("https://bugberry.kantor.test/r/r1")
  })

  test("the connection test refuses a project with issues turned off", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ id: 9, issues_enabled: false }))
    await expect(createTrackerFactory(fetcher)("gitlab", gitlab, "glpat-token").test()).rejects.toThrow("Issues are turned off")
    expect((requests[0] as Request).url).toBe("https://gitlab.kantor.test/api/v4/projects/web%2Fshop")
  })

  test("401 and 404 become plain messages", async () => {
    const unauthorized = fakeFetch(() => Response.json({ message: "401 Unauthorized" }, { status: 401 }))
    await expect(createTrackerFactory(unauthorized.fetcher)("gitlab", gitlab, "bad").test()).rejects.toThrow(
      "The GitLab token is invalid or has expired",
    )
    const missing = fakeFetch(() => Response.json({ message: "404 Project Not Found" }, { status: 404 }))
    await expect(createTrackerFactory(missing.fetcher)("gitlab", gitlab, "glpat").test()).rejects.toThrow(
      "The GitLab project was not found or the token lacks the api scope",
    )
  })
})

const linear = { teamKey: "ENG", labels: ["Bug", "missing"] }
const linearTeam = {
  data: { teams: { nodes: [{ id: "team-1", labels: { nodes: [{ id: "l-bug", name: "bug" }, { id: "l-ux", name: "UX" }] } }] } },
}

describe("Linear client", () => {
  test("creates an issue in the team with the labels it knows", async () => {
    const { fetcher, requests } = fakeFetch(async (request) => {
      const body = (await request.clone().json()) as { query: string }
      if (body.query.includes("issueCreate")) {
        return Response.json({
          data: { issueCreate: { success: true, issue: { identifier: "ENG-142", url: "https://linear.app/kantor/issue/ENG-142" } } },
        })
      }
      return Response.json(linearTeam)
    })
    const issue = await createTrackerFactory(fetcher)("linear", linear, "lin_api_key").createIssue(content)
    expect(issue).toEqual({ externalId: "ENG-142", url: "https://linear.app/kantor/issue/ENG-142" })
    expect(requests.map((request) => request.url)).toEqual(["https://api.linear.app/graphql", "https://api.linear.app/graphql"])
    expect((requests[0] as Request).headers.get("authorization")).toBe("lin_api_key")
    const create = (await (requests[1] as Request).json()) as { variables: { input: Record<string, unknown> } }
    expect(create.variables.input).toMatchObject({ teamId: "team-1", title: "Pay button fails", labelIds: ["l-bug"] })
    expect(String(create.variables.input.description)).toContain("https://bugberry.kantor.test/r/r1")
  })

  test("the connection test reports a team that does not exist", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ data: { teams: { nodes: [] } } }))
    await expect(createTrackerFactory(fetcher)("linear", linear, "lin_api_key").test()).rejects.toThrow("Linear team ENG was not found")
  })

  test("a GraphQL error becomes its message, and a bad key a plain one", async () => {
    const graphql = fakeFetch(() => Response.json({ errors: [{ message: "Title is too long" }] }))
    await expect(createTrackerFactory(graphql.fetcher)("linear", linear, "lin").test()).rejects.toThrow("Linear: Title is too long")
    const unauthorized = fakeFetch(() =>
      Response.json({ errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] }, { status: 400 }),
    )
    await expect(createTrackerFactory(unauthorized.fetcher)("linear", linear, "bad").test()).rejects.toThrow("The Linear API key is invalid")
  })
})

const jira = { siteUrl: "https://kantor.atlassian.net", email: "dev@kantor.test", projectKey: "BUG", issueType: "Bug", labels: ["from bugberry"] }

describe("Jira client", () => {
  test("creates an issue with basic auth and an Atlassian document description", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ id: "10001", key: "BUG-12" }, { status: 201 }))
    const issue = await createTrackerFactory(fetcher)("jira", jira, "atl-token").createIssue(content)
    expect(issue).toEqual({ externalId: "BUG-12", url: "https://kantor.atlassian.net/browse/BUG-12" })
    const request = requests[0] as Request
    expect(request.url).toBe("https://kantor.atlassian.net/rest/api/3/issue")
    expect(request.headers.get("authorization")).toBe(`Basic ${btoa("dev@kantor.test:atl-token")}`)
    const body = (await request.json()) as { fields: Record<string, unknown> }
    expect(body.fields).toMatchObject({
      project: { key: "BUG" },
      summary: "Pay button fails",
      issuetype: { name: "Bug" },
      labels: ["from-bugberry"],
    })
    expect(body.fields.description).toMatchObject({ version: 1, type: "doc" })
  })

  test("the connection test needs the issue type in the project", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ key: "BUG", issueTypes: [{ name: "Task" }, { name: "Story" }] }))
    await expect(createTrackerFactory(fetcher)("jira", jira, "atl-token").test()).rejects.toThrow("Jira project BUG has no issue type Bug")
    expect((requests[0] as Request).url).toBe("https://kantor.atlassian.net/rest/api/3/project/BUG")
    const ok = fakeFetch(() => Response.json({ key: "BUG", issueTypes: [{ name: "bug" }] }))
    await expect(createTrackerFactory(ok.fetcher)("jira", jira, "atl-token").test()).resolves.toBeUndefined()
  })

  test("Jira's own error messages are passed on, and auth failures are plain", async () => {
    const bad = fakeFetch(() => Response.json({ errorMessages: [], errors: { summary: "Summary is required" } }, { status: 400 }))
    await expect(createTrackerFactory(bad.fetcher)("jira", jira, "atl").createIssue(content)).rejects.toThrow("Summary is required")
    const unauthorized = fakeFetch(() => new Response("", { status: 401 }))
    await expect(createTrackerFactory(unauthorized.fetcher)("jira", jira, "atl").test()).rejects.toThrow("The Jira email or API token is wrong")
  })
})
