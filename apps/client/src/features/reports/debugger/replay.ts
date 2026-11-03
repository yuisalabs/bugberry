import { decodeReplayMedia, type ReplayEvent, type ReplayFrame, replayDurationMs, replayFrames } from "@bugberry/shared"
import { useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import { qk } from "../../../lib/query/keys"

export interface LoadedReplay {
  events: ReplayEvent[]
  frames: ReplayFrame[]
  durationMs: number
}

export async function loadReplay(url: string, fetcher: typeof fetch = fetch): Promise<LoadedReplay> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Couldn't download the replay (HTTP ${response.status})`)
  const { events } = await decodeReplayMedia(await response.blob())
  return { events, frames: replayFrames(events), durationMs: replayDurationMs(events) }
}

/** Read URLs expire (READ_URL_TTL_SECONDS). On failure ask the server for a fresh one, once. */
export async function loadReplayWithRefresh(
  url: string,
  refreshUrl: () => Promise<string | null>,
  fetcher: typeof fetch = fetch,
): Promise<LoadedReplay> {
  try {
    return await loadReplay(url, fetcher)
  } catch (error) {
    const fresh = await refreshUrl().catch(() => null)
    if (!fresh || fresh === url) throw error
    return loadReplay(fresh, fetcher)
  }
}

/**
 * Downloads and decodes media.json.gz once per report. As with the debugger data, the key leaves out the signed URL,
 * which changes on every detail refetch; the latest one is read from a ref.
 */
export function useReplay(
  report: { id: string; mediaUrl: string | null },
  refreshUrl: () => Promise<string | null>,
  fetcher: typeof fetch = fetch,
) {
  const urlRef = useRef(report.mediaUrl)
  urlRef.current = report.mediaUrl
  return useQuery({
    queryKey: qk.replay(report.id),
    queryFn: () => loadReplayWithRefresh(urlRef.current ?? "", refreshUrl, fetcher),
    enabled: report.mediaUrl !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
