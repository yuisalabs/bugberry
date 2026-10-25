import { RiRecordCircleLine } from "@remixicon/react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useNow } from "../hooks/useNow"
import { queries } from "../lib/queries"
import { invitesAllowed, usageText } from "../lib/usage"
import { feedItems } from "../lib/report-feed"
import { hasFilters, type ReportSearch, toReportsQuery } from "../lib/report-search"
import { readLayout, type ReportLayout, saveLayout } from "../lib/report-layout"
import { useCurrentWorkspace } from "../lib/workspace"
import { InviteDialog } from "./InviteDialog"
import { InstallExtensionButton, NewReportButton } from "./NewReportButton"
import { ReportsView } from "./ReportsView"
import { installHref } from "../pages/landing/site-links"

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
  const members = useQuery({ ...queries.members(workspaceId), enabled: Boolean(workspace) })
  // The project filter needs them on the all-reports page; the list view names projects on every page.
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(workspace) })
  const reports = useInfiniteQuery({ ...queries.reportFeed(workspaceId, toReportsQuery(scope, search)), enabled: Boolean(workspace) })
  const config = useQuery(queries.clientConfig())
  // The server's own install link, else BugBerry's Chrome Web Store page.
  const installUrl = installHref(config.data?.extensionInstallUrl ?? null)
  const [layout, setLayout] = useState<ReportLayout>(readLayout)
  const [inviting, setInviting] = useState(false)
  const limits = useQuery({ ...queries.workspaceLimits(workspaceId), enabled: Boolean(workspace) })

  const update = (patch: Partial<ReportSearch>) => setSearch((prev) => ({ ...prev, ...patch }))
  const pages = reports.data?.pages ?? []
  // Filters left nothing: count the whole list, so the page can say how much was searched.
  // The phone's status chips: each status's count under the other filters.
  const statusCounts = useQuery({
    ...queries.reportStatusCounts(workspaceId, toReportsQuery(scope, search)),
    enabled: Boolean(workspace),
  })
  const nothingMatches = hasFilters(search) && pages.length > 0 && (pages.at(-1)?.total ?? 0) === 0
  const everything = useQuery({ ...queries.reportCount(workspaceId, scope.projectId), enabled: Boolean(workspace) && nothingMatches })

  return (
    <>
    <ReportsView
      title={title}
      members={members.data ?? []}
      projects={showProjectFilter ? (projects.data ?? []) : undefined}
      tableProjects={projects.data}
      projectsLoading={projects.isPending}
      search={search}
      list={
        reports.isPending
          ? "loading"
          : reports.isError && pages.length === 0
            ? { error: reports.error, retry: () => void reports.refetch() }
            : {
                items: feedItems(pages),
                total: pages.at(-1)?.total ?? 0,
                hasMore: reports.hasNextPage,
                loadingMore: reports.isFetchingNextPage,
                moreFailed: reports.isFetchNextPageError,
              }
      }
      now={now}
      actions={actions}
      canInvite={workspace?.role === "admin" && invitesAllowed(limits.data)}
      onInvite={() => setInviting(true)}
      usage={limits.data ? usageText(limits.data) : null}
      showCount={showCount}
      subtitle={showCount ? undefined : workspace?.name}
      statusCounts={statusCounts.data ?? null}
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
      // One part at a time: the end of the list stops asking while a part loads, and this guards it too.
      onLoadMore={() => {
        if (reports.hasNextPage && !reports.isFetchingNextPage) void reports.fetchNextPage({ cancelRefetch: false })
      }}
      onPreviewError={() => void reports.refetch()}
    />
    {workspace && <InviteDialog workspaceId={workspace.id} isOpen={inviting} onOpenChange={setInviting} />}
    </>
  )
}
