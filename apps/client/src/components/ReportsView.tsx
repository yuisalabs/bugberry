import { RiResetLeftLine, RiUserAddLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Button } from "@bugberry/ui/button"
import type { Member, ReportCounts, ReportListItem } from "../lib/api"
import type { ReportFeed } from "../lib/report-feed"
import type { ReportLayout } from "../lib/report-layout"
import { CLEARED_FILTERS, hasFilters, type ReportSearch } from "../lib/report-search"
import { LoadMore } from "./LoadMore"
import { ReportCard } from "./ReportCard"
import { MobileFilters, StatusChips } from "./MobileReportFilters"
import { LayoutToggle, ReportFilters, SortMenu } from "./ReportFilters"
import { ReportSearchBox } from "./ReportSearchBox"
import { ReportTable } from "./ReportTable"
import { LoadingSkeleton, ReportListSkeleton } from "./Skeletons"
import { BugBerryLogo } from "./BugBerryLogo"
import { ErrorState } from "./ui"
import type { Project } from "../features/projects/queries"

export type ReportListState = ReportFeed | "loading" | { error: unknown; retry: () => void }

/**
 * A list with no report at all: the BugBerry with its net and an empty jar, a note pointing at the jar, and
 * the two ways to fill it: record a bug, or invite the people who will.
 */
export function ReportsEmpty({ record, install, invite }: { record?: ReactNode; install?: ReactNode; invite?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div className="relative">
        <img src="/assets/empty_reports.webp" alt="" width={600} height={428} className="h-auto w-[22rem] max-w-full" />
        {/* The note sits to the right of the jar, its arrow ending at the lid; on phones there's no room for it. */}
        <div aria-hidden className="absolute top-[2%] left-[78%] hidden flex-col items-start sm:flex">
          <span className="-rotate-6 font-hand text-2xl whitespace-nowrap text-primary">your first bug goes in here!</span>
          <span className="mt-1 ml-1 h-24 w-14 bg-primary [mask:url(/assets/arrow_curve.svg)_center/contain_no-repeat]" />
        </div>
      </div>
      <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-3xl">No bugs caught yet</h2>
      <p className="max-w-md text-muted-foreground">
        Your jar is still empty. Record your first bug and it'll land here, with the video, console logs and network requests bundled
        into one link.
      </p>
      {(record || install || invite) && (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          {record}
          {install}
          {invite}
        </div>
      )}
    </div>
  )
}

/** "We checked all 128 reports, …": how much the filters went through, once that count is known. */
export function checkedText(total: number | null): string {
  if (total === null) return "None of the reports fit every filter at once."
  if (total === 0) return "There are no reports here yet, so there's nothing to match."
  if (total === 1) return "We checked the only report, but it doesn't fit every filter at once."
  return `We checked all ${total} reports, but none fit every filter at once.`
}

/** Filters that leave nothing: the BugBerry searching with its magnifier, and a way back to every report. */
export function ReportsNoMatch({ checked, onClear }: { checked: number | null; onClear(): void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <img src="/assets/no_match_reports.webp" alt="" width={500} height={380} className="h-auto w-72 max-w-full" />
      <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-3xl">No reports match your filters</h2>
      <p className="max-w-md text-muted-foreground">
        {checkedText(checked)} Try loosening one. The bug might be hiding just outside the net.
      </p>
      <Button intent="outline" onPress={onClear} className="mt-3 bg-background">
        <RiResetLeftLine aria-hidden />
        Clear all filters
      </Button>
    </div>
  )
}

/**
 * A report list page without router or query wiring: header (search, invite, new report), the filter
 * row with order and layout, the cards or the table, and more of them as it scrolls. ReportsBrowser connects it to
 * the URL and the API.
 */
export function ReportsView({
  title,
  showCount = false,
  subtitle,
  statusCounts = null,
  fab,
  recordButton,
  installButton,
  checkedTotal = null,
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
  renderCard = (item) => (
    <ReportCard
      item={item}
      now={now}
      projectName={(tableProjects ?? projects)?.find((project) => project.id === item.projectId)?.name ?? null}
      onPreviewError={onPreviewError}
    />
  ),
  tableProjects,
  renderTable = (items, names) => (
    <ReportTable items={items} members={members} projects={names} now={now} />
  ),
}: {
  title: string
  /** "12 reports" under the title once the list is in (a project's page). */
  showCount?: boolean
  /** The workspace's name on All reports: "27 reports in Cuy Workspaces" under the title. */
  subtitle?: string
  /** How many reports each status holds, for the phone's status chips; null until known. */
  statusCounts?: ReportCounts | null
  /** The phone's floating New report button; from tablet width up the header has its own. */
  fab?: ReactNode
  /** "Record your first bug" on a list with no report at all. */
  recordButton?: ReactNode
  /** "Add to Chrome" on a list with no report, while this browser has no extension. */
  installButton?: ReactNode
  /** How many reports the list holds before filtering, when filters left none; null until known. */
  checkedTotal?: number | null
  members: readonly Member[]
  /** Given on the all-reports page, which can filter by project. */
  projects?: readonly Project[]
  projectsLoading?: boolean
  search: ReportSearch
  list: ReportListState
  now: number
  actions?: ReactNode
  /** Admins only: the Invite button beside the title on phones (wider screens have it in the top bar). */
  canInvite: boolean
  onInvite(): void
  /** A New report button in the header; the app's top bar has its own, so pages leave it out. */
  newReport?: ReactNode
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
  // Nothing recorded yet and nothing filtered: filters and order would have nothing to work on.
  const bare = loaded !== null && loaded.items.length === 0 && !hasFilters(search)
  const count = loaded ? `${loaded.total} ${loaded.total === 1 ? "report" : "reports"}` : null

  return (
    <section className={fab ? "pb-20 md:pb-0" : undefined}>
      {/* The title, search and filters stay at the top of the main column while the reports scroll under them.
          The bar reaches out over the column's padding so nothing shows above or beside it; a sticky element stops
          below that padding, so it sticks 24 px higher (-top-6) to reach the very top. */}
      <div data-sticky-bar className="flow-root bg-sidebar md:sticky md:-top-6 md:z-20 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        {/* One header for every screen. On phones: title with Invite beside it, then search and Filters on their own
            row. From tablet width up: title, then search and actions in one row; Invite sits in the app's top bar. */}
        <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-5 md:justify-between">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-5 md:flex-none">
            <span className="hidden shrink-0 border-r border-border pr-5 md:inline-flex">
              <BugBerryLogo className="h-9" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="truncate font-heading text-xl font-bold tracking-tight text-foreground">{title}</h1>
              {subtitle ? (
                <p className="truncate text-sm text-muted-foreground">{count ? `${count} in ${subtitle}` : subtitle}</p>
              ) : (
                showCount && count && <p className="text-sm text-muted-foreground">{count}</p>
              )}
              {usage && <p className="text-xs text-muted-foreground">{usage}</p>}
            </div>
          </div>
          <div className="order-3 flex w-full items-center gap-2 md:order-2 md:w-auto">
            <ReportSearchBox value={search.q} onSearch={(q) => onSearch({ q })} />
            <span className="md:hidden">
              <MobileFilters search={search} members={members} projects={projects} onChange={onSearch} />
            </span>
            <span className="hidden items-center gap-2 md:flex">
              {actions}
              {newReport}
            </span>
          </div>
          {/* Phones: the header's own actions sit beside the title. */}
          <div className="order-2 flex items-center gap-2 md:hidden">
            {actions}
            {canInvite && (
              <Button intent="outline" size="sq-md" aria-label="Invite" onPress={onInvite} className="bg-background">
                <RiUserAddLine aria-hidden />
              </Button>
            )}
          </div>
        </header>

        {!bare && (
          <div className="mb-3 flex flex-col gap-3 md:hidden">
            <StatusChips search={search} counts={statusCounts} onChange={onSearch} />
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{count}</span>
              <SortMenu sort={search.sort} onChange={onSearch} showLabel />
            </div>
          </div>
        )}

        {!bare && (
          <div className="hidden md:block">
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
        )}
      </div>

      {list === "loading" ? (
        <LoadingSkeleton>
          <ReportListSkeleton layout={layout} />
        </LoadingSkeleton>
      ) : !loaded ? (
        <ErrorState error={(list as { error: unknown }).error} onRetry={(list as { retry: () => void }).retry} />
      ) : loaded.items.length === 0 ? (
        hasFilters(search) ? (
          <ReportsNoMatch checked={checkedTotal} onClear={() => onSearch(CLEARED_FILTERS)} />
        ) : (
          <ReportsEmpty
            record={recordButton}
            install={installButton}
            invite={
              canInvite && (
                <Button intent="outline" onPress={onInvite} className="bg-background">
                  <RiUserAddLine aria-hidden />
                  Invite teammates
                </Button>
              )
            }
          />
        )
      ) : (
        <>
          {layout === "list" ? (
            renderTable(loaded.items, tableProjects ?? projects)
          ) : (
            <ul className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {/* Cards far outside the window are not drawn until scrolled near, so a long list scrolls as smoothly as
                  a short one. The padding gives the focus ring room inside the card's own drawing area. */}
              {loaded.items.map((item) => (
                <li key={item.id} className="-m-1 p-1 [contain-intrinsic-size:auto_320px] [content-visibility:auto]">
                  {renderCard(item)}
                </li>
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
      {fab && <div className="fixed right-4 bottom-4 z-30 md:hidden">{fab}</div>}
    </section>
  )
}
