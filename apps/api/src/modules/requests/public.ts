import { MAX_SENDER_NAME_LENGTH, REQUEST_MAX_MEDIA_BYTES, REQUEST_MAX_SECONDS, tooLong } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { payloadTooLarge, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { findCurrentUser } from "../account/repository"
import { issueAgentUpload } from "../reports/agent-uploads"
import { deviceSchema } from "../reports/model"
import { createReportUpload } from "../reports/upload-flow"
import { clientIp } from "../share/index"
import { hashToken } from "../tokens/token"
import { workspaceLimits } from "../workspaces/limits"
import { countRequestUses, findRequestForSender } from "./repository"
import { pageAddress, requestStatus, usesCountedSince } from "./service"
import { requestUnavailable } from "./unavailable"

const LOOKUPS_PER_MINUTE = 30
const STARTS_PER_HOUR = 10

const startBody = t.Object({
  // Generous here: trimming and the one-line rule are checked below, with their own code.
  name: t.String({ maxLength: 200 }),
  email: t.Optional(t.String({ maxLength: 200, format: "email" })),
  description: t.Optional(t.String({ maxLength: 5000 })),
  captureType: t.UnionEnum(["video", "screenshot"]),
  mediaSize: t.Integer({ minimum: 1 }),
  thumbnailSize: t.Optional(t.Integer({ minimum: 1 })),
  durationMs: t.Optional(t.Integer({ minimum: 0 })),
  pageUrl: t.Optional(t.String({ maxLength: 2048 })),
  device: deviceSchema,
})

/** The sender's name as stored: trimmed, 1 to 80 characters, one line. */
function senderName(input: string): string {
  const name = input.trim()
  if (!name || name.length > MAX_SENDER_NAME_LENGTH || /[\r\n]/.test(name)) {
    throw unprocessable("sender_name_invalid", `Your name is 1 to ${MAX_SENDER_NAME_LENGTH} characters on one line`)
  }
  return name
}

/** Members open the sender's email as a mailto link, so a character that would add a field to it is refused. */
function senderEmail(input: string | undefined): string | null {
  const email = input?.trim()
  if (!email) return null
  if (/[?&#%\s]/.test(email)) throw unprocessable("sender_email_invalid", "That email address can't be used")
  return email
}

/**
 * The side of a request link that someone without an account uses. No session is read: the token is the only
 * credential, and every dead link answers alike, naming nothing of the workspace.
 */
export function publicRequestsModule(deps: AppDeps) {
  const { db, config } = deps
  const lookups = createRateLimiter({ limit: LOOKUPS_PER_MINUTE, windowMs: 60_000 })
  const starts = createRateLimiter({ limit: STARTS_PER_HOUR, windowMs: 3_600_000 })

  /** The link and its maker as a caller, or the one "unavailable" answer. */
  const liveLink = async (token: string) => {
    const found = await findRequestForSender(db, hashToken(token))
    if (!found || !found.makerActive || !found.makerIsMember) throw requestUnavailable()
    const since = usesCountedSince(config.uploadUrlTtlSeconds)
    if (requestStatus(found.request, await countRequestUses(db, found.request.id, since)) !== "live") throw requestUnavailable()
    const maker = await findCurrentUser(db, found.request.createdById)
    if (!maker) throw requestUnavailable()
    return { ...found, maker, since }
  }

  /** Five minutes, or less where the workspace's own recordings are shorter. */
  const maxSecondsIn = async (workspaceId: string) => {
    const limits = await workspaceLimits(db, config, workspaceId)
    return limits.limited ? Math.min(REQUEST_MAX_SECONDS, Math.floor(limits.maxRecordingMs / 1000)) : REQUEST_MAX_SECONDS
  }
  /** 95 MB, or less where the server's MAX_UPLOAD_MB is lower. */
  const maxBytes = Math.min(REQUEST_MAX_MEDIA_BYTES, config.maxUploadBytes)

  return new Elysia()
    .get(
      "/recording-requests/by-token/:token",
      async ({ params, request, server }) => {
        if (!lookups.consume(clientIp(request, server, config.proxyHops))) throw tooManyRequests()
        const link = await liveLink(params.token)
        return {
          workspaceName: link.workspaceName,
          requesterName: link.makerName,
          note: link.request.note,
          pageUrl: link.request.pageUrl,
          maxSeconds: await maxSecondsIn(link.request.workspaceId),
          maxBytes,
        }
      },
      { params: t.Object({ token: t.String({ maxLength: 200 }) }) },
    )
    .post(
      "/recording-requests/by-token/:token/uploads",
      async ({ params, body, request, server }) => {
        if (!starts.consume(clientIp(request, server, config.proxyHops))) throw tooManyRequests()
        const link = await liveLink(params.token)
        const name = senderName(body.name)
        const email = senderEmail(body.email)
        const pageUrl = pageAddress(body.pageUrl) ?? link.request.pageUrl ?? "about:blank"
        if (body.mediaSize > maxBytes) throw payloadTooLarge(`A recording can be at most ${Math.floor(maxBytes / 1024 / 1024)} MB`)
        const maxSeconds = await maxSecondsIn(link.request.workspaceId)
        // The time limit stops a recording a moment late, never early: the same slack as every recording limit.
        if (body.captureType === "video" && tooLong(body.durationMs ?? 0, maxSeconds * 1000)) {
          throw unprocessable("recording_too_long", `A recording can be at most ${maxSeconds / 60} minutes`)
        }
        const created = await createReportUpload(
          deps,
          link.maker,
          {
            workspaceId: link.request.workspaceId,
            projectId: link.request.projectId,
            description: body.description,
            visibility: "workspace",
            captureType: body.captureType,
            mediaSize: body.mediaSize,
            multipart: false,
            thumbnailSize: body.thumbnailSize,
            pageUrl,
            device: body.device,
            durationMs: body.durationMs,
            debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
          },
          { sender: { requestId: link.request.id, name, email, maxUses: link.request.maxUses, usesSince: link.since } },
        )
        const ticket = await issueAgentUpload(db, created.reportId, link.maker.id)
        return { uploadToken: ticket.token, mediaUpload: created.mediaUpload, thumbnailUpload: created.thumbnailUpload }
      },
      { params: t.Object({ token: t.String({ maxLength: 200 }) }), body: startBody },
    )
}
