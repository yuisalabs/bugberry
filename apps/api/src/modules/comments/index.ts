import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { createCommentsService } from "./service"

const commentBody = t.Object({ body: t.String({ minLength: 1, maxLength: 5000 }) })
/** A new comment; `replyTo` answers another comment and files this one in its thread. */
const newComment = t.Object({
  body: t.String({ minLength: 1, maxLength: 5000 }),
  replyTo: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
})

export function commentsModule(deps: AppDeps) {
  const comments = createCommentsService(deps)
  return new Elysia()
    .use(authPlugin(deps))
    .get("/reports/:id/comments", ({ user: current, params }) => comments.list(current, params.id), { auth: true })
    .post(
      "/reports/:id/comments",
      ({ user: current, params, body }) => comments.create(current, params.id, body.body, { replyTo: body.replyTo }),
      { auth: true, body: newComment },
    )
    .patch("/comments/:id", ({ user: current, params, body }) => comments.edit(current, params.id, body.body), {
      auth: true,
      body: commentBody,
    })
    .delete("/comments/:id", ({ user: current, params }) => comments.remove(current, params.id), { auth: true })
}
