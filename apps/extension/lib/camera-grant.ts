import type { CameraShape } from "./capture-prefs"
import type { CameraChoice } from "./messages"

/** How long a recording waits for the camera bubble's first picture before it starts anyway. */
export const CAMERA_READY_MS = 1500

/** The camera bubble one tab may show: only a frame in that tab, naming this token, gets the camera choice. */
export interface CameraGrant {
  tabId: number
  token: string
  deviceId: string | null
  shape: CameraShape
}

/** Kept in storage.session, so the grant outlives the service worker going to sleep. */
export interface CameraGrantStore {
  get(): Promise<CameraGrant | null>
  set(grant: CameraGrant | null): Promise<void>
}

/**
 * The camera bubble's page has to be web accessible, so any site could embed it. It opens the camera only
 * with the grant of a recording that asked for the camera, from inside the tab being recorded.
 */
export function createCameraGrants(deps: {
  store: CameraGrantStore
  newToken(): string
  setTimer(run: () => void, ms: number): () => void
}) {
  /** Waiting for a bubble's first picture, by token. In memory: only the start that opened the grant waits. */
  const waiting = new Map<string, () => void>()

  const granted = async (token: string, senderTabId: number | undefined) => {
    const grant = await deps.store.get()
    return grant && grant.token === token && senderTabId !== undefined && grant.tabId === senderTabId ? grant : null
  }

  return {
    /** Replaces any earlier grant. */
    async open(tabId: number, choice: CameraChoice): Promise<CameraGrant> {
      const grant: CameraGrant = { tabId, token: deps.newToken(), deviceId: choice.deviceId, shape: choice.shape }
      await deps.store.set(grant)
      return grant
    },

    /** Ends the grant; returns the one that was open, so the caller knows which tab to tell. */
    async close(): Promise<CameraGrant | null> {
      const grant = await deps.store.get()
      if (grant) await deps.store.set(null)
      return grant
    },

    async read(token: string, senderTabId: number | undefined): Promise<CameraChoice | null> {
      const grant = await granted(token, senderTabId)
      return grant ? { deviceId: grant.deviceId, shape: grant.shape } : null
    },

    /** The bubble shows its first picture. */
    async ready(token: string, senderTabId: number | undefined): Promise<void> {
      if (await granted(token, senderTabId)) waiting.get(token)?.()
    },

    /** The bubble's first picture, or `ms` passing, whichever comes first. */
    waitReady(token: string, ms: number): Promise<"ready" | "timeout"> {
      return new Promise((resolve) => {
        const cancel = deps.setTimer(() => {
          waiting.delete(token)
          resolve("timeout")
        }, ms)
        waiting.set(token, () => {
          cancel()
          waiting.delete(token)
          resolve("ready")
        })
      })
    },

    /** What the page layer needs after a reload of this tab: the token and the shape, never the device. */
    async forTab(tabId: number | undefined): Promise<{ token: string; shape: CameraShape } | null> {
      const grant = await deps.store.get()
      return grant && tabId !== undefined && grant.tabId === tabId ? { token: grant.token, shape: grant.shape } : null
    },
  }
}

export type CameraGrants = ReturnType<typeof createCameraGrants>
