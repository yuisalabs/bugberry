import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Link } from "@bugberry/ui/link"
import type { RecordingRequest } from "./queries"

const DAY_MS = 86_400_000

const STATUS_TEXT: Record<Exclude<RecordingRequest["status"], "live">, string> = {
  expired: "Expired",
  used_up: "Used up",
  revoked: "Revoked",
}

function usage(item: RecordingRequest, now: number): string {
  if (item.status !== "live") return STATUS_TEXT[item.status]
  const days = Math.max(1, Math.ceil((new Date(item.expiresAt).getTime() - now) / DAY_MS))
  return `${item.used} of ${item.maxUses} used · expires in ${days} ${days === 1 ? "day" : "days"}`
}

/** A workspace's request links: how much each was used, what came through it, and Revoke for its maker or an admin. */
export function RequestLinkListView({
  items,
  projects,
  now,
  me,
  isAdmin,
  onRevoke,
}: {
  items: readonly RecordingRequest[]
  projects: readonly { id: string; name: string }[]
  now: number
  me: string
  isAdmin: boolean
  onRevoke(id: string): void
}) {
  const { confirm, dialog } = useConfirm()
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No request links yet.</p>
  const revoke = async (item: RecordingRequest) => {
    const yes = await confirm({
      title: "Revoke this link?",
      description: "Nobody can record with it any more. Recordings already sent stay.",
      confirmLabel: "Revoke link",
    })
    if (yes) onRevoke(item.id)
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {dialog}
      {items.map((item) => {
        const project = projects.find((candidate) => candidate.id === item.projectId)?.name ?? "No project"
        return (
          <li key={item.id} className="flex items-start justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate text-sm font-medium text-foreground">{item.note || project}</p>
              <p className="text-xs text-muted-foreground">
                {project} · by {item.createdBy.name}
              </p>
              <p className="text-xs text-foreground">{usage(item, now)}</p>
              {item.reports.length > 0 && (
                <p className="flex flex-wrap gap-2 text-xs">
                  {item.reports.map((sent) => (
                    <Link key={sent.id} href={`/app/r/${sent.id}`} className="font-medium text-primary hover:underline">
                      BB-{sent.number}
                    </Link>
                  ))}
                </p>
              )}
            </div>
            {item.status === "live" && (item.createdBy.id === me || isAdmin) && (
              <Button intent="outline" size="xs" aria-label={`Revoke ${item.note || "link"}`} onPress={() => void revoke(item)}>
                Revoke
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
