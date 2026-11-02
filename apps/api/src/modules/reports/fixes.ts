import { checkFixUrl, MAX_FIX_URL_LENGTH, MAX_FIXES_PER_REPORT } from "@bugberry/shared"
import { type Db, withTransaction } from "../../db/client"
import type { AppDeps } from "../../deps"
import { createEmailSender } from "../../lib/email/sender"
import { notFound, unprocessable } from "../../lib/errors"
import type { CurrentUser } from "../../plugins/auth"
import { recordActivity } from "../activity/repository"
import { findReportHeading, userEmails } from "../comments/repository"
import { createCommentsService } from "../comments/service"
import { memberRole, requireReportMember } from "../workspaces/access"
import { loadReportDetail, type ReportDetail } from "./detail"
import { type FixView, toFixViews } from "./fix-view"
import {
  deleteFix,
  findReadyReportByRef,
  findReportStatus,
  insertFix,
  insertResolvedNotification,
  listReportFixes,
  lockReport,
  markResolved,
} from "./repository"
import { resolvedEmail } from "./resolved-email"

/** A report the caller works on that has finished uploading; anything else is "not found", as on the report page. */
async function requireReadyReport(db: Db, userId: string, reportId: string) {
  const target = await requireReportMember(db, userId, reportId)
  if (!(await findReadyReportByRef(db, { id: reportId }))) throw notFound("report_not_found", "Report not found")
  return target
}

function cleanLinks(urls: string[]): string[] {
  if (urls.length === 0) throw unprocessable("fix_url_invalid", "Add at least one fix link")
  return urls.map((value) => {
    const checked = checkFixUrl(value)
    if ("url" in checked) return checked.url
    if (checked.problem === "too_long") throw unprocessable("fix_url_too_long", `A link can be at most ${MAX_FIX_URL_LENGTH} characters`)
    throw unprocessable("fix_url_invalid", "Enter an http or https link")
  })
}

/** Adds what isn't on the report yet, each with its activity line; a link already there is left alone. */
async function addLinks(db: Db, caller: CurrentUser, reportId: string, urls: string[], viaAgent: string | null): Promise<void> {
  // Two calls at nine links would each see room for one more without the lock.
  await lockReport(db, reportId)
  const present = new Set((await listReportFixes(db, reportId)).map((row) => row.url))
  for (const url of urls) {
    if (present.has(url)) continue
    if (present.size >= MAX_FIXES_PER_REPORT) {
      throw unprocessable("fix_limit", `A report can have at most ${MAX_FIXES_PER_REPORT} fix links`)
    }
    const row = await insertFix(db, { reportId, url, addedBy: caller.id, viaAgent })
    present.add(url)
    if (row) await recordActivity(db, { reportId, kind: "fix", detail: { action: "added", url }, actorId: caller.id, viaAgent })
  }
}

/** Any member may add a fix link; adding one that is already there changes nothing. */
export async function addFix(
  { db }: Pick<AppDeps, "db">,
  caller: CurrentUser,
  reportId: string,
  url: string,
  opts: { viaAgent?: string } = {},
): Promise<FixView[]> {
  await requireReadyReport(db, caller.id, reportId)
  const [clean] = cleanLinks([url])
  await withTransaction(db, () => addLinks(db, caller, reportId, [clean as string], opts.viaAgent ?? null))
  return toFixViews(await listReportFixes(db, reportId))
}

export async function removeFix({ db }: Pick<AppDeps, "db">, caller: CurrentUser, reportId: string, fixId: string): Promise<FixView[]> {
  await requireReadyReport(db, caller.id, reportId)
  await withTransaction(db, async () => {
    const removed = await deleteFix(db, reportId, fixId)
    if (!removed) throw notFound("fix_not_found", "Fix link not found")
    await recordActivity(db, { reportId, kind: "fix", detail: { action: "removed", url: removed.url }, actorId: caller.id, viaAgent: null })
  })
  return toFixViews(await listReportFixes(db, reportId))
}

/** Sent after the work is saved; a failed email is only logged. */
function emailReporter(
  deps: AppDeps,
  input: { reporterId: string; reportId: string; actorName: string; links: string[]; note: string | null; viaAgent: string | null },
): void {
  const sender = deps.email ?? (deps.config.email ? createEmailSender(deps.config.email) : null)
  if (!sender) return
  const task = (async () => {
    const heading = await findReportHeading(deps.db, input.reportId)
    const [person] = await userEmails(deps.db, [input.reporterId])
    if (!heading || !person) return
    const email = resolvedEmail({
      actorName: input.actorName,
      reportNumber: heading.number,
      reportTitle: heading.title,
      links: input.links,
      note: input.note,
      url: `${deps.config.appUrl}/app/r/${input.reportId}`,
      viaAgent: input.viaAgent,
    })
    await sender.send({ to: person.email, ...email })
  })().catch((error) => console.error("resolved email failed", error))
  deps.background?.(task)
}

/**
 * Resolves the report with where it was fixed. The reporter hears about it once, in the bell and by email, unless
 * they did it themselves, left the workspace, or the report was already resolved.
 */
export async function resolveReport(
  deps: AppDeps,
  caller: CurrentUser,
  reportId: string,
  input: { links: string[]; note?: string },
  opts: { viaAgent?: string } = {},
): Promise<{ detail: ReportDetail; links: FixView[]; notified: boolean }> {
  const { db } = deps
  const target = await requireReadyReport(db, caller.id, reportId)
  const urls = cleanLinks(input.links)
  const viaAgent = opts.viaAgent ?? null

  const notified = await withTransaction(db, async () => {
    await addLinks(db, caller, reportId, urls, viaAgent)
    const before = await findReportStatus(db, reportId)
    if (!(await markResolved(db, reportId))) return false
    await recordActivity(db, { reportId, kind: "status", detail: { from: before, to: "resolved" }, actorId: caller.id, viaAgent })
    const tell = target.reporterId !== caller.id && (await memberRole(db, target.reporterId, target.workspaceId)) !== null
    if (tell) await insertResolvedNotification(db, { userId: target.reporterId, reportId, actorId: caller.id, viaAgent })
    return tell
  })

  // After the commit: the comments service starts its mention emails in the background, which must not run on a closed transaction.
  const note = input.note?.trim() || null
  const links = toFixViews(await listReportFixes(db, reportId))
  // Before the note: a retry finds the report resolved and won't notify again, so a failed note must not cost the email.
  if (notified) {
    emailReporter(deps, {
      reporterId: target.reporterId,
      reportId,
      actorName: caller.name,
      links: links.map((link) => link.url),
      note,
      viaAgent,
    })
  }
  if (note) {
    // The resolved notification already carries the note, so the reporter gets no mention for it as well.
    await createCommentsService(deps).create(caller, reportId, note, {
      viaAgent: opts.viaAgent,
      quietFor: notified ? [target.reporterId] : [],
    })
  }
  const detail = await loadReportDetail(deps, { id: reportId }, { forMember: true })
  if (!detail) throw notFound("report_not_found", "Report not found")
  return { detail, links, notified }
}
