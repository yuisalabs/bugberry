import { decodeDebuggerPayload } from "@bugberry/capture"
import { type DebuggerView, normalizePayload } from "./debugger-events"

export async function loadDebugger(url: string, fetcher: typeof fetch = fetch): Promise<DebuggerView> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Couldn't download the debugger data (HTTP ${response.status})`)
  return normalizePayload(await decodeDebuggerPayload(await response.blob()))
}

/** Read URLs expire (READ_URL_TTL_SECONDS). On failure ask the server for a fresh one, once. */
export async function loadDebuggerWithRefresh(
  url: string,
  refreshUrl: () => Promise<string | null>,
  fetcher: typeof fetch = fetch,
): Promise<DebuggerView> {
  try {
    return await loadDebugger(url, fetcher)
  } catch (error) {
    const fresh = await refreshUrl().catch(() => null)
    if (!fresh || fresh === url) throw error
    return loadDebugger(fresh, fetcher)
  }
}
