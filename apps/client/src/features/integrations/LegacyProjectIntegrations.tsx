import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Navigate } from "@tanstack/react-router"
import { SettingsRowsSkeleton } from "../../components/layout/Skeletons"
import { EmptyState } from "../../components/ui/empty-state"
import { useCurrentWorkspace } from "../workspaces/workspace"
import { projectQueries } from "../projects/queries"

const legacyRouteApi = getRouteApi("/_authed/_admin/app/settings/projects/$projectId/integrations")

/** The old address of a project's integrations page now leads to the project's own one. */
export function LegacyProjectIntegrations() {
  const { projectId } = legacyRouteApi.useParams()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...projectQueries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.id === projectId)
  if (projects.isPending) return <SettingsRowsSkeleton />
  if (!project) return <EmptyState title="Project not found">This project no longer exists.</EmptyState>
  return <Navigate to="/app/p/$projectSlug/integrations" params={{ projectSlug: project.slug }} replace />
}
