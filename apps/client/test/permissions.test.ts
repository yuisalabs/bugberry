import { describe, expect, test } from "bun:test"
import { QueryClient, queryOptions } from "@tanstack/react-query"
import { isRedirect } from "@tanstack/react-router"
import { requireWorkspaceMember } from "../src/features/auth/admin-guard"
import type { Me } from "../src/features/account/queries"
import type { Workspace } from "../src/features/workspaces/queries"
import { permissionsOf } from "../src/features/workspaces/permissions"
import { roleLabel } from "../src/features/workspaces/workspace"

describe("permissionsOf", () => {
  test("guests have no permission; members and admins have all", () => {
    expect(Object.values(permissionsOf("guest"))).toEqual([false, false, false, false])
    expect(Object.values(permissionsOf(null))).toEqual([false, false, false, false])
    expect(Object.values(permissionsOf("member"))).toEqual([true, true, true, true])
    expect(Object.values(permissionsOf("admin"))).toEqual([true, true, true, true])
  })
})

test("a guest workspace reads Guest", () => {
  expect(roleLabel({ role: "guest", owner: false })).toBe("Guest")
})

describe("requireWorkspaceMember", () => {
  const me = queryOptions({
    queryKey: ["me"],
    queryFn: async (): Promise<Me> => ({ id: "u1", name: "Ana", email: "a@k.test", image: null, lastWorkspaceId: "w1" }),
  })
  const as = (role: Workspace["role"]) =>
    queryOptions({ queryKey: ["workspaces", role], queryFn: async (): Promise<Workspace[]> => [{ id: "w1", name: "Alpha", role, owner: false, slug: "alpha", logoUrl: null }] })

  test("a guest opening a members' page lands on /app", async () => {
    const thrown = await requireWorkspaceMember(new QueryClient(), { me, workspaces: as("guest") }).catch((caught) => caught)
    expect(isRedirect(thrown)).toBe(true)
    expect(thrown.options.to).toBe("/app")
  })

  test("a member goes through", async () => {
    await expect(requireWorkspaceMember(new QueryClient(), { me, workspaces: as("member") })).resolves.toBeUndefined()
  })
})
