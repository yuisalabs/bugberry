import { type SdkEntry, sdkGlobal } from "./global"
import { createStackBudget, withoutSdkFrame } from "./stack"

export type Serializable = string | number | boolean | null | undefined | Serializable[] | { [key: string]: Serializable }
export type SerializableObject = { [key: string]: Serializable }

export interface BugBerry {
  /** The callback runs when a report is made; the last one set wins. */
  metadata(callback: () => SerializableObject): void
  log(message: string, data?: SerializableObject): void
  info(message: string, data?: SerializableObject): void
  warn(message: string, data?: SerializableObject): void
  error(message: string, data?: SerializableObject): void
}

/** For tests: the same API bound to another host object; `stackOf` stands in for the stack read in each method. */
export function createBugBerry(host: object | undefined, stackOf?: () => string | undefined): BugBerry {
  return bugberryOn(() => host, stackOf)
}

function bugberryOn(hostOf: () => object | undefined, stackOf?: () => string | undefined): BugBerry {
  const allowStack = createStackBudget()
  const record = (level: SdkEntry["level"], message: unknown, data: unknown, site: Error | undefined) => {
    try {
      const global = sdkGlobal(hostOf())
      if (!global) return
      const entry: SdkEntry = { t: Date.now(), level, message: String(message) }
      if (data !== undefined) entry.data = data
      const stack = readStack(site)
      if (stack !== undefined) entry.stack = stack
      global.push(entry)
    } catch {
      // The SDK must never break the app that calls it.
    }
  }
  const readStack = (site: Error | undefined) => {
    try {
      return withoutSdkFrame(stackOf ? stackOf() : site?.stack)
    } catch {
      return undefined
    }
  }
  // The Error is made in each public method's own body, so the one frame withoutSdkFrame drops is that method.
  return {
    metadata(callback) {
      try {
        const global = sdkGlobal(hostOf())
        if (global && typeof callback === "function") global.metadata = callback
      } catch {
        // Same as above.
      }
    },
    log(message, data) {
      record("info", message, data, allowStack() ? new Error() : undefined)
    },
    info(message, data) {
      record("info", message, data, allowStack() ? new Error() : undefined)
    },
    warn(message, data) {
      record("warn", message, data, allowStack() ? new Error() : undefined)
    },
    error(message, data) {
      record("error", message, data, allowStack() ? new Error() : undefined)
    },
  }
}

// Looked up on each call: a server render has no window and must keep nothing, and a window can appear later.
export const bugberry: BugBerry = bugberryOn(() => (typeof window === "object" && window !== null ? window : undefined))
