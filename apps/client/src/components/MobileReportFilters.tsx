import { CAPTURE_TYPES, type CaptureType, PRIORITIES, REPORT_STATUSES, type ReportStatus } from "@bugberry/shared"
import { RiCameraLine, RiCloseLine, RiEqualizerLine, RiFlag2Line, RiHashtag, RiVideoOnLine } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { Sheet } from "@bugberry/ui/sheet"
import type { Member, ReportCounts } from "../lib/api"
import { CAPTURE_LABELS, PRIORITY_ICON_STYLES, PRIORITY_LABELS, STATUS_LABELS } from "../lib/labels"
import { initialsOf } from "../lib/people"
import { CLEARED_FILTERS, NO_PROJECT, type ReportSearch, toggleValue } from "../lib/report-search"
import { workspaceColor } from "../lib/workspace"
import type { Project } from "../features/projects/queries"

const ALL = "__all"
const CAPTURE_ICONS: Record<CaptureType, typeof RiCameraLine> = { video: RiVideoOnLine, screenshot: RiCameraLine }

/** How many kinds of filter are on (type, status, reporter, project, priority, assignee), for the Filters badge. */
export function activeFilterCount(search: ReportSearch): number {
  return [search.captureType, search.status, search.reporterId, search.projectId, search.priority, search.assigneeId].filter(
    (value) => value !== undefined,
  ).length
}

/** A rounded filter chip; `aria-pressed` says whether it is on. */
function Chip({ pressed, onPress, children }: { pressed: boolean; onPress(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring ${
        pressed ? "border-primary/30 bg-primary-subtle text-primary" : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The phone's status row: All and each status with how many reports it holds under the other filters. One status
 * at a time here; the Filters sheet can pick several.
 */
export function StatusChips({
  search,
  counts,
  onChange,
}: {
  search: ReportSearch
  counts: ReportCounts | null
  onChange(patch: Partial<ReportSearch>): void
}) {
  const only = search.status?.length === 1 ? search.status[0] : undefined
  const chip = (label: string, count: number | undefined, selected: boolean, onPress: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-leaf bg-leaf text-white" : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {label}
      {count !== undefined && <span className={selected ? "text-white/80" : "text-muted-foreground"}>{count}</span>}
    </button>
  )
  return (
    <div role="group" aria-label="Status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {chip("All", counts?.total, !search.status, () => onChange({ status: undefined }))}
      {REPORT_STATUSES.map((status: ReportStatus) =>
        chip(STATUS_LABELS[status], counts?.byStatus[status], only === status, () =>
          onChange({ status: only === status ? undefined : [status] }),
        ),
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

/** Every filter as chips in a bottom sheet, for phones. Choices apply at once; Show reports closes the sheet. */
export function FiltersSheetContent({
  search,
  members,
  projects,
  onChange,
  onDone,
}: {
  search: ReportSearch
  members: readonly Member[]
  /** Given on the all-reports page only. */
  projects?: readonly Project[]
  onChange(patch: Partial<ReportSearch>): void
  onDone(): void
}) {
  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 pt-5 pb-4">
        <h2 className="font-heading text-xl font-bold text-foreground">Filters</h2>
        <div className="flex items-center gap-1">
          <Button intent="plain" size="sm" className="text-primary" onPress={() => onChange(CLEARED_FILTERS)}>
            Reset
          </Button>
          <Button intent="plain" size="sq-sm" aria-label="Close" onPress={onDone}>
            <RiCloseLine aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 overflow-y-auto px-5 py-5">
        <Section title="Type">
          {CAPTURE_TYPES.map((type) => {
            const Icon = CAPTURE_ICONS[type]
            return (
              <Chip key={type} pressed={search.captureType === type} onPress={() => onChange({ captureType: search.captureType === type ? undefined : type })}>
                <Icon aria-hidden className="size-4" />
                {CAPTURE_LABELS[type]}
              </Chip>
            )
          })}
        </Section>

        <Section title="Status">
          {REPORT_STATUSES.map((status) => (
            <Chip key={status} pressed={Boolean(search.status?.includes(status))} onPress={() => onChange({ status: toggleValue(search.status, status) })}>
              {STATUS_LABELS[status]}
            </Chip>
          ))}
        </Section>

        {members.length > 0 && (
          <Section title="Reporter">
            {members.map((member) => (
              <Chip
                key={member.id}
                pressed={search.reporterId === member.id}
                onPress={() => onChange({ reporterId: search.reporterId === member.id ? undefined : member.id })}
              >
                <Avatar
                  src={member.image}
                  initials={initialsOf(member.name)}
                  alt=""
                  size="xs"
                  className={member.image ? "" : `${workspaceColor(member.id)} text-white`}
                />
                {member.name}
              </Chip>
            ))}
          </Section>
        )}

        {projects && (
          <Section title="Project">
            {[...projects.map((project) => ({ id: project.id, name: project.name })), { id: NO_PROJECT, name: "No project" }].map((project) => (
              <Chip
                key={project.id}
                pressed={search.projectId === project.id}
                onPress={() => onChange({ projectId: search.projectId === project.id ? undefined : project.id })}
              >
                {project.id !== NO_PROJECT && <RiHashtag aria-hidden className="size-4" />}
                {project.name}
              </Chip>
            ))}
          </Section>
        )}

        <Section title="Priority">
          {PRIORITIES.map((priority) => (
            <Chip
              key={priority}
              pressed={Boolean(search.priority?.includes(priority))}
              onPress={() => onChange({ priority: toggleValue(search.priority, priority) })}
            >
              <RiFlag2Line aria-hidden className={`size-4 ${PRIORITY_ICON_STYLES[priority]}`} />
              {PRIORITY_LABELS[priority]}
            </Chip>
          ))}
        </Section>

        <section className="flex flex-col gap-2.5">
          <Select
            aria-label="Assignee"
            selectedKey={search.assigneeId ?? ALL}
            onSelectionChange={(key) => onChange({ assigneeId: key === null || key === ALL ? undefined : String(key) })}
          >
            <span className="text-sm font-medium text-foreground">Assignee</span>
            <SelectTrigger />
            <SelectContent items={[{ id: ALL, name: "All assignees" }, ...members]}>
              {(member) => <SelectItem id={member.id}>{member.name}</SelectItem>}
            </SelectContent>
          </Select>
        </section>
      </div>

      <div className="border-t border-border px-5 py-4">
        <Button className="w-full" onPress={onDone}>
          Show reports
        </Button>
      </div>
    </div>
  )
}

/** The phone's Filters button, with how many kinds of filter are on, and the sheet it opens. */
export function MobileFilters({
  search,
  members,
  projects,
  onChange,
}: {
  search: ReportSearch
  members: readonly Member[]
  projects?: readonly Project[]
  onChange(patch: Partial<ReportSearch>): void
}) {
  const [open, setOpen] = useState(false)
  const active = activeFilterCount(search)
  return (
    <>
      <Button intent="outline" onPress={() => setOpen(true)} aria-label={active ? `Filters, ${active} on` : "Filters"} className="shrink-0 bg-background">
        <RiEqualizerLine aria-hidden />
        Filters
        {active > 0 && (
          <span className="grid size-5 place-content-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{active}</span>
        )}
      </Button>
      <Sheet isOpen={open} onOpenChange={setOpen} position="bottom" aria-label="Filters">
        <FiltersSheetContent search={search} members={members} projects={projects} onChange={onChange} onDone={() => setOpen(false)} />
      </Sheet>
    </>
  )
}
