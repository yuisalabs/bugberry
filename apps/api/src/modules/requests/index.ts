import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { resolveWorkspace } from "../workspaces/access"
import { createRequestBody, listRequestsQuery } from "./model"
import { createRequest, listWorkspaceRequests, revokeWorkspaceRequest } from "./service"

/** The members' side of request links: make one, see them, revoke one. */
export function recordingRequestsModule(deps: AppDeps) {
  const { db, config } = deps
  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/recording-requests",
      async ({ user: current, body }) =>
        createRequest({ db, appUrl: config.appUrl, uploadUrlTtlSeconds: config.uploadUrlTtlSeconds }, current, await resolveWorkspace(db, current, body.workspaceId), body),
      { auth: true, body: createRequestBody },
    )
    .get(
      "/recording-requests",
      async ({ user: current, query }) => listWorkspaceRequests({ db, uploadUrlTtlSeconds: config.uploadUrlTtlSeconds }, current, await resolveWorkspace(db, current, query.workspaceId)),
      { auth: true, query: listRequestsQuery },
    )
    .delete("/recording-requests/:id", ({ user: current, params }) => revokeWorkspaceRequest(db, current, params.id), {
      auth: true,
      params: t.Object({ id: t.String() }),
    })
}
