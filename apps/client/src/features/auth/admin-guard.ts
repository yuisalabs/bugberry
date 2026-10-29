import type { QueryClient } from "@tanstack/react-query"
import { pickWorkspace } from "../workspaces/workspace"
import { ApiError } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import { workspaceQueries } from "../workspaces/queries"

/**
 * For workspace settings. Asks the server every time (staleTime 0) instead of trusting the cached
 * role, so a demotion made a moment ago already keeps the person out.
 */
export async function requireWorkspaceAdmin(
  queryClient: QueryClient,
  options: { me: ReturnType<typeof accountQueries.me>; workspaces: ReturnType<typeof workspaceQueries.workspaces> } = {
    me: accountQueries.me(),
    workspaces: workspaceQueries.workspaces(),
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
