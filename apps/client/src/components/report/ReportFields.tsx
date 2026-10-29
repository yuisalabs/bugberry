import { PRIORITIES, type Priority, REPORT_STATUSES, type ReportStatus } from "@bugberry/shared"
import { RiAccountCircleLine, RiFlagLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Label } from "@bugberry/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import type { ReportDetail, ReportPatch } from "../../lib/api"
import { PRIORITY_ICON_STYLES, PRIORITY_LABELS, STATUS_DOT_STYLES, STATUS_LABELS } from "../../lib/labels"
import type { Member } from "../../features/workspaces/queries"

/** "Unassigned" in the assignee list; a list key can't be empty. */
const NOBODY = "__nobody"

/** A small Intent Select with an icon on the left, as in the report page's field row. */
function CompactSelect({
  label,
  icon,
  value,
  disabled,
  onChange,
  options,
  rows = false,
}: {
  label: string
  icon: ReactNode
  value: string
  disabled?: boolean
  onChange(value: string): void
  options: Array<{ id: string; label: string }>
  /** The sidebar's Properties: the label on the left and a full-width select beside it, on every screen. */
  rows?: boolean
}) {
  return (
    <Select
      selectedKey={value}
      isDisabled={disabled}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      className={
        rows
          ? "grid w-full grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 [&>[data-slot=label]+[data-slot=control]]:mt-0"
          : // Phones: one row of the fields card, the label on the left and the value on the right.
            "w-auto *:data-[slot=label]:font-medium [&>[data-slot=label]+[data-slot=control]]:mt-1 max-md:flex max-md:w-full max-md:items-center max-md:justify-between max-md:gap-3 max-md:px-4 max-md:py-2.5 max-md:*:data-[slot=control]:w-auto max-md:*:data-[slot=label]:font-normal max-md:[&>[data-slot=label]+[data-slot=control]]:mt-0"
      }
    >
      <Label className={rows ? "text-sm font-normal text-muted-foreground" : "text-sm text-muted-foreground sm:text-sm md:text-xs"}>{label}</Label>
      <SelectTrigger
        prefix={icon}
        className={
          rows
            ? "h-9 bg-background py-0 font-medium sm:py-0"
            : "h-8 min-w-28 bg-background py-0 sm:py-0 max-md:min-w-0 max-md:border-transparent max-md:bg-transparent max-md:font-medium"
        }
      />
      <SelectContent items={options}>{(option) => <SelectItem id={option.id}>{option.label}</SelectItem>}</SelectContent>
    </Select>
  )
}

/** Status, priority and assignee, each saved as soon as it changes; they stay usable while a change saves. */
export function ReportFields({
  report,
  members,
  onChange,
  rows = false,
}: {
  report: Pick<ReportDetail, "status" | "priority" | "assignee">
  members: Member[] | undefined
  onChange(patch: ReportPatch): void
  /** One field per row, label on the left: the report sidebar's Properties. */
  rows?: boolean
}) {
  const people = members ?? []
  // Until the members load, the current assignee still shows and the select stays locked.
  const listed =
    report.assignee && !people.some((member) => member.id === report.assignee?.id) ? [report.assignee, ...people] : people
  return (
    <div
      className={
        rows
          ? "flex flex-col gap-2.5"
          : "flex flex-col divide-y divide-border rounded-xl border border-border bg-background md:flex-row md:flex-wrap md:items-end md:gap-3 md:divide-y-0 md:rounded-none md:border-0 md:bg-transparent"
      }
    >
      <CompactSelect
        label="Status"
        icon={<span className={`block size-2 rounded-full ${STATUS_DOT_STYLES[report.status]}`} />}
        value={report.status}
        onChange={(status) => onChange({ status: status as ReportStatus })}
        options={REPORT_STATUSES.map((status) => ({ id: status, label: STATUS_LABELS[status] }))}
        rows={rows}
      />
      <CompactSelect
        label="Priority"
        icon={<RiFlagLine className={`size-3.5 ${PRIORITY_ICON_STYLES[report.priority]}`} />}
        value={report.priority}
        onChange={(priority) => onChange({ priority: priority as Priority })}
        options={PRIORITIES.map((priority) => ({ id: priority, label: PRIORITY_LABELS[priority] }))}
        rows={rows}
      />
      <CompactSelect
        label="Assignee"
        icon={<RiAccountCircleLine className="size-4 text-muted-foreground" />}
        value={report.assignee?.id ?? NOBODY}
        disabled={members === undefined}
        onChange={(assigneeId) => onChange({ assigneeId: assigneeId === NOBODY ? null : assigneeId })}
        options={[
          { id: NOBODY, label: members === undefined && !report.assignee ? "Loading members…" : "Unassigned" },
          ...listed.map((member) => ({ id: member.id, label: member.name })),
        ]}
        rows={rows}
      />
    </div>
  )
}
