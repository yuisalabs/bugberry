import { emailDomain, FREE_EMAIL_DOMAINS } from "@bugberry/shared"
import type { AccountLimits } from "../../config"
import { type Db, withTransaction } from "../../db/client"
import type { AppDeps } from "../../deps"
import { notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { updateUser } from "../account/repository"
import { isEmailAllowed } from "../auth/policy"
import { findLiveInvitationByHash } from "../invitations/repository"
import { accept, hashInviteToken } from "../invitations/service"
import { assertCanAddMembers, isWorkspaceLimited } from "../workspaces/limits"
import { addMemberIfAbsent, findMemberRole } from "../workspaces/repository"
import { isUniqueViolation } from "../workspaces/slug"
import { hashCode, newJoinCode, parseJoinValue } from "./join-codes"
import type { accessBody } from "./model"
import {
  deleteJoinRequest,
  findDomainWorkspace,
  findJoinSettings,
  findWorkspaceByShareCode,
  findWorkspaceCard,
  insertJoinRequest,
  listDomainWorkspacesNotJoined,
  listRequestedWorkspaces,
  takeJoinRequest,
  updateJoinSettings,
} from "./repository"

/** Codes are short, so looking them up is capped per person to stop guessing. */
const LOOKUPS_PER_PERSON = 20
const LOOKUP_WINDOW_MS = 10 * 60 * 1000
const invalid = () => notFound("join_code_invalid", "This link or code doesn't work")

type Caller = { id: string; email: string }
type Resolved = { workspaceId: string; via: "invitation" | "shared"; inviterName: string | null; invitationId: string | null }

/** "7KX29QF" → "7KX-29QF", the way share codes are stored. */
const formatted = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

/** Adds the person as Member (once) and makes the workspace their current one. */
export async function joinAsMember(db: Db, limits: AccountLimits | null, workspaceId: string, userId: string) {
  await withTransaction(db, async () => {
    await assertCanAddMembers(db, limits, workspaceId, "joiner")
    await addMemberIfAbsent(db, workspaceId, userId, "member")
    // A request still waiting would keep counting in the admins' sidebar.
    await deleteJoinRequest(db, workspaceId, userId)
    await updateUser(db, userId, { lastWorkspaceId: workspaceId })
  })
  return { workspaceId }
}

/** A fresh shared code; a clash with another workspace's code just draws again. */
export async function setNewShareCode(db: Db, workspaceId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await updateJoinSettings(db, workspaceId, { shareCode: newJoinCode() })
      return
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error
    }
  }
}

/** Joining a workspace by an invite link or code, a shared link or code, or an email domain. */
export function createJoinService(deps: Pick<AppDeps, "config" | "db">) {
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

  return {
    access: accessOf,

    async changeAccess(workspaceId: string, caller: Caller, body: typeof accessBody.static) {
      // Closing a way in is always allowed; opening one is not in a workspace under ACCOUNT_LIMITS.
      const opens = body.shareLink === "on" || body.shareLink === "reset" || (typeof body.joinDomain === "string" && body.joinDomain.trim() !== "")
      if (opens) await assertCanAddMembers(db, config.accountLimits, workspaceId)
      if (body.shareLink === "off") await updateJoinSettings(db, workspaceId, { shareCode: null })
      else if (body.shareLink) await setNewShareCode(db, workspaceId)
      const changes: { joinDomain?: string | null; joinMode?: "direct" | "approval" } = {}
      if (body.joinDomain !== undefined) {
        const domain = body.joinDomain?.trim().toLowerCase() ?? null
        if (domain !== null && domain !== usableDomain(caller.email)) {
          throw unprocessable("domain_not_allowed", "Use your own work email domain")
        }
        changes.joinDomain = domain
      }
      if (body.joinMode) changes.joinMode = body.joinMode
      else if (changes.joinDomain && !(await accessOf(workspaceId, caller)).joinMode) changes.joinMode = "approval"
      if (Object.keys(changes).length > 0) await updateJoinSettings(db, workspaceId, changes)
      return accessOf(workspaceId, caller)
    },

    /** Workspaces that take people with the caller's email domain, other than the ones they are in. */
    async domainWorkspaces(caller: Caller) {
      const domain = usableDomain(caller.email)
      if (!domain) return []
      const rows = await listDomainWorkspacesNotJoined(db, domain, caller.id)
      // A workspace under ACCOUNT_LIMITS takes nobody new, so it isn't offered.
      const open = []
      for (const row of rows) if (!(await isWorkspaceLimited(db, config.accountLimits, row.id))) open.push(row)
      const asked = new Set(await listRequestedWorkspaces(db, caller.id))
      return Promise.all(
        open.map(async (row) => ({
          workspace: await card(row.id),
          mode: row.joinMode ?? ("approval" as const),
          requested: asked.has(row.id),
        })),
      )
    },

    /** Joins at once in a direct-join workspace, else asks its admins; only for the workspace's own email domain. */
    async joinByDomain(workspaceId: string, caller: Caller) {
      const domain = usableDomain(caller.email)
      const target = domain ? await findDomainWorkspace(db, workspaceId, domain) : null
      if (!target) throw notFound("workspace_not_found", "Workspace not found")
      if (await isMember(target.id, caller.id)) return { workspaceId: target.id }
      await assertCanAddMembers(db, config.accountLimits, target.id, "joiner")
      if (target.joinMode === "direct") return joinAsMember(db, config.accountLimits, target.id, caller.id)
      await insertJoinRequest(db, target.id, caller.id)
      return { requested: true as const }
    },

    async approve(workspaceId: string, userId: string) {
      await assertCanAddMembers(db, config.accountLimits, workspaceId)
      if (await takeJoinRequest(db, workspaceId, userId)) {
        await addMemberIfAbsent(db, workspaceId, userId, "member")
        return { ok: true }
      }
      // Approved already (or joined another way): nothing left to do.
      if (await isMember(workspaceId, userId)) return { ok: true }
      throw notFound("join_request_not_found", "Request not found")
    },

    async preview(caller: Caller, value: string) {
      return previewOf(caller, await resolve(caller, value))
    },

    async join(caller: Caller, value: string) {
      const resolved = await resolve(caller, value)
      if (resolved.invitationId) return accept(db, config.accountLimits, resolved.invitationId, resolved.workspaceId, caller.id)
      return joinAsMember(db, config.accountLimits, resolved.workspaceId, caller.id)
    },
  }
}
