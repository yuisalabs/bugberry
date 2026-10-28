import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import type { Db } from "../../db/client"
import { agentUpload, report } from "../../db/schema"
import { hashToken } from "../../lib/api-token"
import { gone, notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { createDispatcher } from "../../lib/trackers/dispatch"
import { trackerFactoryFor } from "../../lib/trackers/default"
import { finalizeReportUpload, uploadTargetsFor } from "./upload-flow"

/** Long enough to stop a recording, write it up and send it; short enough that a leaked link is soon worthless. */
export const AGENT_UPLOAD_TTL_MS = 15 * 60_000

/** A link for one report's files; only its hash is stored, so the database never holds a usable link. */
export async function issueAgentUpload(db: Db, reportId: string, userId: string, now = new Date()) {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  const expiresAt = new Date(now.getTime() + AGENT_UPLOAD_TTL_MS)
  await db.insert(agentUpload).values({ id: newId(), tokenHash: hashToken(token), reportId, userId, expiresAt, createdAt: now })
  return { token, expiresAt }
}

export const agentUploadLink = (appUrl: string, token: string) => `${appUrl}/api/agent-uploads/${token}`

/**
 * Where the agent recorder sends a recording: the token in the path is the only credential, as the recorder
 * never signs in. It reaches the one report it was issued for, and only until it expires or is finalized.
 */
export function agentUploadsModule(deps: AppDeps) {
  const { db } = deps
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })

  const ticketFor = async (token: string) => {
    const [ticket] = await db.select().from(agentUpload).where(eq(agentUpload.tokenHash, hashToken(token))).limit(1)
    if (!ticket) throw notFound("upload_link_unknown", "This upload link is not known. Call createUpload again.")
    return ticket
  }
  const expired = (ticket: { expiresAt: Date }) => ticket.expiresAt.getTime() <= Date.now()
  const expiredError = () => gone("upload_link_expired", "This upload link expired. Call createUpload again.")

  return new Elysia()
    .get("/agent-uploads/:token", async ({ params }) => {
      const ticket = await ticketFor(params.token)
      if (ticket.finalizedAt) throw gone("upload_link_used", "This recording was already sent with this link.")
      if (expired(ticket)) throw expiredError()
      const [row] = await db.select().from(report).where(eq(report.id, ticket.reportId)).limit(1)
      if (!row) throw notFound("report_not_found", "Report not found")
      return { reportId: row.id, number: row.number, ...(await uploadTargetsFor(deps, row)) }
    })
    .post("/agent-uploads/:token/finalize", async ({ params }) => {
      const ticket = await ticketFor(params.token)
      // A retry after a finalize that worked answers ready again; finalizeReportUpload sends nothing twice.
      if (!ticket.finalizedAt && expired(ticket)) throw expiredError()
      const result = await finalizeReportUpload(deps, dispatcher, ticket.reportId)
      if (!ticket.finalizedAt) await db.update(agentUpload).set({ finalizedAt: new Date() }).where(eq(agentUpload.id, ticket.id))
      return result
    })
}
