import { ApiError, type DeviceInfo } from "@bugberry/shared"

export interface UploadTarget {
  method: "PUT"
  url: string
  headers: Record<string, string>
}

export interface StartBody {
  name: string
  email?: string
  description?: string
  captureType: "video" | "screenshot"
  mediaSize: number
  thumbnailSize?: number
  durationMs?: number
  pageUrl?: string
  device: DeviceInfo
}

export interface RequestApi {
  start(token: string, body: StartBody): Promise<{ uploadToken: string; mediaUpload: UploadTarget | null; thumbnailUpload: UploadTarget | null }>
  /** Fresh upload links for a ticket already handed out. */
  ticket(uploadToken: string): Promise<{ mediaUpload: UploadTarget | null; thumbnailUpload: UploadTarget | null }>
  finalize(uploadToken: string): Promise<unknown>
}

export interface SendDeps {
  api: RequestApi
  put(target: UploadTarget, body: Blob, onProgress: (fraction: number) => void): Promise<void>
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  sleep(ms: number): Promise<void>
}

export interface SendInput {
  media: Blob
  thumbnail: Blob | null
  captureType: "video" | "screenshot"
  durationMs: number | null
  name: string
  email: string
  description: string
  pageUrl: string
  device: DeviceInfo
}

/** The link stopped taking recordings before this one was sent. */
export class RequestClosed extends Error {
  constructor() {
    super("This link doesn't take recordings any more.")
    this.name = "RequestClosed"
  }
}

const RETRY_DELAYS_MS = [1000, 3000, 9000]
/** A kept ticket that can't take this upload any more: the send starts over. */
const STALE_TICKET = new Set(["upload_link_expired", "upload_link_unknown", "upload_failed", "upload_size_mismatch"])

const ticketKey = (token: string) => `bugberry-request-${token}`

/** Runs `work`, and again after 1, 3 and 9 seconds while it fails without an answer from the server. */
async function retried<T>(sleep: SendDeps["sleep"], work: () => Promise<T>, retryAny = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      const unanswered = !(error instanceof ApiError) || error.status === 0
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !(unanswered || retryAny)) throw error
      await sleep(delay)
    }
  }
}

function readTicket(storage: SendDeps["storage"], token: string): { uploadToken: string; mediaSize: number } | null {
  try {
    const kept = JSON.parse(storage.getItem(ticketKey(token)) ?? "null") as { uploadToken?: unknown; mediaSize?: unknown } | null
    return kept && typeof kept.uploadToken === "string" && typeof kept.mediaSize === "number"
      ? { uploadToken: kept.uploadToken, mediaSize: kept.mediaSize }
      : null
  } catch {
    return null
  }
}

/**
 * Sends one recording through a request link. The upload ticket is kept in `storage` from the start until finalize
 * answers, so a reload during the upload goes on with the same report instead of taking a second use of the link.
 */
export async function sendRecording(deps: SendDeps, token: string, input: SendInput, onProgress: (fraction: number) => void): Promise<void> {
  const { api, storage, sleep } = deps
  const key = ticketKey(token)
  let uploadToken: string | null = null
  let targets: { mediaUpload: UploadTarget | null; thumbnailUpload: UploadTarget | null } | null = null

  const kept = readTicket(storage, token)
  if (kept && kept.mediaSize === input.media.size) {
    try {
      targets = await retried(sleep, () => api.ticket(kept.uploadToken))
      uploadToken = kept.uploadToken
    } catch (error) {
      if (error instanceof ApiError && error.code === "upload_link_used") {
        // Finalized before the reload: the recording already arrived.
        storage.removeItem(key)
        onProgress(1)
        return
      }
      if (!(error instanceof ApiError && STALE_TICKET.has(error.code))) throw error
    }
  }

  if (!uploadToken || !targets) {
    storage.removeItem(key)
    const body: StartBody = {
      name: input.name.trim(),
      ...(input.email.trim() ? { email: input.email.trim() } : {}),
      ...(input.description.trim() ? { description: input.description.trim() } : {}),
      captureType: input.captureType,
      mediaSize: input.media.size,
      ...(input.thumbnail ? { thumbnailSize: input.thumbnail.size } : {}),
      ...(input.durationMs !== null ? { durationMs: input.durationMs } : {}),
      ...(input.pageUrl.trim() ? { pageUrl: input.pageUrl.trim() } : {}),
      device: input.device,
    }
    let started: Awaited<ReturnType<RequestApi["start"]>>
    try {
      started = await retried(sleep, () => api.start(token, body))
    } catch (error) {
      if (error instanceof ApiError && error.code === "request_unavailable") throw new RequestClosed()
      throw error
    }
    uploadToken = started.uploadToken
    targets = started
    storage.setItem(key, JSON.stringify({ uploadToken, mediaSize: input.media.size }))
  }

  const mediaTarget = targets.mediaUpload
  if (!mediaTarget) throw new Error("The server gave no upload link for the recording.")
  await retried(sleep, () => deps.put(mediaTarget, input.media, onProgress), true)
  const thumbnailTarget = targets.thumbnailUpload
  // A preview only: the report arrives without it if it doesn't go up.
  if (input.thumbnail && thumbnailTarget) await deps.put(thumbnailTarget, input.thumbnail, () => {}).catch(() => undefined)
  const ticket = uploadToken
  await retried(sleep, () => api.finalize(ticket))
  storage.removeItem(key)
  onProgress(1)
}
