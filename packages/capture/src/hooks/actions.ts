import { describeElement, fieldValue } from "../describe"
import type { ActionEvent, Emit, Uninstall } from "../events"
import { RAGE_CLICK_GAP_MS, RAGE_CLICK_MIN_PRESSES, SCROLL_THROTTLE_MS } from "../limits"
import { createPatcher, installOrUndo } from "../patch"
import { safely } from "../safe"
import { redactUrl } from "../sanitize"

export interface ActionHost {
  document: Document
  history: History
  location: { href: string }
  scrollX: number
  scrollY: number
  /** Says whether this document was opened, reloaded or reached with back/forward. */
  performance?: { getEntriesByType(type: string): unknown[] }
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

type Via = ActionEvent["via"]

function loadVia(host: ActionHost): Via {
  const type = (host.performance?.getEntriesByType("navigation")[0] as { type?: unknown } | undefined)?.type
  if (type === "reload") return "reload"
  if (type === "back_forward") return "back-forward"
  return "load"
}

function elementOf(target: EventTarget | null): Element | null {
  if (!target) return null
  if (typeof (target as Element).tagName === "string") return target as Element
  return (target as Node).parentElement ?? null
}

/**
 * `retained` says whether an emitted event is still in the buffer. Typing and replaceState update the
 * event they emitted earlier; once that event has been dropped, they start a new one instead.
 */
export function installActionHooks(
  host: ActionHost,
  emit: Emit,
  now: () => number,
  retained: (event: ActionEvent) => boolean = () => true,
): Uninstall {
  const doc = host.document
  let typing: { element: Element; event: ActionEvent } | null = null
  /** The latest navigation, while no other action has happened since. */
  let lastNavigation: { event: ActionEvent; byReplace: boolean } | null = null
  let lastScrollAt = Number.NEGATIVE_INFINITY
  /** Presses in a row on one element; from the third on they are one rage click that keeps counting. */
  let presses: { element: Element; count: number; last: number; event: ActionEvent | null } | null = null

  const record = (event: ActionEvent) => {
    typing = null
    lastNavigation = null
    emit(event)
  }

  /**
   * One URL change can fire popstate and hashchange both, and some routers call replaceState on every
   * scroll. A repeat of the same URL is skipped, and back-to-back replaceState calls update one event.
   */
  const navigate = (change: "replace" | "other", via: Via) =>
    safely(() => {
      const url = redactUrl(host.location.href)
      if (lastNavigation?.event.url === url) return
      if (change === "replace" && lastNavigation?.byReplace && retained(lastNavigation.event)) {
        lastNavigation.event.url = url
        return
      }
      const event: ActionEvent = { kind: "action", t: now(), type: "navigate", url, ...(via ? { via } : {}) }
      record(event)
      lastNavigation = { event, byReplace: change === "replace" }
    })
  const onPopState = () => navigate("other", "back-forward")
  const onHashChange = () => navigate("other", undefined)

  // pointerdown, not click: a disabled button never fires click, and that is where people rage.
  const onPointerDown = (event: Event) =>
    safely(() => {
      const element = elementOf(event.target)
      if (!element) return
      const t = now()
      if (!presses || presses.element !== element || t - presses.last > RAGE_CLICK_GAP_MS) {
        presses = { element, count: 1, last: t, event: null }
        return
      }
      presses.count += 1
      presses.last = t
      if (presses.count < RAGE_CLICK_MIN_PRESSES) return
      if (presses.event && retained(presses.event)) {
        presses.event.value = String(presses.count)
        return
      }
      presses.event = { kind: "action", t, type: "rage-click", target: describeElement(element), value: String(presses.count) }
      record(presses.event)
    })

  const onVisibility = () =>
    safely(() => record({ kind: "action", t: now(), type: "visibility", value: doc.visibilityState }))

  const onClick = (event: Event) =>
    safely(() => {
      const element = elementOf(event.target)
      if (element) record({ kind: "action", t: now(), type: "click", target: describeElement(element) })
    })

  // `input` fires per keystroke; consecutive input/change events on one field update a single action.
  const onInput = (event: Event) =>
    safely(() => {
      const element = elementOf(event.target)
      if (!element) return
      const value = fieldValue(element)
      if (typing?.element === element && retained(typing.event)) {
        if (value === undefined) delete typing.event.value
        else typing.event.value = value
        return
      }
      const action: ActionEvent = {
        kind: "action",
        t: now(),
        type: "input",
        target: describeElement(element),
        ...(value !== undefined ? { value } : {}),
      }
      emit(action)
      typing = { element, event: action }
    })

  const onSubmit = (event: Event) =>
    safely(() => {
      const element = elementOf(event.target)
      if (element) record({ kind: "action", t: now(), type: "submit", target: describeElement(element) })
    })

  const onScroll = () =>
    safely(() => {
      const t = now()
      if (t - lastScrollAt < SCROLL_THROTTLE_MS) return
      lastScrollAt = t
      record({ kind: "action", t, type: "scroll", value: `${Math.round(host.scrollX)},${Math.round(host.scrollY)}` })
    })

  const history = host.history
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState
  const patcher = createPatcher()
  const pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = originalPushState.apply(this, args)
    navigate("other", "history")
    return result
  }
  const replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    const result = originalReplaceState.apply(this, args)
    navigate("replace", "history")
    return result
  }

  const uninstall = () => {
    doc.removeEventListener("click", onClick, true)
    doc.removeEventListener("input", onInput, true)
    doc.removeEventListener("change", onInput, true)
    doc.removeEventListener("submit", onSubmit, true)
    doc.removeEventListener("pointerdown", onPointerDown, true)
    doc.removeEventListener("visibilitychange", onVisibility)
    host.removeEventListener("popstate", onPopState)
    host.removeEventListener("hashchange", onHashChange)
    host.removeEventListener("scroll", onScroll)
    patcher.restore()
  }

  installOrUndo(() => {
    patcher.replace(history, "pushState", pushState)
    patcher.replace(history, "replaceState", replaceState)
    doc.addEventListener("click", onClick, true)
    doc.addEventListener("input", onInput, true)
    doc.addEventListener("change", onInput, true)
    doc.addEventListener("submit", onSubmit, true)
    doc.addEventListener("pointerdown", onPointerDown, true)
    doc.addEventListener("visibilitychange", onVisibility)
    host.addEventListener("popstate", onPopState)
    host.addEventListener("hashchange", onHashChange)
    host.addEventListener("scroll", onScroll, { passive: true })
  }, uninstall)
  navigate("other", loadVia(host))

  return uninstall
}
