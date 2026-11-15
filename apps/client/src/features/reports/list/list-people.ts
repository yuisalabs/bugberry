import { useQuery } from "@tanstack/react-query"
import { workspaceQueries } from "../../workspaces/queries"

/**
 * The people a report list names and filters by. Deactivated people are included: their reports are
 * still assigned to them, and an admin has to find those to reassign them.
 */
export function useListPeople(workspaceId: string, enabled: boolean) {
  return useQuery({ ...workspaceQueries.allMembers(workspaceId), enabled })
}
