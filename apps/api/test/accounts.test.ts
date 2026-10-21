import { describe, expect, test } from "bun:test"
import { createAccountFactory } from "../src/lib/integrations/accounts"
import { HostGuardError, NO_GUARD, PRIVATE_HOST_MESSAGE } from "../src/lib/net/host-guard"

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return respond(request)
  }) as unknown as typeof fetch
  return { fetcher, requests }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

describe("GitHub", () => {
  test("checks the token and lists repositories and labels", async () => {
    const { fetcher, requests } = fakeFetch((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/user") return json({ login: "dana" })
      if (url.pathname === "/user/repos") return json([{ full_name: "kantor/web" }, { full_name: "kantor/admin" }])
      return json([{ name: "bug" }, { name: "frontend" }])
    })
    const github = createAccountFactory(fetcher, 5_000, NO_GUARD)("github", {}, "ghp_x")
    await github.check()
    expect(requests[0]?.url).toBe("https://api.github.com/user")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer ghp_x")
    expect(await github.list("targets", {})).toEqual([
      { value: "kantor/web", label: "kantor/web" },
      { value: "kantor/admin", label: "kantor/admin" },
    ])
    expect(requests[1]?.url).toBe("https://api.github.com/user/repos?per_page=100&sort=updated")
    expect(await github.list("targets", { q: "ADM" })).toEqual([{ value: "kantor/admin", label: "kantor/admin" }])
    expect(await github.list("labels", { parent: "kantor/web" })).toEqual([
      { value: "bug", label: "bug" },
      { value: "frontend", label: "frontend" },
    ])
    expect(requests.at(-1)?.url).toBe("https://api.github.com/repos/kantor/web/labels?per_page=100")
  })

  test("a 401 while listing gives the provider's reason", async () => {
    const { fetcher } = fakeFetch(() => json({ message: "Bad credentials" }, 401))
    await expect(createAccountFactory(fetcher, 5_000, NO_GUARD)("github", {}, "x").list("targets", {})).rejects.toThrow(
      "The GitHub token is invalid or has expired",
    )
  })

  test("lists stop at 100", async () => {
    const repos = Array.from({ length: 150 }, (_, index) => ({ full_name: `kantor/repo-${index}` }))
    const { fetcher } = fakeFetch(() => json(repos))
    expect(await createAccountFactory(fetcher, 5_000, NO_GUARD)("github", {}, "x").list("targets", {})).toHaveLength(100)
  })
})

describe("GitLab", () => {
  test("checks the token and lists projects (searched) and labels", async () => {
    const { fetcher, requests } = fakeFetch((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v4/user") return json({ username: "dana" })
      if (url.pathname === "/api/v4/projects") return json([{ path_with_namespace: "kantor/web" }])
      return json([{ name: "bug" }])
    })
    const gitlab = createAccountFactory(fetcher, 5_000, NO_GUARD)("gitlab", { baseUrl: "https://gitlab.kantor.test" }, "glpat")
    await gitlab.check()
    expect(requests[0]?.url).toBe("https://gitlab.kantor.test/api/v4/user")
    expect(requests[0]?.headers.get("private-token")).toBe("glpat")
    expect(await gitlab.list("targets", { q: "web" })).toEqual([{ value: "kantor/web", label: "kantor/web" }])
    expect(requests[1]?.url).toBe(
      "https://gitlab.kantor.test/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&search=web",
    )
    expect(await gitlab.list("labels", { parent: "kantor/web" })).toEqual([{ value: "bug", label: "bug" }])
    expect(requests.at(-1)?.url).toBe("https://gitlab.kantor.test/api/v4/projects/kantor%2Fweb/labels?per_page=100")
  })
})

describe("Linear", () => {
  test("checks the key and lists teams and a team's labels", async () => {
    const { fetcher, requests } = fakeFetch(async (request) => {
      const body = (await request.clone().json()) as { query: string }
      if (body.query.includes("viewer")) return json({ data: { viewer: { id: "u1" } } })
      if (body.query.includes("labels")) {
        return json({ data: { teams: { nodes: [{ id: "t1", key: "ENG", labels: { nodes: [{ id: "l1", name: "Bug" }] } }] } } })
      }
      return json({ data: { teams: { nodes: [{ key: "ENG", name: "Engineering" }] } } })
    })
    const linear = createAccountFactory(fetcher, 5_000, NO_GUARD)("linear", {}, "lin_api")
    await linear.check()
    expect(requests[0]?.url).toBe("https://api.linear.app/graphql")
    expect(requests[0]?.headers.get("authorization")).toBe("lin_api")
    expect(await linear.list("targets", {})).toEqual([{ value: "ENG", label: "Engineering (ENG)" }])
    expect(await linear.list("labels", { parent: "ENG" })).toEqual([{ value: "Bug", label: "Bug" }])
  })
})

describe("Jira", () => {
  test("checks the login and lists projects, issue types and labels", async () => {
    const { fetcher, requests } = fakeFetch((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/rest/api/3/myself") return json({ accountId: "a1" })
      if (url.pathname === "/rest/api/3/project/search") return json({ values: [{ key: "BUG", name: "Bugs" }] })
      if (url.pathname === "/rest/api/3/project/BUG") return json({ issueTypes: [{ name: "Bug" }, { name: "Task" }] })
      return json({ values: ["frontend", "from-qa"] })
    })
    const jira = createAccountFactory(fetcher, 5_000, NO_GUARD)(
      "jira",
      { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" },
      "atl",
    )
    await jira.check()
    expect(requests[0]?.url).toBe("https://kantor.atlassian.net/rest/api/3/myself")
    expect(requests[0]?.headers.get("authorization")).toBe(`Basic ${btoa("dana@kantor.test:atl")}`)
    expect(await jira.list("targets", { q: "bu" })).toEqual([{ value: "BUG", label: "Bugs (BUG)" }])
    expect(requests[1]?.url).toBe("https://kantor.atlassian.net/rest/api/3/project/search?maxResults=100&query=bu")
    expect(await jira.list("issueTypes", { parent: "BUG" })).toEqual([
      { value: "Bug", label: "Bug" },
      { value: "Task", label: "Task" },
    ])
    expect(await jira.list("labels", { q: "qa" })).toEqual([{ value: "from-qa", label: "from-qa" }])
  })
})

describe("ActiveCollab", () => {
  test("checks the token and lists projects and task lists", async () => {
    const { fetcher, requests } = fakeFetch((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v1/projects") return json([{ id: 12, name: "Website" }])
      return json([{ id: 3, name: "Bugs" }])
    })
    const ac = createAccountFactory(fetcher, 5_000, NO_GUARD)("activecollab", { baseUrl: "https://ac.kantor.test" }, "tok")
    await ac.check()
    expect(requests[0]?.url).toBe("https://ac.kantor.test/api/v1/projects")
    expect(requests[0]?.headers.get("x-angie-authapitoken")).toBe("tok")
    expect(await ac.list("targets", {})).toEqual([{ value: "12", label: "Website" }])
    expect(await ac.list("taskLists", { parent: "12" })).toEqual([{ value: "3", label: "Bugs" }])
    expect(requests.at(-1)?.url).toBe("https://ac.kantor.test/api/v1/projects/12/task-lists")
    await expect(ac.list("labels", {})).rejects.toThrow("ActiveCollab has no labels list")
  })
})

describe("Telegram", () => {
  test("checks the bot token and has nothing to list", async () => {
    const { fetcher, requests } = fakeFetch(() => json({ ok: true, result: { username: "bugberry_bot" } }))
    const telegram = createAccountFactory(fetcher, 5_000, NO_GUARD)("telegram", {}, "123:abc")
    await telegram.check()
    expect(requests[0]?.url).toBe("https://api.telegram.org/bot123:abc/getMe")
    await expect(telegram.list("targets", {})).rejects.toThrow("Telegram has no targets list")
  })

  test("a wrong bot token is reported", async () => {
    const { fetcher } = fakeFetch(() => json({ ok: false, description: "Unauthorized" }, 401))
    await expect(createAccountFactory(fetcher, 5_000, NO_GUARD)("telegram", {}, "bad").check()).rejects.toThrow("The Telegram bot token is wrong")
  })
})

describe("the guard", () => {
  test("every list goes through the guard", async () => {
    const { fetcher, requests } = fakeFetch(() => json([]))
    const refuse = async () => {
      throw new HostGuardError(PRIVATE_HOST_MESSAGE)
    }
    const gitlab = createAccountFactory(fetcher, 5_000, refuse)("gitlab", { baseUrl: "https://gitlab.internal" }, "x")
    await expect(gitlab.list("targets", {})).rejects.toThrow("private network")
    await expect(gitlab.check()).rejects.toThrow("private network")
    expect(requests).toHaveLength(0)
  })
})
