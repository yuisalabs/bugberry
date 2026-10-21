import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiEditLine,
  RiFlag2Line,
  RiRobot2Line,
  RiShareForwardLine,
  RiUserLine,
} from "@remixicon/react"
import { useNow } from "../../hooks/useNow"
import type { Activity } from "../../lib/api"
import { activitySentence } from "../../lib/comment-feed"
import { formatDateTime, formatRelative } from "../../lib/format"

const ICONS = {
  status: RiCheckboxCircleLine,
  priority: RiFlag2Line,
  assignee: RiUserLine,
  title: RiEditLine,
  tracker: RiShareForwardLine,
  agent_read: RiRobot2Line,
  created: RiAddLine,
} as const

/** Something that happened to the report, as one muted line: "Ana via Claude Code read this report · 25m ago". */
export function ActivityLine({ item }: { item: Activity }) {
  const now = useNow()
  const Icon = ICONS[item.kind as keyof typeof ICONS] ?? RiEditLine
  const sentence = activitySentence(item)
  return (
    <div className="flex items-center gap-2.5 py-0.5 pl-1.5 text-sm text-muted-foreground">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className="size-3.5" />
      </span>
      <p className="min-w-0">
        {item.actor ? (
          <>
            <span className="font-medium text-foreground">{item.actor.name}</span>
            {item.viaAgent ? ` via ${item.viaAgent}` : ""} {sentence}
          </>
        ) : (
          `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
        )}
        <time dateTime={new Date(item.at).toISOString()} title={formatDateTime(item.at)} className="text-xs">
          {" · "}
          {formatRelative(item.at, now)}
        </time>
      </p>
    </div>
  )
}
