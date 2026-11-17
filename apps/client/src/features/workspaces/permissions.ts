import type { AccessRole } from "@bugberry/shared"

/** What someone may do in the dashboard. A guest of a project reads its reports and comments, nothing more. */
export interface Permissions {
  /** Status, priority, assignee, title, project, labels, delete, trackers, fixes, share settings. */
  editReports: boolean
  /** Activity lines, fix links, the reporter's email and city. */
  seeTeamDetails: boolean
  /** The member list, and filters that name people. */
  seePeople: boolean
  /** Integrations, AI settings, onboarding, New report. */
  useWorkspaceTools: boolean
}

export function permissionsOf(role: AccessRole | null): Permissions {
  const member = role === "admin" || role === "member"
  return { editReports: member, seeTeamDetails: member, seePeople: member, useWorkspaceTools: member }
}
