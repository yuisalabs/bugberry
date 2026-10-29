import type { WorkspaceLimits } from "./queries"

const kept = (count: { used: number; max: number }, noun: string) => `${count.used} of ${count.max} ${noun}${count.max === 1 ? "" : "s"}`

/** "3 of 5 screenshots · 5 of 5 recordings" for a workspace under ACCOUNT_LIMITS; null otherwise. */
export function usageText(limits: WorkspaceLimits): string | null {
  if (!limits.limited) return null
  return `${kept(limits.screenshots, "screenshot")} · ${kept(limits.recordings, "recording")}`
}

/** Invite controls show only once the workspace is known not to be limited, never while that is loading. */
export function invitesAllowed(limits: WorkspaceLimits | undefined): boolean {
  return limits?.limited === false
}
