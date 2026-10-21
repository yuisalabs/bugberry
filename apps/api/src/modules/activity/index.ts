import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { listActivity } from "./service"

export function activityModule(deps: AppDeps) {
  return new Elysia()
    .use(authPlugin(deps))
    .get("/reports/:id/activity", ({ user: current, params }) => listActivity(deps, current, params.id), { auth: true })
}
