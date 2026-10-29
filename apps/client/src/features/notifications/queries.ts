import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

/** How often the bell asks for new mentions; it also asks when the window regains focus. */
export const NOTIFICATIONS_REFRESH_MS = 30_000

export const notifications = () => unwrap(eden.api.notifications.get())
export const readNotification = (id: string) => unwrap(eden.api.notifications({ id }).read.post())
export const readAllNotifications = () => unwrap(eden.api.notifications["read-all"].post())

export type Notifications = Awaited<ReturnType<typeof notifications>>

export const notificationQueries = {
  notifications: () =>
    queryOptions({
      queryKey: qk.notifications,
      queryFn: () => notifications(),
      refetchInterval: NOTIFICATIONS_REFRESH_MS,
      refetchOnWindowFocus: true,
    }),
}

export function useReadNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => readNotification(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  })
}

export function useReadAllNotifications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => readAllNotifications(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  })
}
