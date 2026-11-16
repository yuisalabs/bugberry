import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { resolveWorkspace } from "../workspaces/access"
import { createLabelBody, listLabelsQuery, setReportLabelsBody, updateLabelBody } from "./model"
import { listLabels } from "./repository"
import { changeLabel, createLabel, removeLabel, setReportLabels } from "./service"

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
    .put("/reports/:id/labels", ({ user: current, params, body }) => setReportLabels(deps, current, params.id, body.labelIds), {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: setReportLabelsBody,
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
