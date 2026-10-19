import { emailDomain, FREE_EMAIL_DOMAINS } from "@bugberry/shared"
import { and, asc, count, eq, gt, isNull, notInArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { isEmailAllowed } from "../../auth/policy"
import { joinRequest, user, workspace, workspaceInvitation, workspaceMember } from "../../db/schema"
import { notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { oneOf } from "../../lib/schema"
import { hashInviteToken } from "../../workspaces/invitations"
import { requireMember } from "../../workspaces/access"
import { hashCode, newJoinCode, parseJoinValue } from "../../workspaces/join-codes"
import { isUniqueViolation } from "../../workspaces/slug"
import { accept } from "../invitations"

/** Codes are short, so looking them up is capped per person to stop guessing. */
const LOOKUPS_PER_PERSON = 20
const LOOKUP_WINDOW_MS = 10 * 60 * 1000
const inviter = alias(user, "inviter")
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
    const [row] = await db
      .select({ id: workspace.id, name: workspace.name, logoUrl: workspace.logoUrl })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
    if (!row) throw invalid()
    const [members] = await db.select({ value: count() }).from(workspaceMember).where(eq(workspaceMember.workspaceId, workspaceId))
    return { ...row, memberCount: members?.value ?? 0 }
  }
  const isMember = async (workspaceId: string, userId: string) =>
    (
      await db
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
        .limit(1)
    ).length > 0

  /** A live personal invitation for exactly this person. */
  const invitationFor = async (caller: Caller, match: ReturnType<typeof eq>) => {
    const [row] = await db
      .select({ id: workspaceInvitation.id, workspaceId: workspaceInvitation.workspaceId, email: workspaceInvitation.email, inviterName: inviter.name })
      .from(workspaceInvitation)
      .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
      .where(
        and(
          match,
          isNull(workspaceInvitation.acceptedAt),
          isNull(workspaceInvitation.revokedAt),
          gt(workspaceInvitation.expiresAt, new Date()),
        ),
      )
      .limit(1)
    return row && row.email === caller.email.trim().toLowerCase() ? row : null
  }
  const sharedWorkspace = async (code: string) =>
    (await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.shareCode, formatted(code))).limit(1))[0] ?? null

  /** What a pasted link or code means for this person, or "doesn't work". Every lookup counts toward the cap. */
  const resolve = async (caller: Caller, value: string): Promise<Resolved> => {
    if (!lookups.consume(caller.id)) throw tooManyRequests()
    if (!isEmailAllowed(caller.email, config.allowedEmailDomains)) throw invalid()
    const parsed = parseJoinValue(value)
    if (!parsed) throw invalid()
    if (parsed.kind === "token" || parsed.kind === "code") {
      const match =
        parsed.kind === "token" ? eq(workspaceInvitation.tokenHash, hashInviteToken(parsed.token)) : eq(workspaceInvitation.codeHash, hashCode(parsed.code))
      const invitation = await invitationFor(caller, match)
      if (invitation) {
        return { workspaceId: invitation.workspaceId, via: "invitation", inviterName: invitation.inviterName ?? "Someone", invitationId: invitation.id }
      }
      if (parsed.kind === "token") throw invalid()
    }
    const shared = await sharedWorkspace(parsed.code)
    if (!shared) throw invalid()
    return { workspaceId: shared.id, via: "shared", inviterName: null, invitationId: null }
  }

  /** Adds the person as Member (once) and makes the workspace their current one. */
  const joinAsMember = async (workspaceId: string, userId: string) => {
    await db.transaction(async (tx) => {
      await tx.insert(workspaceMember).values({ workspaceId, userId, role: "member" }).onConflictDoNothing()
      // A request still waiting would keep counting in the admins' sidebar.
      await tx.delete(joinRequest).where(and(eq(joinRequest.workspaceId, workspaceId), eq(joinRequest.userId, userId)))
      await tx.update(user).set({ lastWorkspaceId: workspaceId }).where(eq(user.id, userId))
    })
    return { workspaceId }
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
    const [row] = await db
      .select({ shareCode: workspace.shareCode, joinDomain: workspace.joinDomain, joinMode: workspace.joinMode })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
    if (!row) throw notFound("workspace_not_found", "Workspace not found")
    return { ...row, ownDomain: usableDomain(caller.email) }
  }

  /** A fresh shared code; a clash with another workspace's code just draws again. */
  const setNewShareCode = async (workspaceId: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await db.update(workspace).set({ shareCode: newJoinCode() }).where(eq(workspace.id, workspaceId))
        return
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 5) throw error
      }
    }
  }

  /** The workspace if its join domain is the caller's, else "not found". */
  const domainWorkspace = async (workspaceId: string, caller: Caller) => {
    const domain = usableDomain(caller.email)
    const [row] = domain
      ? await db
          .select({ id: workspace.id, joinMode: workspace.joinMode })
          .from(workspace)
          .where(and(eq(workspace.id, workspaceId), eq(workspace.joinDomain, domain)))
          .limit(1)
      : []
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
        if (body.shareLink === "off") await db.update(workspace).set({ shareCode: null }).where(eq(workspace.id, params.id))
        else if (body.shareLink) await setNewShareCode(params.id)
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
        if (Object.keys(changes).length > 0) await db.update(workspace).set(changes).where(eq(workspace.id, params.id))
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
        const mine = db.select({ id: workspaceMember.workspaceId }).from(workspaceMember).where(eq(workspaceMember.userId, current.id))
        const rows = await db
          .select({ id: workspace.id, joinMode: workspace.joinMode })
          .from(workspace)
          .where(and(eq(workspace.joinDomain, domain), notInArray(workspace.id, mine)))
          .orderBy(asc(workspace.name))
        const asked = new Set(
          (await db.select({ id: joinRequest.workspaceId }).from(joinRequest).where(eq(joinRequest.userId, current.id))).map((row) => row.id),
        )
        return Promise.all(
          rows.map(async (row) => ({
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
        if (target.joinMode === "direct") return joinAsMember(target.id, current.id)
        await db.insert(joinRequest).values({ workspaceId: target.id, userId: current.id }).onConflictDoNothing()
        return { requested: true as const }
      },
      { auth: true },
    )
    .delete(
      "/join/domain/:workspaceId/request",
      async ({ user: current, params }) => {
        await db.delete(joinRequest).where(and(eq(joinRequest.workspaceId, params.workspaceId), eq(joinRequest.userId, current.id)))
        return { ok: true }
      },
      { auth: true },
    )
    .get(
      "/workspaces/:id/join-requests",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return db
          .select({ user: { id: user.id, name: user.name, email: user.email, image: user.image }, createdAt: joinRequest.createdAt })
          .from(joinRequest)
          .innerJoin(user, eq(user.id, joinRequest.userId))
          .where(eq(joinRequest.workspaceId, params.id))
          .orderBy(asc(joinRequest.createdAt))
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/join-requests/:userId/approve",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        const removed = await db
          .delete(joinRequest)
          .where(and(eq(joinRequest.workspaceId, params.id), eq(joinRequest.userId, params.userId)))
          .returning({ userId: joinRequest.userId })
        if (removed.length > 0) {
          await db.insert(workspaceMember).values({ workspaceId: params.id, userId: params.userId, role: "member" }).onConflictDoNothing()
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
        await db.delete(joinRequest).where(and(eq(joinRequest.workspaceId, params.id), eq(joinRequest.userId, params.userId)))
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
        if (resolved.invitationId) return accept(db, resolved.invitationId, resolved.workspaceId, current.id)
        return joinAsMember(resolved.workspaceId, current.id)
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
