import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ReportsBrowser } from "../components/ReportsBrowser"
import { EmptyState, ErrorState, Loading } from "../components/ui"
import { buttonStyles } from "@bugberry/ui/button"
import { queries } from "../lib/queries"
import { useCurrentWorkspace } from "../lib/workspace"

const routeApi = getRouteApi("/_authed/app/p/$projectSlug")

export function ProjectReportsPage() {
  const { projectSlug } = routeApi.useParams()
  const search = routeApi.useSearch()
  const navigate = useNavigate({ from: "/app/p/$projectSlug" })
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.slug === projectSlug)

  if (projects.isPending) return <Loading />
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
  if (!project) return <EmptyState title="Project not found">No project has the slug “{projectSlug}”.</EmptyState>

  return (
    <ReportsBrowser
      key={project.id}
      title={project.name}
      scope={{ projectId: project.id }}
      search={search}
      setSearch={(update) => void navigate({ search: update })}
      actions={
        workspace?.role === "admin" ? (
          <Link to="/app/settings/projects" className={buttonStyles({ intent: "outline", size: "sm" })}>
            Project settings
          </Link>
        ) : undefined
      }
    />
  )
}
