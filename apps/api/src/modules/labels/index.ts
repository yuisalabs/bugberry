import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { resolveWorkspace } from "../workspaces/access"
import { createLabelBody, listLabelsQuery, updateLabelBody } from "./model"
import { listLabels } from "./repository"
import { changeLabel, createLabel, removeLabel } from "./service"

export function labelsModule(deps: AppDeps) {
  const { db } = deps
  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/labels",
      async ({ user: current, query }) => listLabels(db, await resolveWorkspace(db, current, query.workspaceId)),
      { auth: true, query: listLabelsQuery },
    )
    .post(
      "/labels",
      async ({ user: current, body }) =>
        createLabel(db, current, await resolveWorkspace(db, current, body.workspaceId), { name: body.name, color: body.color }),
      { auth: true, body: createLabelBody },
    )
    .patch("/labels/:id", async ({ user: current, params, body }) => changeLabel(db, current, params.id, body), {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: updateLabelBody,
    })
    .delete(
      "/labels/:id",
      async ({ user: current, params }) => {
        await removeLabel(db, current, params.id)
        return { ok: true as const }
      },
      { auth: true, params: t.Object({ id: t.String() }) },
    )
}
