import { RiCameraLine, RiPlayFill } from "@remixicon/react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@bugberry/ui/table"
import type { ReportListItem } from "../lib/api"
import { formatLength, formatRelative } from "../lib/format"
import { PRIORITY_LABELS } from "../lib/labels"
import { initialsOf } from "../lib/people"
import { StatusBadge } from "./StatusBadge"
import { useReportsFrom } from "./ReportCard"
import type { Project } from "../features/projects/queries"
import type { Member } from "../features/workspaces/queries"

const head = "px-3 py-2 text-left text-xs font-semibold text-muted-foreground first:ps-3 last:pe-3 sm:first:ps-3 sm:last:pe-3"
const cell = "px-3 py-2.5 align-middle first:ps-3 last:pe-3 sm:first:ps-3 sm:last:pe-3"
/**
 * Columns fold away as space runs out, so the title never gets squeezed: phones and tablets keep title,
 * status and created; laptops add the picture and reporter; wide screens add priority, assignee and project.
 */
const large = "hidden lg:table-cell"
const wide = "hidden xl:table-cell"

function Person({ person }: { person: { name: string; image: string | null } }) {
  return (
    <span className="flex items-center gap-1.5">
      <Avatar src={person.image} initials={initialsOf(person.name)} alt="" size="xs" className="shrink-0" />
      <span className="truncate">{person.name}</span>
    </span>
  )
}

/** Reports as Intent Table rows. `rowLink` renders the title as a link, so the table renders without a router in tests. */
export function ReportTableBody({
  items,
  members,
  projects,
  now,
  rowLink,
  onRow,
}: {
  items: readonly ReportListItem[]
  members: readonly Member[]
  projects?: readonly Project[]
  now: number
  rowLink(item: ReportListItem): ReactNode
  onRow?(item: ReportListItem): void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <Table aria-label="Reports" bleed className="mx-0 whitespace-normal" onRowAction={(key) => {
        const item = items.find((candidate) => candidate.id === key)
        if (item) onRow?.(item)
      }}>
        <TableHeader className="bg-muted/50">
          <TableColumn aria-label="Preview" className={`${head} ${large} w-20`} />
          <TableColumn isRowHeader className={head}>
            Report
          </TableColumn>
          <TableColumn className={`${head} w-28`}>Status</TableColumn>
          <TableColumn className={`${head} ${wide} w-20`}>Priority</TableColumn>
          <TableColumn className={`${head} ${large} w-36`}>Reporter</TableColumn>
          <TableColumn className={`${head} ${wide} w-36`}>Assignee</TableColumn>
          <TableColumn className={`${head} ${wide} w-32`}>Project</TableColumn>
          <TableColumn className={`${head} w-28`}>Created</TableColumn>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const assignee = members.find((member) => member.id === item.assigneeId)
            const project = projects?.find((candidate) => candidate.id === item.projectId)
            return (
              <TableRow key={item.id} id={item.id} textValue={item.title} className="cursor-pointer hover:bg-muted/40">
                <TableCell className={`${cell} ${large}`}>
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-9 w-14 rounded-md object-cover object-top ring-1 ring-border" />
                  ) : (
                    <span className="block h-9 w-14 rounded-md bg-muted ring-1 ring-border" />
                  )}
                </TableCell>
                <TableCell className={cell}>
                  <span className="block truncate font-medium text-foreground">{rowLink(item)}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                    {item.captureType === "video" ? (
                      <>
                        BB-{item.number} · <RiPlayFill aria-hidden className="size-3" /> {formatLength(item.durationMs ?? 0)}
                      </>
                    ) : (
                      <>
                        BB-{item.number} · <RiCameraLine aria-hidden className="size-3" /> Screenshot
                      </>
                    )}
                  </span>
                </TableCell>
                <TableCell className={cell}>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className={`${cell} ${wide}`}>{PRIORITY_LABELS[item.priority]}</TableCell>
                <TableCell className={`${cell} ${large}`}>
                  <Person person={item.reporter} />
                </TableCell>
                <TableCell className={`${cell} ${wide}`}>
                  {assignee ? <Person person={assignee} /> : <span className="text-muted-foreground">Unassigned</span>}
                </TableCell>
                <TableCell className={`${cell} ${wide} truncate`}>
                  {project?.name ?? <span className="text-muted-foreground">No project</span>}
                </TableCell>
                <TableCell className={`${cell} text-xs text-muted-foreground`}>{formatRelative(item.createdAt, now)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function ReportTable(props: Omit<Parameters<typeof ReportTableBody>[0], "rowLink" | "onRow">) {
  const navigate = useNavigate()
  const from = useReportsFrom()
  return (
    <ReportTableBody
      {...props}
      onRow={(item) =>
        void navigate({ to: "/app/r/$reportId", params: { reportId: item.id }, state: (previous) => ({ ...previous, reportsFrom: from }) })
      }
      rowLink={(item) => (
        <Link
          to="/app/r/$reportId"
          params={{ reportId: item.id }}
          state={(previous) => ({ ...previous, reportsFrom: from })}
          onClick={(event) => event.stopPropagation()}
          className="hover:underline"
        >
          {item.title}
        </Link>
      )}
    />
  )
}
