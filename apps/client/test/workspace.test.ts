import { describe, expect, test } from "bun:test"
import { QueryClient, queryOptions } from "@tanstack/react-query"
import { requireWorkspaceAdmin } from "../src/features/auth/admin-guard"
import type { Workspace } from "../src/lib/api"
import { pickWorkspace, roleIn, roleLabel } from "../src/lib/workspace"
import { ApiError } from "../src/lib/query/unwrap"
import type { Me } from "../src/features/account/queries"

const alpha = { id: "w1", name: "Alpha", role: "admin" as const, owner: false, slug: "alpha", logoUrl: null }
const beta = { id: "w2", name: "Beta", role: "member" as const, owner: false, slug: "beta", logoUrl: null }

describe("pickWorkspace", () => {
  test("the last one used while still a member, else the first by name, else none", () => {
    expect(pickWorkspace([beta, alpha], "w2")).toBe(beta)
    expect(pickWorkspace([beta, alpha], "gone")).toBe(alpha)
    expect(pickWorkspace([beta, alpha], null)).toBe(alpha)
    expect(pickWorkspace([], "w1")).toBeNull()
  })
})

describe("roleIn", () => {
  test("the person's role in a workspace, or null outside it", () => {
    expect(roleIn([alpha, beta], "w2")).toBe("member")
    expect(roleIn([alpha, beta], "w9")).toBeNull()
  })
})

describe("requireWorkspaceAdmin", () => {
  const me = (lastWorkspaceId: string) =>
    queryOptions({
      queryKey: ["me"],
      queryFn: async (): Promise<Me> => ({ id: "u1", name: "Ana", email: "a@k.test", image: null, lastWorkspaceId }),
    })
  const workspaces = queryOptions({ queryKey: ["workspaces"], queryFn: async (): Promise<Workspace[]> => [alpha, beta] })

  test("keeps a member of the current workspace out with a 403, which the router shows as its page", async () => {
    const error = await requireWorkspaceAdmin(new QueryClient(), { me: me("w2"), workspaces }).catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: "forbidden" })
  })

  test("lets an admin of the current workspace through", async () => {
    await expect(requireWorkspaceAdmin(new QueryClient(), { me: me("w1"), workspaces })).resolves.toBeUndefined()
  })
})

describe("roleLabel", () => {
  test("names the owner, admins and members", () => {
    expect(roleLabel({ role: "admin", owner: true })).toBe("Owner")
    expect(roleLabel({ role: "admin", owner: false })).toBe("Admin")
    expect(roleLabel({ role: "member", owner: false })).toBe("Member")
  })
})
