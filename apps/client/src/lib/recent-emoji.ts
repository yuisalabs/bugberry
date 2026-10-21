const KEY = "bugberry.recentEmoji"

/** The emoji list after picking one: it moves to the front, once, and the list keeps at most `max`. */
export function rememberEmoji(list: string[], emoji: string, max = 16): string[] {
  return [emoji, ...list.filter((item) => item !== emoji)].slice(0, max)
}

/** This browser's recently picked emoji; none when storage is unavailable or holds something else. */
export function readRecentEmoji(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function saveRecentEmoji(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Private windows and blocked storage just don't remember.
  }
}
