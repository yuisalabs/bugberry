import { RiRecordCircleLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useNow } from "../../../hooks/useNow"
import { invitesAllowed, usageText } from "../../workspaces/usage"
import { useListPeople } from "./list-people"
import { hasFilters, type ReportSearch, toReportsQuery } from "./report-search"
import { readLayout, type ReportLayout, saveLayout } from "./report-layout"
import { useCurrentWorkspace } from "../../workspaces/workspace"
import { InviteDialog } from "../../workspaces/InviteDialog"
import { InstallExtensionButton, NewReportButton } from "./NewReportButton"
import { ReportsView } from "./ReportsView"
import { useReportFeed } from "./useReportFeed"
import { installHref } from "../../landing/site-links"
import { authQueries } from "../../auth/queries"
import { projectQueries } from "../../projects/queries"
import { workspaceQueries } from "../../workspaces/queries"
import { reportQueries } from "../queries"

export type SearchUpdater = (update: (prev: ReportSearch) => ReportSearch) => void

/**
 * ReportsView wired to the API and the URL. `scope` fixes the project on a project page; the
 * all-reports page passes `{}` and shows the project filter.
 */
export function ReportsBrowser({
  title,
  scope,
  search,
  setSearch,
  showProjectFilter = false,
  actions,
  showCount,
}: {
  title: string
  scope: { projectId?: string }
  search: ReportSearch
  setSearch: SearchUpdater
  showProjectFilter?: boolean
  actions?: ReactNode
  /** "12 reports" under the title (a project's page). */
  showCount?: boolean
}) {
  const now = useNow()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const members = useListPeople(workspaceId, Boolean(workspace))
  // The project filter needs them on the all-reports page; the list view names projects on every page.
  const projects = useQuery({ ...projectQueries.projects(workspaceId), enabled: Boolean(workspace) })
  const feed = useReportFeed(workspaceId, toReportsQuery(scope, search), Boolean(workspace))
  const config = useQuery(authQueries.clientConfig())
  // The server's own install link, else BugBerry's Chrome Web Store page.
  const installUrl = installHref(config.data?.extensionInstallUrl ?? null)
  const [layout, setLayout] = useState<ReportLayout>(readLayout)
  const [inviting, setInviting] = useState(false)
  const limits = useQuery({ ...workspaceQueries.workspaceLimits(workspaceId), enabled: Boolean(workspace) })

  const update = (patch: Partial<ReportSearch>) => setSearch((prev) => ({ ...prev, ...patch }))
  // Filters left nothing: count the whole list, so the page can say how much was searched.
  const nothingMatches = hasFilters(search) && feed.empty
  const everything = useQuery({ ...reportQueries.reportCount(workspaceId, scope.projectId), enabled: Boolean(workspace) && nothingMatches })

  return (
    <>
    <ReportsView
      title={title}
      members={members.data ?? []}
      projects={showProjectFilter ? (projects.data ?? []) : undefined}
      tableProjects={projects.data}
      projectsLoading={projects.isPending}
      search={search}
      list={feed.list}
      now={now}
      actions={actions}
      canInvite={workspace?.role === "admin" && invitesAllowed(limits.data)}
      onInvite={() => setInviting(true)}
      usage={limits.data ? usageText(limits.data) : null}
      showCount={showCount}
      subtitle={showCount ? undefined : workspace?.name}
      statusCounts={feed.statusCounts}
      fab={
        <NewReportButton
          installUrl={installUrl}
          prominent
          className="rounded-full px-5 shadow-lg shadow-primary/30"
        />
      }
      checkedTotal={everything.data ?? null}
      recordButton={
        <NewReportButton
          installUrl={installUrl}
          label="Record your first bug"
          icon={<RiRecordCircleLine aria-hidden />}
          prominent
        />
      }
      installButton={<InstallExtensionButton installUrl={installUrl} />}
      layout={layout}
      onLayout={(next) => {
        setLayout(next)
        saveLayout(next)
      }}
      onSearch={(patch) => update(patch)}
      onLoadMore={feed.loadMore}
      onPreviewError={feed.refreshPreviews}
    />
    {workspace && <InviteDialog workspaceId={workspace.id} isOpen={inviting} onOpenChange={setInviting} />}
    </>
  )
}
