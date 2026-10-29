import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "./service"

export function notificationsModule(deps: AppDeps) {
  return new Elysia()
    .use(authPlugin(deps))
    .get("/notifications", ({ user: current }) => listNotifications(deps, current), { auth: true })
    .post("/notifications/read-all", ({ user: current }) => markAllNotificationsRead(deps, current), { auth: true })
    .post("/notifications/:id/read", ({ user: current, params }) => markNotificationRead(deps, current, params.id), { auth: true })
}
