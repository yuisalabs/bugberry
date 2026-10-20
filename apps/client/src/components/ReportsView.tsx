import { RiUserAddLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Button } from "@bugberry/ui/button"
import type { Member, Project, ReportListItem } from "../lib/api"
import type { ReportFeed } from "../lib/report-feed"
import type { ReportLayout } from "../lib/report-layout"
import { hasFilters, type ReportSearch } from "../lib/report-search"
import { LoadMore } from "./LoadMore"
import { ReportCard } from "./ReportCard"
import { LayoutToggle, ReportFilters, SortMenu } from "./ReportFilters"
import { ReportSearchBox } from "./ReportSearchBox"
import { ReportTable } from "./ReportTable"
import { LoadingSkeleton, ReportListSkeleton } from "./Skeletons"
import { EmptyState, ErrorState } from "./ui"

export type ReportListState = ReportFeed | "loading" | { error: unknown; retry: () => void }

/**
 * A report list page without router or query wiring: header (search, invite, new report), the filter
 * row with order and layout, the cards or the table, and more of them as it scrolls. ReportsBrowser connects it to
 * the URL and the API.
 */
export function ReportsView({
  title,
  members,
  projects,
  projectsLoading,
  search,
  list,
  now,
  actions,
  canInvite,
  onInvite,
  newReport,
  usage,
  layout,
  onLayout,
  onSearch,
  onLoadMore,
  onPreviewError,
  renderCard = (item) => <ReportCard item={item} now={now} onPreviewError={onPreviewError} />,
  tableProjects,
  renderTable = (items, names) => (
    <ReportTable items={items} members={members} projects={names} now={now} />
  ),
}: {
  title: string
  members: readonly Member[]
  /** Given on the all-reports page, which can filter by project. */
  projects?: readonly Project[]
  projectsLoading?: boolean
  search: ReportSearch
  list: ReportListState
  now: number
  actions?: ReactNode
  /** Admins only: the Invite button. */
  canInvite: boolean
  onInvite(): void
  newReport: ReactNode
  /** Under ACCOUNT_LIMITS: "3 of 5 screenshots · 5 of 5 recordings". */
  usage?: string | null
  layout: ReportLayout
  onLayout(layout: ReportLayout): void
  onSearch: (patch: Partial<ReportSearch>) => void
  /** The end of the list scrolled into view (or Try again after a part failed): fetch the next part. */
  onLoadMore: () => void
  onPreviewError?: () => void
  renderCard?: (item: ReportListItem) => ReactNode
  /** Every project of the workspace, so the table can name each report's project on any page. */
  tableProjects?: readonly Project[]
  renderTable?: (items: readonly ReportListItem[], projects: readonly Project[] | undefined) => ReactNode
}) {
  const loaded = typeof list === "object" && "items" in list ? list : null

  return (
    <section>
      {/* The title, search and filters stay at the top of the main column while the reports scroll under them.
          The bar reaches out over the column's padding so nothing shows above or beside it; a sticky element stops
          below that padding, so it sticks 24 px higher (-top-6) to reach the very top. */}
      <div data-sticky-bar className="flow-root bg-background md:sticky md:-top-6 md:z-20 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            {usage && <p className="text-xs text-muted-foreground">{usage}</p>}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ReportSearchBox value={search.q} onSearch={(q) => onSearch({ q })} />
            {actions}
            {canInvite && (
              <Button intent="outline" size="sm" aria-label="Invite" onPress={onInvite} className="bg-background">
                <RiUserAddLine aria-hidden />
                <span className="hidden sm:inline">Invite</span>
              </Button>
            )}
            {newReport}
          </div>
        </header>

        <ReportFilters
          search={search}
          members={members}
          projects={projects}
          projectsLoading={projectsLoading}
          onChange={onSearch}
          trailing={
            <>
              <SortMenu sort={search.sort} onChange={onSearch} />
              <LayoutToggle layout={layout} onLayout={onLayout} />
            </>
          }
        />
      </div>

      {list === "loading" ? (
        <LoadingSkeleton>
          <ReportListSkeleton layout={layout} />
        </LoadingSkeleton>
      ) : !loaded ? (
        <ErrorState error={(list as { error: unknown }).error} onRetry={(list as { retry: () => void }).retry} />
      ) : loaded.items.length === 0 ? (
        hasFilters(search) ? (
          <EmptyState title="No reports match these filters" />
        ) : (
          <EmptyState title="No reports yet">Reports from the BugBerry extension will show up here.</EmptyState>
        )
      ) : (
        <>
          {layout === "list" ? (
            renderTable(loaded.items, tableProjects ?? projects)
          ) : (
            <ul className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              {loaded.items.map((item) => (
                <li key={item.id}>{renderCard(item)}</li>
              ))}
            </ul>
          )}
          {loaded.loadingMore && (
            <div className="mt-6">
              <ReportListSkeleton layout={layout} count={3} />
            </div>
          )}
          <LoadMore
            shown={loaded.items.length}
            total={loaded.total}
            hasMore={loaded.hasMore}
            loading={loaded.loadingMore}
            failed={loaded.moreFailed}
            onLoadMore={onLoadMore}
          />
        </>
      )}
    </section>
  )
}
