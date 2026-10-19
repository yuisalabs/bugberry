import { PRIORITIES, type Priority, REPORT_STATUSES, type ReportStatus } from "@bugberry/shared"
import { RiAccountCircleLine, RiFlagLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Label } from "@bugberry/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import type { Member, ReportDetail, ReportPatch } from "../../lib/api"
import { PRIORITY_ICON_STYLES, PRIORITY_LABELS, STATUS_DOT_STYLES, STATUS_LABELS } from "../../lib/labels"

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
}: {
  label: string
  icon: ReactNode
  value: string
  disabled: boolean
  onChange(value: string): void
  options: Array<{ id: string; label: string }>
}) {
  return (
    <Select
      selectedKey={value}
      isDisabled={disabled}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      className="w-auto *:data-[slot=label]:font-medium [&>[data-slot=label]+[data-slot=control]]:mt-1"
    >
      <Label className="text-xs text-muted-foreground sm:text-xs">{label}</Label>
      <SelectTrigger prefix={icon} className="h-8 min-w-28 bg-background py-0 sm:py-0" />
      <SelectContent items={options}>{(option) => <SelectItem id={option.id}>{option.label}</SelectItem>}</SelectContent>
    </Select>
  )
}

/** Status, priority and assignee, each saved as soon as it changes. */
export function ReportFields({
  report,
  members,
  disabled,
  onChange,
}: {
  report: Pick<ReportDetail, "status" | "priority" | "assignee">
  members: Member[] | undefined
  disabled: boolean
  onChange(patch: ReportPatch): void
}) {
  const people = members ?? []
  // Until the members load, the current assignee still shows and the select stays locked.
  const listed =
    report.assignee && !people.some((member) => member.id === report.assignee?.id) ? [report.assignee, ...people] : people
  return (
    <div className="flex flex-wrap items-end gap-3">
      <CompactSelect
        label="Status"
        icon={<span className={`block size-2 rounded-full ${STATUS_DOT_STYLES[report.status]}`} />}
        value={report.status}
        disabled={disabled}
        onChange={(status) => onChange({ status: status as ReportStatus })}
        options={REPORT_STATUSES.map((status) => ({ id: status, label: STATUS_LABELS[status] }))}
      />
      <CompactSelect
        label="Priority"
        icon={<RiFlagLine className={`size-3.5 ${PRIORITY_ICON_STYLES[report.priority]}`} />}
        value={report.priority}
        disabled={disabled}
        onChange={(priority) => onChange({ priority: priority as Priority })}
        options={PRIORITIES.map((priority) => ({ id: priority, label: PRIORITY_LABELS[priority] }))}
      />
      <CompactSelect
        label="Assignee"
        icon={<RiAccountCircleLine className="size-4 text-muted-foreground" />}
        value={report.assignee?.id ?? NOBODY}
        disabled={disabled || members === undefined}
        onChange={(assigneeId) => onChange({ assigneeId: assigneeId === NOBODY ? null : assigneeId })}
        options={[
          { id: NOBODY, label: members === undefined && !report.assignee ? "Loading members…" : "Unassigned" },
          ...listed.map((member) => ({ id: member.id, label: member.name })),
        ]}
      />
    </div>
  )
}
