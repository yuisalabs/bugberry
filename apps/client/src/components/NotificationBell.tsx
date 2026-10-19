import { RiNotification3Line } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button as AriaButton, Dialog, DialogTrigger } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Popover } from "@bugberry/ui/popover"
import { useNow } from "../hooks/useNow"
import type { Notifications } from "../lib/api"
import { api } from "../lib/client"
import { formatRelative } from "../lib/format"
import { queries } from "../lib/queries"

type Item = Notifications["items"][number]

/** The red unread count on the bell; nothing when everything is read. */
export function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  )
}

/** The list inside the bell: newest mentions first, unread ones marked. Everything is plain text. */
export function NotificationBellView({
  data,
  now,
  onOpen,
  onReadAll,
}: {
  data: Notifications
  now: number
  onOpen(item: Item): void
  onReadAll(): void
}) {
  return (
    <div className="flex w-[min(22rem,calc(100vw-24px))] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">Mentions</p>
        {data.unreadCount > 0 && (
          <AriaButton onPress={onReadAll} className="text-xs font-semibold text-primary hover:underline">
            Mark all as read
          </AriaButton>
        )}
      </div>
      {data.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No mentions yet</p>
      ) : (
        <ul className="max-h-96 overflow-y-auto">
          {data.items.map((item) => (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <AriaButton
                onPress={() => onOpen(item)}
                className={`flex w-full gap-2.5 px-4 py-2.5 text-left hover:bg-muted ${item.read ? "" : "bg-primary-subtle/40"}`}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-primary"}`}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-foreground">
                    <span className="font-semibold">{item.actor?.name ?? "Someone"}</span> mentioned you in{" "}
                    <span className="font-semibold">BB-{item.report.number}</span> · {item.report.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{item.snippet}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelative(item.createdAt, now)}
                    {!item.read && <span className="sr-only"> · Unread</span>}
                  </span>
                </span>
              </AriaButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The bell for @mentions: polls for new ones, and opening one lands on that comment. */
export function NotificationBell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const notifications = useQuery(queries.notifications())
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.notifications().queryKey })
  const read = useMutation({ mutationFn: (id: string) => api.readNotification(id), onSettled: refresh })
  const readAll = useMutation({ mutationFn: () => api.readAllNotifications(), onSettled: refresh })
  const count = notifications.data?.unreadCount ?? 0

  const openItem = (item: Item) => {
    setOpen(false)
    if (!item.read) read.mutate(item.id)
    void navigate({ to: "/app/r/$reportId", params: { reportId: item.report.id }, hash: `comment-${item.commentId}` })
  }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button intent="plain" size="sq-sm" aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}>
        <RiNotification3Line aria-hidden />
        <NotificationBadge count={count} />
      </Button>
      <Popover placement="bottom end" className="max-w-none">
        <Dialog aria-label="Notifications" className="outline-hidden">
          {notifications.data ? (
            <NotificationBellView data={notifications.data} now={now} onOpen={openItem} onReadAll={() => readAll.mutate()} />
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {notifications.isError ? "Couldn't load notifications" : "Loading…"}
            </p>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
