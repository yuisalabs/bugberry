import { callSite } from "../callsite"
import { type Emit, SDK_LEVELS, type SdkEvent, type SdkLevel, type Uninstall } from "../events"
import { MAX_ARG_CHARS, MAX_STACK_CHARS } from "../limits"
import { createPatcher } from "../patch"
import { safely } from "../safe"
import { truncate } from "../sanitize"
import { stringifyArg } from "../serialize"

export const SDK_GLOBAL_KEY = "__bugberry__"
const SDK_QUEUE_MAX = 50

/** The object @bugberry/sdk writes to; duplicated from packages/sdk/src/global.ts so neither depends on the other. */
export interface SdkGlobal {
  v: 1
  metadata: unknown
  queue: unknown[]
  push: (entry: unknown) => void
}

export type SdkHost = { [SDK_GLOBAL_KEY]?: unknown }

/** The page's object when it has the expected shape, else null. */
export function sdkGlobalOf(host: SdkHost): SdkGlobal | null {
  const value = host[SDK_GLOBAL_KEY]
  if (typeof value !== "object" || value === null) return null
  const candidate = value as Partial<SdkGlobal>
  return candidate.v === 1 && Array.isArray(candidate.queue) ? (candidate as SdkGlobal) : null
}

function queueingPush(global: SdkGlobal): (entry: unknown) => void {
  return (entry) => {
    global.queue.push(entry)
    while (global.queue.length > SDK_QUEUE_MAX) global.queue.shift()
  }
}

/** Entries come from page code, so only their shape is trusted, never their types. */
function toSdkEvent(raw: unknown, now: () => number): SdkEvent | null {
  if (typeof raw !== "object" || raw === null) return null
  const entry = raw as Record<string, unknown>
  const event: SdkEvent = {
    kind: "sdk",
    t: typeof entry.t === "number" && Number.isFinite(entry.t) ? entry.t : now(),
    level: SDK_LEVELS.includes(entry.level as SdkLevel) ? (entry.level as SdkLevel) : "info",
    message: truncate(String(entry.message), MAX_ARG_CHARS),
  }
  if (entry.data !== undefined) event.data = stringifyArg(entry.data)
  if (typeof entry.stack === "string") {
    event.stack = truncate(entry.stack, MAX_STACK_CHARS)
    const source = callSite(entry.stack)
    if (source) event.source = source
  }
  return event
}

/**
 * Creates or takes over the SDK global: drains its queue into `emit`, then routes every `push` there.
 * Uninstall puts the queueing `push` back. Throws when the host has an unusable value there.
 */
export function installSdkHook(host: SdkHost, emit: Emit, now: () => number): Uninstall {
  let global = sdkGlobalOf(host)
  if (!global) {
    if (host[SDK_GLOBAL_KEY] !== undefined) throw new Error("the SDK global is not usable")
    const created: SdkGlobal = { v: 1, metadata: null, queue: [], push: () => {} }
    created.push = queueingPush(created)
    host[SDK_GLOBAL_KEY] = created
    if (host[SDK_GLOBAL_KEY] !== created) throw new Error("the SDK global could not be created")
    global = created
  }

  const patcher = createPatcher()
  patcher.replace(global, "push", (entry: unknown) =>
    safely(() => {
      const event = toSdkEvent(entry, now)
      if (event) emit(event)
    }),
  )
  const queued = global.queue.splice(0)
  for (const entry of queued) safely(() => {
    const event = toSdkEvent(entry, now)
    if (event) emit(event)
  })
  return patcher.restore
}
