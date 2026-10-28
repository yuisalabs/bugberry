import { MAX_RECORDING_MS, recordingByteBudget } from "@bugberry/shared"

export interface RecordingCaps {
  maxMs: number
  maxBytes: number
}

/**
 * Where a recording stops by itself. The recorder is never signed in, so these are the server's public limits, the
 * ones a signed-out extension uses; createUpload checks the workspace's own when the report is filed.
 */
export async function recordingCaps(server: string, fetcher: typeof fetch = fetch): Promise<RecordingCaps> {
  const response = await fetcher(`${server}/api/client-config`).catch(() => null)
  if (!response?.ok) throw new Error(`Couldn't reach BugBerry at ${server}. Check --server and your connection.`)
  const config = (await response.json()) as { maxUploadMb?: number; maxRecordingSeconds?: number | null }
  return {
    maxMs: config.maxRecordingSeconds ? Math.min(config.maxRecordingSeconds * 1000, MAX_RECORDING_MS) : MAX_RECORDING_MS,
    maxBytes: recordingByteBudget(config.maxUploadMb ?? 200),
  }
}
