import type { ProviderConfig } from "@bugberry/ai-write"

/** The reporter's own AI key: kept in this browser only, never sent to the BugBerry server. */
export interface AiKeyStorage {
  get(): Promise<ProviderConfig | null>
  set(value: ProviderConfig): Promise<void>
  clear(): Promise<void>
}

/** The stored value, or null when it is missing or not a key (an older or damaged entry). */
export function readStoredKey(value: unknown): ProviderConfig | null {
  if (typeof value !== "object" || value === null) return null
  const entry = value as Record<string, unknown>
  if (entry.preset !== "openai" && entry.preset !== "custom") return null
  if (typeof entry.baseUrl !== "string" || typeof entry.model !== "string" || typeof entry.apiKey !== "string") return null
  return { preset: entry.preset, baseUrl: entry.baseUrl, model: entry.model, apiKey: entry.apiKey }
}

/** "sk-…a1b2": shown once a key is saved, so the reporter can tell which one it is. */
export const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "…")
