import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { requireMember } from "../workspaces/access"
import { createInvitationsService } from "./service"

export type { InviteOutcome } from "./service"

export function invitationsModule(deps: AppDeps) {
  const { db } = deps
  const invitations = createInvitationsService(deps)

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/workspaces/:id/invitations",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        return invitations.invite(params.id, current, body.emails, body.role ?? "member")
      },
      {
        auth: true,
        // Checked per address in the service, after trimming, so one typo does not reject the whole list.
        body: t.Object({
          emails: t.Array(t.String({ minLength: 1, maxLength: 254 }), { minItems: 1, maxItems: 20 }),
          /** What they join as; member when left out. */
          role: t.Optional(t.UnionEnum(["member", "admin"])),
        }),
      },
    )
    .get(
      "/workspaces/:id/invitations",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return invitations.listLive(params.id)
      },
      { auth: true },
    )
    .delete(
      "/workspaces/:id/invitations/:invitationId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return invitations.revoke(params.id, params.invitationId)
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/invitations/:invitationId/resend",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return invitations.resend(params.id, params.invitationId, current)
      },
      { auth: true },
    )
    // Public: the invitation page shows what it is before the person signs in.
    .get("/invitations/:token", ({ params }) => invitations.preview(params.token))
    .post("/invitations/:token/accept", ({ user: current, params }) => invitations.acceptByToken(params.token, current), {
      auth: true,
    })
    .get("/me/invitations", ({ user: current }) => invitations.listMine(current.email), { auth: true })
    .post("/me/invitations/:id/accept", ({ user: current, params }) => invitations.acceptMine(params.id, current), {
      auth: true,
    })
}
