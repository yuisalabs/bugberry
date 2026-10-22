import type { QueryClient } from "@tanstack/react-query"
import { ApiError } from "./api"
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
  // The router shows the 403 page for it.
  if (pickWorkspace(workspaces, me.lastWorkspaceId)?.role !== "admin") {
    throw new ApiError(403, "forbidden", "Only workspace admins can open this page")
  }
}
