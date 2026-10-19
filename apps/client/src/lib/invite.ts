import type { InvitationInfo } from "./api"

export type InviteState = "sign-in" | "join" | "wrong-account" | "unavailable"

/** What the invitation page offers: sign in, join, switch accounts, or nothing (gone). */
export function inviteView(invite: InvitationInfo | "not_found", me: { email: string } | null): InviteState {
  if (invite === "not_found" || invite.status !== "pending") return "unavailable"
  if (!me) return "sign-in"
  return me.email.trim().toLowerCase() === invite.email ? "join" : "wrong-account"
}
