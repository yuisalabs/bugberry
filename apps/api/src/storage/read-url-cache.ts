/** Entries kept at most; past that the oldest go first. */
const MAX_ENTRIES = 10_000

/**
 * Hands out the same signed read link for an object for a quarter of the link's lifetime. A list refreshed
 * every few minutes then shows the same preview URLs, so the browser keeps the images it already downloaded
 * and decoded instead of fetching every one again. Each link handed out still has at least three quarters
 * of its lifetime left.
 */
export class ReadUrlCache {
  private readonly entries = new Map<string, { url: string; reuseUntil: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string, contentType: string, ttlSeconds: number, sign: () => Promise<string> | string): Promise<string> {
    const id = `${ttlSeconds}\n${contentType}\n${key}`
    const now = this.now()
    const cached = this.entries.get(id)
    if (cached && now < cached.reuseUntil) return cached.url

    const url = await sign()
    this.entries.delete(id)
    this.entries.set(id, { url, reuseUntil: now + (ttlSeconds * 1000) / 4 })
    if (this.entries.size > MAX_ENTRIES) this.prune(now)
    return url
  }

  private prune(now: number) {
    for (const [id, entry] of this.entries) {
      if (entry.reuseUntil <= now) this.entries.delete(id)
    }
    // Map keeps insertion order, so the first entries are the oldest.
    for (const id of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break
      this.entries.delete(id)
    }
  }
}
