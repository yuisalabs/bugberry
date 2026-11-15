import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { useListPeople } from "../src/features/reports/list/list-people"
import { workspaceQueries } from "../src/features/workspaces/queries"

const person = (id: string, name: string, deactivated: boolean) => ({
  id,
  name,
  email: `${id}@kantor.test`,
  image: null,
  role: "member" as const,
  owner: false,
  deactivated,
  joinedAt: new Date("2026-09-12T00:00:00Z"),
})

describe("the people a report list names and filters by", () => {
  test("include someone who was deactivated: their reports are still assigned to them", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    client.setQueryData(workspaceQueries.members("w1").queryKey, [person("u1", "Ana", false)])
    client.setQueryData(workspaceQueries.allMembers("w1").queryKey, [person("u1", "Ana", false), person("u2", "Gone", true)])
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useListPeople("w1", true), { wrapper })
    expect(result.current.data?.map((member) => member.name)).toEqual(["Ana", "Gone"])
  })
})
