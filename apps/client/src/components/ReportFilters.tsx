import { CAPTURE_TYPES, type CaptureType, PRIORITIES, REPORT_STATUSES, type ReportStatus } from "@bugberry/shared"
import { RiArrowDownSLine, RiArrowUpDownLine, RiEqualizerFill, RiEqualizerLine, RiLayoutGridFill, RiLayoutGridLine, RiListUnordered } from "@remixicon/react"
import type { ReactNode } from "react"
import type { Selection } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuTrigger } from "@bugberry/ui/menu"
import { Popover, PopoverTrigger } from "@bugberry/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import type { Member, Project } from "../lib/api"
import { CAPTURE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../lib/labels"
import type { ReportLayout } from "../lib/report-layout"
import { hasFilters, NO_PROJECT, type ReportSearch, toggleValue } from "../lib/report-search"
import { ActiveIcon } from "./ActiveIcon"

const ALL = "__all"

/** The single key of a single-select menu, or undefined for "all". */
function picked(keys: Selection): string | undefined {
  if (keys === "all") return undefined
  const [key] = [...keys]
  return key === undefined || key === ALL ? undefined : String(key)
}

function FilterMenu({
  label,
  value,
  children,
  selectionMode,
  selectedKeys,
  onSelectionChange,
}: {
  label: string
  /** What is chosen, shown next to the label; undefined means nothing is filtered. */
  value?: string
  children: ReactNode
  selectionMode: "single" | "multiple"
  selectedKeys: Iterable<string>
  onSelectionChange: (keys: Selection) => void
}) {
  return (
    <MenuTrigger>
      <Button
        intent="plain"
        size="sm"
        aria-label={value ? `${label}: ${value}` : label}
        className={value ? "text-foreground" : "text-muted-foreground"}
      >
        {label}
        {value && <span className="font-semibold text-foreground">: {value}</span>}
        <RiArrowDownSLine aria-hidden />
      </Button>
      <Menu
        aria-label={label}
        selectionMode={selectionMode}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        placement="bottom start"
      >
        {children}
      </Menu>
    </MenuTrigger>
  )
}

/**
 * Jam-style filter row: type, status, reporter (and project on the all-reports page) as menus, the
 * rarer filters behind "More filters". `trailing` sits on the right (the order menu and the layout switch).
 */
export function ReportFilters({
  search,
  members,
  projects,
  projectsLoading = false,
  onChange,
  trailing,
}: {
  search: ReportSearch
  members: readonly Member[]
  /** Given only on the all-reports page, where reports can be narrowed to a project or to none. */
  projects?: readonly Project[]
  /** True while `projects` is still being fetched, so a chosen project shows as loading, not unknown. */
  projectsLoading?: boolean
  onChange: (patch: Partial<ReportSearch>) => void
  trailing?: ReactNode
}) {
  const statusValue = search.status?.map((status) => STATUS_LABELS[status]).join(", ")
  const reporter = members.find((member) => member.id === search.reporterId)
  const projectValue =
    search.projectId === undefined
      ? undefined
      : search.projectId === NO_PROJECT
        ? "No project"
        : (projects?.find((project) => project.id === search.projectId)?.name ??
          (projectsLoading ? "Loading…" : "not found"))

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <FilterMenu
          label="Type"
          value={search.captureType ? CAPTURE_LABELS[search.captureType] : undefined}
          selectionMode="single"
          selectedKeys={[search.captureType ?? ALL]}
          onSelectionChange={(keys) => onChange({ captureType: picked(keys) as CaptureType | undefined })}
        >
          <MenuItem id={ALL}>All</MenuItem>
          {CAPTURE_TYPES.map((type) => (
            <MenuItem key={type} id={type}>
              {CAPTURE_LABELS[type]}
            </MenuItem>
          ))}
        </FilterMenu>

        <FilterMenu
          label="Status"
          value={statusValue}
          selectionMode="multiple"
          selectedKeys={search.status ?? []}
          onSelectionChange={(keys) => {
            const chosen = keys === "all" ? [...REPORT_STATUSES] : REPORT_STATUSES.filter((status) => keys.has(status))
            onChange({ status: chosen.length > 0 ? (chosen as ReportStatus[]) : undefined })
          }}
        >
          {REPORT_STATUSES.map((status) => (
            <MenuItem key={status} id={status}>
              {STATUS_LABELS[status]}
            </MenuItem>
          ))}
        </FilterMenu>

        <FilterMenu
          label="Reporter"
          value={reporter?.name}
          selectionMode="single"
          selectedKeys={[search.reporterId ?? ALL]}
          onSelectionChange={(keys) => onChange({ reporterId: picked(keys) })}
        >
          <MenuItem id={ALL}>All reporters</MenuItem>
          {members.map((member) => (
            <MenuItem key={member.id} id={member.id}>
              {member.name}
            </MenuItem>
          ))}
        </FilterMenu>

        {projects && (
          <FilterMenu
            label="Project"
            value={projectValue}
            selectionMode="single"
            selectedKeys={[search.projectId ?? ALL]}
            onSelectionChange={(keys) => onChange({ projectId: picked(keys) })}
          >
            <MenuItem id={ALL}>All projects</MenuItem>
            <MenuItem id={NO_PROJECT}>No project</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} id={project.id}>
                {project.name}
              </MenuItem>
            ))}
          </FilterMenu>
        )}

        <PopoverTrigger>
          <Button intent="plain" size="sm" className="text-muted-foreground">
            {/* Filled while one of the filters inside (priority, assignee) is set. */}
            <ActiveIcon active={Boolean(search.priority || search.assigneeId)} line={RiEqualizerLine} fill={RiEqualizerFill} />
            More filters
          </Button>
          <Popover placement="bottom start" className="min-w-72">
            <div className="flex flex-col gap-3 p-3">
              <ToggleGroup
                aria-label="Priority"
                selectionMode="multiple"
                size="xs"
                selectedKeys={search.priority ?? []}
                onSelectionChange={(keys) => {
                  const current = search.priority ?? []
                  const toggled = PRIORITIES.find((priority) => keys.has(priority) !== current.includes(priority))
                  if (toggled) onChange({ priority: toggleValue(search.priority, toggled) })
                }}
                className="self-start"
              >
                {PRIORITIES.map((priority) => (
                  <ToggleGroupItem key={priority} id={priority}>
                    {PRIORITY_LABELS[priority]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Select
                aria-label="Assignee"
                selectedKey={search.assigneeId ?? ALL}
                onSelectionChange={(key) => onChange({ assigneeId: key === null || key === ALL ? undefined : String(key) })}
              >
                <SelectTrigger />
                <SelectContent items={[{ id: ALL, name: "All assignees" }, ...members]}>
                  {(member) => <SelectItem id={member.id}>{member.name}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </Popover>
        </PopoverTrigger>

        {hasFilters(search) && (
          <Button
            size="sm"
            intent="plain"
            onPress={() =>
              onChange({
                status: undefined,
                priority: undefined,
                assigneeId: undefined,
                reporterId: undefined,
                captureType: undefined,
                projectId: undefined,
                q: undefined,
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      {trailing && <div className="flex items-center gap-2">{trailing}</div>}
    </div>
  )
}

const SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "priority", label: "Priority" },
] as const

/** Newest first, oldest first or by priority; newest is the default and stays out of the URL. */
export function SortMenu({ sort, onChange }: { sort: ReportSearch["sort"]; onChange: (patch: Partial<ReportSearch>) => void }) {
  const current = SORTS.find((option) => option.id === (sort ?? "newest")) ?? SORTS[0]
  return (
    <MenuTrigger>
      <Button intent="plain" size="sm" aria-label={`Sort: ${current.label}`} className="text-muted-foreground">
        <RiArrowUpDownLine aria-hidden />
        <span className="hidden sm:inline">{current.label}</span>
      </Button>
      <Menu
        aria-label="Sort"
        selectionMode="single"
        selectedKeys={[current.id]}
        onSelectionChange={(keys) => {
          const key = picked(keys)
          onChange({ sort: key === "oldest" || key === "priority" ? key : undefined })
        }}
      >
        {SORTS.map((option) => (
          <MenuItem key={option.id} id={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  )
}

/** Cards or a table; the choice is remembered per browser by the caller. */
export function LayoutToggle({ layout, onLayout }: { layout: ReportLayout; onLayout(layout: ReportLayout): void }) {
  return (
    <ToggleGroup
      aria-label="Layout"
      size="sq-sm"
      disallowEmptySelection
      selectedKeys={[layout]}
      onSelectionChange={(keys) => {
        const [key] = keys
        if (key === "grid" || key === "list") onLayout(key)
      }}
      className="bg-background"
    >
      <ToggleGroupItem id="grid" aria-label="Grid view">
        <ActiveIcon active={layout === "grid"} line={RiLayoutGridLine} fill={RiLayoutGridFill} className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem id="list" aria-label="List view">
        {/* Remix draws the list one way only; the chosen state shows in the button's colour. */}
        <RiListUnordered aria-hidden className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
