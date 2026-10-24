import type { Visibility } from "@bugberry/shared"

export interface AccessOption {
  value: Visibility
  title: string
  description: string
}

/** Who can open the share link, most private first. The company level needs a company domain. */
export function accessOptions(internalDomain: string | null): AccessOption[] {
  const options: AccessOption[] = [
    { value: "workspace", title: "Workspace members only", description: "They sign in to BugBerry first" },
  ]
  if (internalDomain) {
    options.push({ value: "internal", title: `Anyone at @${internalDomain}`, description: "Signs in with a company email" })
  }
  options.push({ value: "public", title: "Anyone with the link", description: "No sign-in needed to watch" })
  return options
}

/** The line under "Link copied". */
export function copiedDescription(visibility: Visibility, internalDomain: string | null): string {
  if (visibility === "workspace") return "Only workspace members can open it"
  if (visibility === "internal") return `Anyone at ${internalDomain ? `@${internalDomain}` : "your company"} can open it`
  return "Anyone with the link can open it"
}

/**
 * What the Share popover shows while a change is on its way: the access being saved at once (the server
 * answers a moment later), with nothing faded or locked, so the choice doesn't jump back and forth. Only a
 * link reset holds the buttons; a failed save shows the report's own access again.
 */
export function sharePopoverState(
  saved: Visibility,
  change: { saving: Visibility | undefined; resetting: boolean },
): { visibility: Visibility; busy: boolean } {
  return { visibility: change.saving ?? saved, busy: change.resetting }
}
