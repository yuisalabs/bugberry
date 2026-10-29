import { emailDomain, FREE_EMAIL_DOMAINS } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { isEmailAllowed } from "../auth/policy"
import { notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { oneOf } from "../../lib/schema"
import { findLiveInvitationByHash } from "../invitations/repository"
import { accept, hashInviteToken } from "../invitations/service"
import { requireMember } from "../workspaces/access"
import { assertCanAddMembers, isWorkspaceLimited } from "../workspaces/limits"
import { addMemberIfAbsent, findMemberRole } from "../workspaces/repository"
import { hashCode, parseJoinValue } from "./join-codes"
import {
  deleteJoinRequest,
  findDomainWorkspace,
  findJoinSettings,
  findWorkspaceByShareCode,
  findWorkspaceCard,
  insertJoinRequest,
  listDomainWorkspacesNotJoined,
  listJoinRequests,
  listRequestedWorkspaces,
  takeJoinRequest,
  updateJoinSettings,
} from "./repository"
import { joinAsMember, setNewShareCode } from "./service"

/** Codes are short, so looking them up is capped per person to stop guessing. */
const LOOKUPS_PER_PERSON = 20
const LOOKUP_WINDOW_MS = 10 * 60 * 1000
const invalid = () => notFound("join_code_invalid", "This link or code doesn't work")

type Caller = { id: string; email: string }
type Resolved = { workspaceId: string; via: "invitation" | "shared"; inviterName: string | null; invitationId: string | null }

/** "7KX29QF" → "7KX-29QF", the way share codes are stored. */
const formatted = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

/** Joining a workspace by an invite link or code, a shared link or code, or an email domain. */
export function joinModule(deps: AppDeps) {
  const { db, config } = deps
  const lookups = createRateLimiter({ limit: LOOKUPS_PER_PERSON, windowMs: LOOKUP_WINDOW_MS })

  const card = async (workspaceId: string) => {
    const found = await findWorkspaceCard(db, workspaceId)
    if (!found) throw invalid()
    return found
  }
  const isMember = async (workspaceId: string, userId: string) => (await findMemberRole(db, userId, workspaceId)) !== null

  /** A live personal invitation for exactly this person. */
  const invitationFor = async (caller: Caller, by: { tokenHash: string } | { codeHash: string }) => {
    const row = await findLiveInvitationByHash(db, by)
    return row && row.email === caller.email.trim().toLowerCase() ? row : null
  }

  /** What a pasted link or code means for this person, or "doesn't work". Every lookup counts toward the cap. */
  const resolve = async (caller: Caller, value: string): Promise<Resolved> => {
    if (!lookups.consume(caller.id)) throw tooManyRequests()
    if (!isEmailAllowed(caller.email, config.allowedEmailDomains)) throw invalid()
    const parsed = parseJoinValue(value)
    if (!parsed) throw invalid()
    if (parsed.kind === "token" || parsed.kind === "code") {
      const by = parsed.kind === "token" ? { tokenHash: hashInviteToken(parsed.token) } : { codeHash: hashCode(parsed.code) }
      const invitation = await invitationFor(caller, by)
      if (invitation) {
        return { workspaceId: invitation.workspaceId, via: "invitation", inviterName: invitation.inviterName ?? "Someone", invitationId: invitation.id }
      }
      if (parsed.kind === "token") throw invalid()
    }
    const shared = await findWorkspaceByShareCode(db, formatted(parsed.code))
    if (!shared) throw invalid()
    return { workspaceId: shared, via: "shared", inviterName: null, invitationId: null }
  }

  const previewOf = async (caller: Caller, resolved: Resolved) => ({
    workspace: await card(resolved.workspaceId),
    via: resolved.via,
    inviterName: resolved.inviterName,
    alreadyMember: await isMember(resolved.workspaceId, caller.id),
  })

  /** The caller's email domain when it may be used to join or to open a workspace: not free mail, allowed here. */
  const usableDomain = (email: string): string | null => {
    const domain = emailDomain(email)
    if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null
    if (config.allowedEmailDomains.length > 0 && !config.allowedEmailDomains.includes(domain)) return null
    return domain
  }

  const accessOf = async (workspaceId: string, caller: Caller) => {
    const row = await findJoinSettings(db, workspaceId)
    if (!row) throw notFound("workspace_not_found", "Workspace not found")
    return { ...row, ownDomain: usableDomain(caller.email) }
  }

  /** The workspace if its join domain is the caller's, else "not found". */
  const domainWorkspace = async (workspaceId: string, caller: Caller) => {
    const domain = usableDomain(caller.email)
    const row = domain ? await findDomainWorkspace(db, workspaceId, domain) : null
    if (!row) throw notFound("workspace_not_found", "Workspace not found")
    return row
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/access",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return accessOf(params.id, current)
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/access",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        // Closing a way in is always allowed; opening one is not in a workspace under ACCOUNT_LIMITS.
        const opens = body.shareLink === "on" || body.shareLink === "reset" || (typeof body.joinDomain === "string" && body.joinDomain.trim() !== "")
        if (opens) await assertCanAddMembers(db, config.accountLimits, params.id)
        if (body.shareLink === "off") await updateJoinSettings(db, params.id, { shareCode: null })
        else if (body.shareLink) await setNewShareCode(db, params.id)
        const changes: { joinDomain?: string | null; joinMode?: "direct" | "approval" } = {}
        if (body.joinDomain !== undefined) {
          const domain = body.joinDomain?.trim().toLowerCase() ?? null
          if (domain !== null && domain !== usableDomain(current.email)) {
            throw unprocessable("domain_not_allowed", "Use your own work email domain")
          }
          changes.joinDomain = domain
        }
        if (body.joinMode) changes.joinMode = body.joinMode
        else if (changes.joinDomain && !(await accessOf(params.id, current)).joinMode) changes.joinMode = "approval"
        if (Object.keys(changes).length > 0) await updateJoinSettings(db, params.id, changes)
        return accessOf(params.id, current)
      },
      {
        auth: true,
        body: t.Object({
          shareLink: t.Optional(oneOf(["on", "off", "reset"] as const)),
          joinDomain: t.Optional(t.Union([t.String({ maxLength: 253 }), t.Null()])),
          joinMode: t.Optional(oneOf(["direct", "approval"] as const)),
        }),
      },
    )
    // Workspaces that take people with my email domain, other than the ones I am in.
    .get(
      "/join/domain",
      async ({ user: current }) => {
        const domain = usableDomain(current.email)
        if (!domain) return []
        const rows = await listDomainWorkspacesNotJoined(db, domain, current.id)
        // A workspace under ACCOUNT_LIMITS takes nobody new, so it isn't offered.
        const open = []
        for (const row of rows) if (!(await isWorkspaceLimited(db, config.accountLimits, row.id))) open.push(row)
        const asked = new Set(await listRequestedWorkspaces(db, current.id))
        return Promise.all(
          open.map(async (row) => ({
            workspace: await card(row.id),
            mode: row.joinMode ?? ("approval" as const),
            requested: asked.has(row.id),
          })),
        )
      },
      { auth: true },
    )
    .post(
      "/join/domain/:workspaceId",
      async ({ user: current, params }) => {
        const target = await domainWorkspace(params.workspaceId, current)
        if (await isMember(target.id, current.id)) return { workspaceId: target.id }
        await assertCanAddMembers(db, config.accountLimits, target.id, "joiner")
        if (target.joinMode === "direct") return joinAsMember(db, config.accountLimits, target.id, current.id)
        await insertJoinRequest(db, target.id, current.id)
        return { requested: true as const }
      },
      { auth: true },
    )
    .delete(
      "/join/domain/:workspaceId/request",
      async ({ user: current, params }) => {
        await deleteJoinRequest(db, params.workspaceId, current.id)
        return { ok: true }
      },
      { auth: true },
    )
    .get(
      "/workspaces/:id/join-requests",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return listJoinRequests(db, params.id)
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/join-requests/:userId/approve",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        await assertCanAddMembers(db, config.accountLimits, params.id)
        if (await takeJoinRequest(db, params.id, params.userId)) {
          await addMemberIfAbsent(db, params.id, params.userId, "member")
          return { ok: true }
        }
        // Approved already (or joined another way): nothing left to do.
        if (await isMember(params.id, params.userId)) return { ok: true }
        throw notFound("join_request_not_found", "Request not found")
      },
      { auth: true },
    )
    .delete(
      "/workspaces/:id/join-requests/:userId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        await deleteJoinRequest(db, params.id, params.userId)
        return { ok: true }
      },
      { auth: true },
    )
    .post("/join/preview", async ({ user: current, body }) => previewOf(current, await resolve(current, body.value)), {
      auth: true,
      body: t.Object({ value: t.String({ minLength: 1, maxLength: 500 }) }),
    })
    .post(
      "/join",
      async ({ user: current, body }) => {
        const resolved = await resolve(current, body.value)
        if (resolved.invitationId) return accept(db, config.accountLimits, resolved.invitationId, resolved.workspaceId, current.id)
        return joinAsMember(db, config.accountLimits, resolved.workspaceId, current.id)
      },
      { auth: true, body: t.Object({ value: t.String({ minLength: 1, maxLength: 500 }) }) },
    )
    // The /join/<code> page: the same preview, for a share code only.
    .get(
      "/join/shared/:code",
      async ({ user: current, params }) => {
        const resolved = await resolve(current, `/join/${params.code}`)
        return previewOf(current, resolved)
      },
      { auth: true },
    )
}
