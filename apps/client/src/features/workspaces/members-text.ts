import type { WorkspaceRole } from "@bugberry/shared"
import { formatAgo } from "../../lib/format"
import type { PendingInvitation } from "./queries"

const DAY = 24 * 60 * 60 * 1000

/** What each role may do, as the side card lists it. */
export const ROLE_RIGHTS: Array<{ role: { role: WorkspaceRole; owner: boolean }; text: string }> = [
  { role: { role: "admin", owner: true }, text: "Delete workspace, everything an Admin can do." },
  { role: { role: "admin", owner: false }, text: "Manage members, projects and integrations." },
  { role: { role: "member", owner: false }, text: "Record, view and comment on reports." },
]

/** "3 people in Cuy Workspaces · 1 pending invite". */
export function membersSummary(people: number, workspaceName: string, pendingInvites: number): string {
  const head = `${people} ${people === 1 ? "person" : "people"} in ${workspaceName}`
  return pendingInvites > 0 ? `${head} · ${pendingInvites} pending ${pendingInvites === 1 ? "invite" : "invites"}` : head
}

/** "Sent 2d ago", and "· expires in 2 days" once the end is three days off or nearer. */
export function inviteMeta(invitation: Pick<PendingInvitation, "sentAt" | "expiresAt">, now: number): string {
  const sent = `Sent ${formatAgo(invitation.sentAt, now)}`
  const left = new Date(invitation.expiresAt).getTime() - now
  if (left > 3 * DAY) return sent
  const days = Math.floor(left / DAY)
  return `${sent} · ${days < 1 ? "expires today" : `expires in ${days} ${days === 1 ? "day" : "days"}`}`
}
