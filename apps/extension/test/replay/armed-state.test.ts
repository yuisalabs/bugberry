import { describe, expect, test } from "bun:test"
import { type ArmedTab, armedTabFrom, createArmedStore } from "../../lib/replay/armed-state"

/** storage.session in memory; each call yields once, as the real one does, so interleaved writes show up. */
function memorySession(initial: Record<string, unknown> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    async get(key: string) {
      await Promise.resolve()
      return items.has(key) ? { [key]: structuredClone(items.get(key)) } : {}
    },
    async set(patch: Record<string, unknown>) {
      await Promise.resolve()
      for (const [key, value] of Object.entries(patch)) items.set(key, structuredClone(value))
    },
  }
}

const tab: ArmedTab = { windowMs: 60_000, since: 1_000, degraded: false, suspended: false }

describe("armed replay tabs", () => {
  test("a tab set is read back and listed", async () => {
    const store = createArmedStore(memorySession())
    await store.set(3, tab)
    expect(await store.get(3)).toEqual(tab)
    expect(await store.all()).toEqual({ 3: tab })
  })

  test("remove leaves nothing", async () => {
    const store = createArmedStore(memorySession())
    await store.set(3, tab)
    await store.remove(3)
    expect(await store.get(3)).toBeNull()
    expect(await store.all()).toEqual({})
  })

  test("a damaged entry reads as not armed", async () => {
    const store = createArmedStore(memorySession({ replay: { 3: { windowMs: "x" } } }))
    expect(await store.get(3)).toBeNull()
    expect(await store.all()).toEqual({})
    expect(armedTabFrom({ windowMs: 45_000, since: 1, degraded: false, suspended: false })).toBeNull()
  })

  test("two tabs written at once are both kept", async () => {
    const store = createArmedStore(memorySession())
    await Promise.all([store.set(3, tab), store.set(4, { ...tab, windowMs: 30_000 })])
    expect(Object.keys(await store.all()).sort()).toEqual(["3", "4"])
  })
})
