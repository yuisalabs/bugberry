import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { notFound } from "../../lib/errors"
import { authPlugin } from "../../plugins/auth"
import { createInvitationsService } from "../invitations/service"
import { listLiveGuestInvitations } from "../invitations/repository"
import { findProject } from "../projects/repository"
import { requireProjectRole } from "../workspaces/access"
import { deleteGuest, listProjectGuests } from "./repository"

const email = t.String({ maxLength: 320 })

/** An admin's guests of one project: invite by email, list, remove. Guests are never workspace members. */
export function guestsModule(deps: AppDeps) {
  const { db } = deps
  const invitations = createInvitationsService(deps)

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/projects/:id/guests",
      async ({ user: current, params, body }) => {
        const workspaceId = await requireProjectRole(db, current.id, params.id, "admin")
        const projectName = (await findProject(db, params.id))?.name ?? ""
        return invitations.invite(workspaceId, current, body.emails, "member", { projectId: params.id, projectName })
      },
      { auth: true, body: t.Object({ emails: t.Array(email, { minItems: 1, maxItems: 20 }) }) },
    )
    .get(
      "/projects/:id/guests",
      async ({ user: current, params }) => {
        await requireProjectRole(db, current.id, params.id, "admin")
        const [guests, pending] = await Promise.all([listProjectGuests(db, params.id), listLiveGuestInvitations(db, params.id)])
        return { guests, pending }
      },
      { auth: true },
    )
    .delete(
      "/projects/:id/guests/:userId",
      async ({ user: current, params }) => {
        await requireProjectRole(db, current.id, params.id, "admin")
        if (!(await deleteGuest(db, params.id, params.userId))) throw notFound("guest_not_found", "Guest not found")
        return { ok: true as const }
      },
      { auth: true },
    )
}
