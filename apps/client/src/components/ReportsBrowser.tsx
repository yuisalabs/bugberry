import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useNow } from "../hooks/useNow"
import { queries } from "../lib/queries"
import { feedItems } from "../lib/report-feed"
import { type ReportSearch, toReportsQuery } from "../lib/report-search"
import { readLayout, type ReportLayout, saveLayout } from "../lib/report-layout"
import { useCurrentWorkspace } from "../lib/workspace"
import { InviteDialog } from "./InviteDialog"
import { NewReportButton } from "./NewReportButton"
import { ReportsView } from "./ReportsView"

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
}: {
  title: string
  scope: { projectId?: string }
  search: ReportSearch
  setSearch: SearchUpdater
  showProjectFilter?: boolean
  actions?: ReactNode
}) {
  const now = useNow()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const members = useQuery({ ...queries.members(workspaceId), enabled: Boolean(workspace) })
  // The project filter needs them on the all-reports page; the list view names projects on every page.
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(workspace) })
  const reports = useInfiniteQuery({ ...queries.reportFeed(workspaceId, toReportsQuery(scope, search)), enabled: Boolean(workspace) })
  const config = useQuery(queries.clientConfig())
  const [layout, setLayout] = useState<ReportLayout>(readLayout)
  const [inviting, setInviting] = useState(false)

  const update = (patch: Partial<ReportSearch>) => setSearch((prev) => ({ ...prev, ...patch }))
  const pages = reports.data?.pages ?? []

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
      canInvite={workspace?.role === "admin"}
      onInvite={() => setInviting(true)}
      newReport={<NewReportButton installUrl={config.data?.extensionInstallUrl ?? null} />}
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
