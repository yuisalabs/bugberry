import type { IntegrationProvider } from "@bugberry/shared"
import type { ReportPatch, ReportTrackers } from "./api"

/** A member who opened a share link belongs on the full report page; anyone else stays. */
export function sharePageTarget(share: {
  id: string
  viewerIsMember: boolean
}): { to: "/app/r/$reportId"; params: { reportId: string } } | null {
  return share.viewerIsMember ? { to: "/app/r/$reportId", params: { reportId: share.id } } : null
}

/** "All reports" leads to the report's project when it has one, else to every report. */
export function backTarget(
  report: { projectId: string | null },
  projects: ReadonlyArray<{ id: string; slug: string }>,
): { to: "/app" } | { to: "/app/p/$projectSlug"; params: { projectSlug: string } } {
  const project = report.projectId ? projects.find((item) => item.id === report.projectId) : undefined
  return project ? { to: "/app/p/$projectSlug", params: { projectSlug: project.slug } } : { to: "/app" }
}

export interface SentIssue {
  /** Null when the issue came through a tracker the report's project no longer has. */
  provider: IntegrationProvider | null
  externalId: string
  externalUrl: string | null
}

/** The issues this report already has in trackers, for the chips under the title. */
export function sentIssues(data: ReportTrackers | undefined): SentIssue[] {
  if (!data) return []
  return data.links.flatMap((link) => {
    const integration = data.integrations.find((item) => item.id === link.integrationId)
    if (!link.externalId) return []
    return [{ provider: link.provider ?? integration?.provider ?? null, externalId: link.externalId, externalUrl: link.externalUrl }]
  })
}

type Person = { id: string; name: string; image: string | null }

/**
 * The report as it will be once the server saves `patch`, shown at once so a field doesn't jump back to its
 * old value while the change is on its way. An assignee who isn't in `members` stays as it was until the
 * server's answer replaces the whole report.
 */
export function withPatch<T extends { assignee: Person | null }>(
  report: T,
  patch: ReportPatch,
  members: ReadonlyArray<Person> | undefined,
): T {
  const { assigneeId, ...rest } = patch
  const next = { ...report, ...rest }
  if (assigneeId === undefined) return next
  if (assigneeId === null) return { ...next, assignee: null }
  const member = members?.find((person) => person.id === assigneeId)
  return member ? { ...next, assignee: { id: member.id, name: member.name, image: member.image } } : next
}
