import { DEBUGGER_CONTENT_TYPE, FREE_EMAIL_DOMAINS } from "@bugberry/shared"
import type { AppDeps } from "../../deps"
import { findDetailRow, type ReportKey } from "./repository"

export interface PersonSummary {
  id: string
  name: string
  image: string | null
}


export async function loadReportDetail(
  { db, storage }: Pick<AppDeps, "db" | "storage">,
  key: ReportKey,
  opts: { readTtlSeconds?: number; forMember?: boolean } = {},
) {
  const row = await findDetailRow(db, key)
  if (!row) return null

  const r = row.report
  const ready = r.uploadStatus === "ready"
  const assignee: PersonSummary | null = row.assignee?.id
    ? { id: row.assignee.id, name: row.assignee.name ?? "", image: row.assignee.image ?? null }
    : null

  return {
    id: r.id,
    workspaceId: r.workspaceId,
    number: r.number,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    visibility: r.visibility,
    /** The company domain "internal" shares with; null when the reporter uses free email. */
    internalDomain: r.reporterDomain && !FREE_EMAIL_DOMAINS.has(r.reporterDomain) ? r.reporterDomain : null,
    shareSlug: r.shareSlug,
    captureType: r.captureType,
    pageUrl: r.pageUrl,
    pageTitle: r.pageTitle,
    device: r.device,
    durationMs: r.durationMs,
    mediaType: r.mediaType,
    debuggerSummary: r.debuggerSummary,
    uploadStatus: r.uploadStatus,
    /** The AI app that recorded it; null for a report made with the extension. */
    viaAgent: r.viaAgent,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    reporter: { id: row.reporter.id, name: row.reporter.name, image: row.reporter.image } satisfies PersonSummary,
    /** Only members get it; share viewers never see an address. */
    reporterEmail: opts.forMember ? row.reporter.email : undefined,
    /** "City, Country" for members only; share viewers never get it. */
    location: opts.forMember ? r.location : undefined,
    assignee,
    mediaUrl: ready
      ? await storage.getReadUrl(r.mediaKey, { contentType: r.mediaType, expiresInSeconds: opts.readTtlSeconds })
      : null,
    debuggerUrl:
      ready && r.debuggerKey
        ? await storage.getReadUrl(r.debuggerKey, {
            contentType: DEBUGGER_CONTENT_TYPE,
            expiresInSeconds: opts.readTtlSeconds,
          })
        : null,
  }
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof loadReportDetail>>>
