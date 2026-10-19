interface Patch {
  target: object
  key: PropertyKey
  original: unknown
  replacement: unknown
}

/**
 * Replaces methods on page objects and puts them back. Restoring skips any method the page has wrapped
 * again since (ours is no longer the one in place), so a later wrapper of the page is never removed.
 */
export function createPatcher() {
  const patches: Patch[] = []
  return {
    /** Throws when the property cannot be replaced (non-writable, frozen object). */
    replace<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
      const original = target[key]
      target[key] = replacement
      if (target[key] !== replacement) throw new Error(`${String(key)} could not be replaced`)
      patches.push({ target, key, original, replacement })
    },
    restore(): void {
      for (const patch of patches.reverse()) {
        const target = patch.target as Record<PropertyKey, unknown>
        if (target[patch.key] === patch.replacement) target[patch.key] = patch.original
      }
      patches.length = 0
    },
  }
}

/** Runs `install`; if it throws partway, `undo` removes whatever it had already put in place. */
export function installOrUndo(install: () => void, undo: () => void): void {
  try {
    install()
  } catch (error) {
    undo()
    throw error
  }
}
