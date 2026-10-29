import { RiApps2Line, RiSettings3Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { buttonStyles } from "@bugberry/ui/button"
import { ReportsBrowser } from "../components/ReportsBrowser"
import { ReportsPageSkeleton } from "../components/Skeletons"
import { EmptyState, ErrorState } from "../components/ui"
import { useCurrentWorkspace } from "../lib/workspace"
import { queries } from "../lib/queries"

const routeApi = getRouteApi("/_authed/app/p/$projectSlug")

export function ProjectReportsPage() {
  const { projectSlug } = routeApi.useParams()
  const search = routeApi.useSearch()
  const navigate = useNavigate({ from: "/app/p/$projectSlug" })
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.slug === projectSlug)
  const isAdmin = workspace?.role === "admin"

  if (projects.isPending) return <ReportsPageSkeleton />
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
  if (!project) return <EmptyState title="Project not found">No project has the slug “{projectSlug}”.</EmptyState>

  return (
    <ReportsBrowser
      key={project.id}
      title={project.name}
      showCount
      scope={{ projectId: project.id }}
      search={search}
      setSearch={(update) => void navigate({ search: update })}
      actions={
        <>
          <Link
            to="/app/p/$projectSlug/integrations"
            params={{ projectSlug }}
            className={buttonStyles({ intent: "outline", size: "sm", className: "bg-background" })}
          >
            <RiApps2Line aria-hidden />
            <span className="hidden sm:inline">Integrations</span>
          </Link>
          {isAdmin && (
            <Link to="/app/settings/projects" className={buttonStyles({ intent: "outline", size: "sm", className: "bg-background" })}>
              <RiSettings3Line aria-hidden />
              <span className="hidden sm:inline">Project settings</span>
            </Link>
          )}
        </>
      }
    />
  )
}
