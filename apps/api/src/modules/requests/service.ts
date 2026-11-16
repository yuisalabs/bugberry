import { MAX_LIVE_REQUESTS_PER_WORKSPACE } from "@bugberry/shared"
import { type Db, withTransaction } from "../../db/client"
import { forbidden, notFound, unprocessable } from "../../lib/errors"
import { AGENT_UPLOAD_TTL_MS } from "../reports/agent-uploads"
import { newId } from "../../lib/ids"
import { projectInWorkspace } from "../projects/repository"
import { hashToken } from "../tokens/token"
import { memberRole, requireMember } from "../workspaces/access"
import { countLiveRequests, findRequest, insertRequest, listRequests, lockWorkspaceRequests, reportsOfRequests, revokeRequest } from "./repository"

export type RequestStatus = "live" | "expired" | "used_up" | "revoked"

const DAY_MS = 86_400_000

/** The oldest upload that still holds a use: its ticket, then the upload links signed just before it expired. */
export const usesCountedSince = (uploadUrlTtlSeconds: number, now = new Date()) =>
  new Date(now.getTime() - AGENT_UPLOAD_TTL_MS - uploadUrlTtlSeconds * 1000)

export const requestUrl = (appUrl: string, token: string) => `${appUrl}/request/${token}`

/** Revoked wins, then expired, then used up. */
export function requestStatus(
  row: { expiresAt: Date; revokedAt: Date | null; maxUses: number },
  used: number,
  now = new Date(),
): RequestStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt.getTime() <= now.getTime()) return "expired"
  if (used >= row.maxUses) return "used_up"
  return "live"
}

/** The sender is shown this address as a link, so only an http or https page is kept. */
export function pageAddress(input: string | undefined): string | null {
  const value = input?.trim()
  if (!value) return null
  let url: URL | null = null
  try {
    url = new URL(value)
  } catch {
    url = null
  }
  if (url && (url.protocol === "http:" || url.protocol === "https:")) return url.toString()
  throw unprocessable("page_url_invalid", "The page address must start with http:// or https://")
}

export async function createRequest(
  { db, appUrl, uploadUrlTtlSeconds }: { db: Db; appUrl: string; uploadUrlTtlSeconds: number },
  caller: { id: string },
  workspaceId: string,
  input: { projectId?: string | null; note?: string; pageUrl?: string; expiresInDays: number; maxUses: number },
  now = new Date(),
) {
  await requireMember(db, caller.id, workspaceId)
  const pageUrl = pageAddress(input.pageUrl)
  if (input.projectId && !(await projectInWorkspace(db, input.projectId, workspaceId))) {
    throw unprocessable("project_not_found", "Project not found in this workspace")
  }
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  const row = await withTransaction(db, async () => {
    await lockWorkspaceRequests(db, workspaceId)
    if ((await countLiveRequests(db, workspaceId, now, usesCountedSince(uploadUrlTtlSeconds, now))) >= MAX_LIVE_REQUESTS_PER_WORKSPACE) {
      throw unprocessable("request_limit", `A workspace can have at most ${MAX_LIVE_REQUESTS_PER_WORKSPACE} live request links`)
    }
    return insertRequest(db, {
      id: newId(),
      workspaceId,
      projectId: input.projectId ?? null,
      createdById: caller.id,
      tokenHash: hashToken(token),
      note: input.note?.trim() ?? "",
      pageUrl,
      maxUses: input.maxUses,
      expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
      createdAt: now,
    })
  })
  return { id: row.id, url: requestUrl(appUrl, token), expiresAt: row.expiresAt, maxUses: row.maxUses }
}

/** A workspace's links for its members; never their token or address. */
export async function listWorkspaceRequests(
  { db, uploadUrlTtlSeconds }: { db: Db; uploadUrlTtlSeconds: number },
  caller: { id: string },
  workspaceId: string,
  now = new Date(),
) {
  await requireMember(db, caller.id, workspaceId)
  const rows = await listRequests(db, workspaceId)
  const reports = await reportsOfRequests(db, rows.map((row) => row.request.id), usesCountedSince(uploadUrlTtlSeconds, now))
  return rows.map(({ request, createdBy }) => {
    const own = reports.filter((item) => item.requestId === request.id)
    return {
      id: request.id,
      projectId: request.projectId,
      note: request.note,
      pageUrl: request.pageUrl,
      createdBy,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      maxUses: request.maxUses,
      used: own.length,
      status: requestStatus(request, own.length, now),
      reports: own.filter((item) => item.uploadStatus === "ready").map(({ id, number }) => ({ id, number })),
    }
  })
}

/** Its maker or an admin; an outsider gets the same 404 as a link that doesn't exist. */
export async function revokeWorkspaceRequest(db: Db, caller: { id: string }, id: string) {
  const row = await findRequest(db, id)
  const role = row ? await memberRole(db, caller.id, row.workspaceId) : null
  if (!row || !role) throw notFound("request_not_found", "Request link not found")
  if (row.createdById !== caller.id && role !== "admin") throw forbidden("Only whoever made this link or an admin can revoke it")
  await revokeRequest(db, id)
  return { ok: true as const }
}
