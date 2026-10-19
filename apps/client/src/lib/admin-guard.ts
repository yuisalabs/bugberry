import type { QueryClient } from "@tanstack/react-query"
import { redirect } from "@tanstack/react-router"
import { queries } from "./queries"
import { pickWorkspace } from "./workspace"

/**
 * For workspace settings. Asks the server every time (staleTime 0) instead of trusting the cached
 * role, so a demotion made a moment ago already keeps the person out.
 */
export async function requireWorkspaceAdmin(
  queryClient: QueryClient,
  options: { me: ReturnType<typeof queries.me>; workspaces: ReturnType<typeof queries.workspaces> } = {
    me: queries.me(),
    workspaces: queries.workspaces(),
  },
): Promise<void> {
  const [me, workspaces] = await Promise.all([
    queryClient.fetchQuery({ ...options.me, staleTime: 0 }),
    queryClient.fetchQuery({ ...options.workspaces, staleTime: 0 }),
  ])
  if (pickWorkspace(workspaces, me.lastWorkspaceId)?.role !== "admin") throw redirect({ to: "/app" })
}
