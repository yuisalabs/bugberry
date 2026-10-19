import type { NavigationVia, ViewAction } from "./debugger-events"

export interface ActionSentence {
  text: string
  /** The value was hidden before upload (a password or card field). */
  masked: boolean
  /** The sentence split around the element, which the Actions tab shows in monospace. */
  parts: { before: string; target: string | null; after: string }
  /** A rage click: the person pressed the same thing again and again. */
  frustration: boolean
}

const VIA_TEXT: Record<NavigationVia, string> = {
  load: "on page load",
  reload: "via a page reload",
  history: "via History API",
  "back-forward": "via back/forward",
}

/** "via a page reload": how a navigation happened; empty when unknown (older reports, hash changes). */
export function viaText(via: NavigationVia | null): string {
  return via ? VIA_TEXT[via] : ""
}

/** A value the capture hid before upload: all "•". */
export const isMaskedValue = (value: string | null) => value !== null && value.length > 0 && /^•+$/.test(value)

function sentence(before: string, target: string | null, after = "", masked = false, frustration = false): ActionSentence {
  const text = [before, target, after].filter(Boolean).join(" ")
  return { text, masked, parts: { before, target, after }, frustration }
}

/** The vertical position from a scroll's "x,y" value. */
function scrollTop(value: string | null): number | null {
  const y = Number(value?.split(",")[1])
  return value && Number.isFinite(y) && y >= 0 ? Math.round(y) : null
}

/** One recorded action as a sentence: "Clicked button#pay", "Typed into input “dana@…”". */
export function actionSentence(action: ViewAction): ActionSentence {
  switch (action.type) {
    case "click":
      return sentence("Clicked", action.target)
    case "input": {
      const masked = isMaskedValue(action.value)
      const value = action.value === null ? "" : masked ? action.value : `“${action.value}”`
      return sentence("Typed into", action.target, value, masked)
    }
    case "submit":
      return sentence("Submitted", action.target)
    case "navigate":
      return sentence("Navigated to", action.url ?? action.target, viaText(action.via))
    case "scroll": {
      const y = scrollTop(action.value)
      return sentence(y === null ? "Scrolled the page" : `Scrolled page to ${y} px`, null)
    }
    case "rage-click":
      return sentence(`Rage click ×${action.value ?? "3"} on`, action.target, "", false, true)
    case "visibility":
      return sentence(action.value === "hidden" ? "Tab became hidden" : "Tab became visible", null)
    default:
      return sentence("Other action", action.target)
  }
}

export type ActionFilter = "all" | "clicks" | "inputs" | "navigation" | "tab"

export function matchesActionFilter(action: ViewAction, filter: ActionFilter): boolean {
  switch (filter) {
    case "clicks":
      return action.type === "click" || action.type === "rage-click"
    case "inputs":
      return action.type === "input"
    case "navigation":
      return action.type === "navigate"
    case "tab":
      return action.type === "visibility"
    default:
      return true
  }
}

export function actionCounts(actions: readonly ViewAction[]): Record<ActionFilter, number> {
  const filters: ActionFilter[] = ["all", "clicks", "inputs", "navigation", "tab"]
  return Object.fromEntries(
    filters.map((filter) => [filter, actions.filter((action) => matchesActionFilter(action, filter)).length]),
  ) as Record<ActionFilter, number>
}
