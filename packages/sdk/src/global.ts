export const GLOBAL_KEY = "__bugberry__"
export const QUEUE_MAX = 50

export interface SdkEntry {
  t: number
  level: "info" | "warn" | "error"
  message: string
  data?: unknown
  stack?: string
}

/**
 * Shared by every copy of the SDK in the page and by the extension's capture script, which replaces
 * `push` while it runs. The shape is duplicated in packages/capture/src/hooks/sdk.ts on purpose.
 */
export interface BugBerryGlobal {
  v: 1
  metadata: (() => unknown) | null
  queue: SdkEntry[]
  push: (entry: SdkEntry) => void
}

function isGlobal(value: unknown): value is BugBerryGlobal {
  return typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1 && Array.isArray((value as { queue?: unknown }).queue)
}

/** The shared object on `host`, created with the queueing `push` when missing; null without a host or when it cannot be made. */
export function sdkGlobal(host: object | undefined): BugBerryGlobal | null {
  try {
    if (typeof host !== "object" || host === null) return null
    const slot = host as Record<string, unknown>
    const existing = slot[GLOBAL_KEY]
    if (isGlobal(existing)) return existing
    const queue: SdkEntry[] = []
    const created: BugBerryGlobal = {
      v: 1,
      metadata: null,
      queue,
      push(entry) {
        queue.push(entry)
        while (queue.length > QUEUE_MAX) queue.shift()
      },
    }
    slot[GLOBAL_KEY] = created
    return slot[GLOBAL_KEY] === created ? created : null
  } catch {
    return null
  }
}
