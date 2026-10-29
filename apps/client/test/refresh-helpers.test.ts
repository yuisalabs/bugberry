import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { refreshPeople } from "../src/features/account/queries"
import { refreshForNewWorkspace } from "../src/features/workspaces/queries"

const KEYS = [["me"], ["members", "w1"], ["workspaces"], ["reports", "w1", {}], ["comments", "r1"], ["projects", "w1"], ["auth-methods"]]

function seeded() {
  const client = new QueryClient()
  for (const key of KEYS) client.setQueryData(key, 1)
  return client
}
const invalidated = (client: QueryClient) => KEYS.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key[0])

describe("refresh helpers", () => {
  test("a new name or photo refreshes every list that shows people, and nothing else", async () => {
    const client = seeded()
    await refreshPeople(client)
    expect(invalidated(client)).toEqual(["me", "members", "workspaces", "reports", "comments"])
  })

  test("a new current workspace refreshes everything but the sign-in methods", async () => {
    const client = seeded()
    await refreshForNewWorkspace(client)
    expect(invalidated(client)).toEqual(["me", "members", "workspaces", "reports", "comments", "projects"])
  })
})
