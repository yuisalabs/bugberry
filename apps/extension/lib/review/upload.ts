import { type DebuggerPayload, encodeDebuggerPayload, summarize } from "@bugberry/capture"
import { ApiError, type BugberryApi } from "../server/api"
import type { DraftStore } from "../drafts/draft-store"
import type { Coordinates } from "./location"
import type { ReportDraft, ReportForm, UploadSessionState, UploadTarget } from "../shared/types"

export type { ReportForm } from "../shared/types"

/** A report once its upload is done. */
export interface SentReport {
  id: string
  reportUrl: string
  shareUrl: string
}

/** What `lock` returns when another tab already holds the lock. */
export const LOCKED = Symbol("locked")

export interface UploadDeps {
  api: Pick<BugberryApi, "createUpload" | "finalize"> & Partial<Pick<BugberryApi, "setLocation" | "mediaParts">>
  store: DraftStore
  /** `onProgress` gets the bytes of `body` sent so far. */
  putFile(target: UploadTarget, body: Blob, onProgress?: (sent: number) => void): Promise<void>
  sleep(ms: number): Promise<void>
  /** The active server: a session started on another one is not resumed. */
  serverUrl: string
  /**
   * Runs `work` while holding `name` across all extension pages, or returns LOCKED at once when
   * another page holds it. The editor uses navigator.locks, which a closed tab releases by itself.
   */
  lock?<T>(name: string, work: () => Promise<T>): Promise<T | typeof LOCKED>
}

/** How much of a report's files has gone up, in bytes. */
export interface UploadProgress {
  sent: number
  total: number
}

/** One try plus three retries, waiting 1, 3 and 9 seconds. */
export const RETRY_DELAYS_MS = [1000, 3000, 9000]

/** Sends one PUT and answers its HTTP status; rejects when the connection fails. */
export type PutRequest = (target: UploadTarget, body: Blob, onProgress: (sent: number) => void) => Promise<number>

/** XMLHttpRequest, because fetch can't tell how much of an upload has been sent. */
export const xhrPut: PutRequest = (target, body, onProgress) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)
    for (const [name, value] of Object.entries(target.headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => onProgress(event.loaded)
    request.onload = () => resolve(request.status)
    request.onerror = request.onabort = request.ontimeout = () => reject(new Error("Upload interrupted"))
    request.send(body)
  })

export async function putFile(
  target: UploadTarget,
  body: Blob,
  onProgress: (sent: number) => void = () => {},
  request: PutRequest = xhrPut,
): Promise<void> {
  let status: number
  try {
    status = await request(target, body, onProgress)
  } catch {
    throw new ApiError(0, "network", "Upload interrupted")
  }
  // 409: a previous attempt already stored this file (its response was lost).
  if ((status >= 200 && status < 300) || status === 409) return
  if (status === 401 || status === 403) {
    throw new ApiError(status, "upload_expired", "The upload link has expired")
  }
  // 0: the browser got no answer at all (the connection dropped, or CORS hid it).
  if (status === 0) throw new ApiError(0, "network", "Upload interrupted")
  throw new ApiError(status, "upload_failed", `Upload failed (HTTP ${status})`)
}

/** Finalize answers meaning the session's report is gone or unusable: start a new one. */
const SESSION_LOST_CODES = new Set(["report_not_found", "forbidden", "upload_failed", "upload_size_mismatch"])

function shouldRetry(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.retryable || error.code === "upload_expired" || error.code === "session_lost")
  )
}

/** The fields an upload session fixes. The assignee is set once the report exists, so it doesn't count. */
export function sameForm(a: ReportForm | null, b: ReportForm): boolean {
  const fixed = ({ assigneeId: _assignee, ...rest }: ReportForm) => JSON.stringify(rest)
  return a !== null && fixed(a) === fixed(b)
}

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Upload failed"
}

export interface SendOptions {
  location?: Coordinates | null
  /** How much has gone up, all files together; called often while a file is being sent. */
  onProgress?: (progress: UploadProgress) => void
  /** A trimmed recording's own payload and length, in place of the draft's (which stays whole). */
  payload?: DebuggerPayload | null
  durationMs?: number | null
}

/**
 * Sends a draft. Only one page at a time may send a given draft: the same draft opened in two editor
 * tabs would otherwise create two upload sessions and so two reports.
 */
export async function submitDraft(
  draftId: string,
  form: ReportForm,
  media: Blob,
  deps: UploadDeps,
  thumbnail: Blob | null = null,
  options: SendOptions = {},
): Promise<SentReport> {
  if (!deps.lock) return submitUnlocked(draftId, form, media, deps, thumbnail, options)
  const result = await deps.lock(`bugberry-draft-${draftId}`, () =>
    submitUnlocked(draftId, form, media, deps, thumbnail, options),
  )
  if (result === LOCKED) throw new Error("This draft is being sent from another tab. Wait for it to finish.")
  return result
}

async function submitUnlocked(
  draftId: string,
  form: ReportForm,
  media: Blob,
  deps: UploadDeps,
  thumbnail: Blob | null,
  options: SendOptions,
): Promise<SentReport> {
  const stored = await deps.store.get(draftId)
  if (!stored) throw new Error("Report draft not found")
  let draft: ReportDraft = stored
  /** Only upload bookkeeping changes here; the captured media and page stay as recorded. */
  const save = async (changes: Partial<Pick<ReportDraft, "debuggerGzip" | "status" | "error" | "session" | "form">>) => {
    draft = { ...draft, ...changes }
    await deps.store.put(draft)
  }

  const payload = options.payload ?? draft.debuggerPayload
  const durationMs = options.durationMs ?? (draft.captureType === "video" ? draft.durationMs : null)
  if (payload && !draft.debuggerGzip) {
    await save({ debuggerGzip: await encodeDebuggerPayload(payload) })
  }
  // A session fixes the server, the media and the report fields, so a change in any of them needs a new one.
  // Size alone is not enough: an annotation can change the picture without changing the byte count.
  const mediaHash = await sha256(media)
  const reusable =
    draft.session &&
    (draft.session.serverUrl ?? deps.serverUrl) === deps.serverUrl &&
    draft.session.mediaSize === media.size &&
    draft.session.mediaHash === mediaHash &&
    sameForm(draft.form, form)
  await save({ status: "uploading", error: null, session: reusable ? draft.session : null, form })

  const attempt = async () => {
    let current: UploadSessionState | null = draft.session
    if (!current) {
      const created = await deps.api.createUpload({
        ...(form.workspaceId ? { workspaceId: form.workspaceId } : {}),
        // An empty choice is "No project": the report belongs to no project, so no projectId is sent.
        ...(form.projectId ? { projectId: form.projectId } : {}),
        // Left empty, the server names it after its kind and the reporter.
        ...(form.title.trim() ? { title: form.title.trim() } : {}),
        description: form.description.trim() || undefined,
        priority: form.priority,
        visibility: form.visibility,
        captureType: draft.captureType,
        // A large file then goes up in parts; an older server ignores this and sends one link.
        multipart: true,
        mediaSize: media.size,
        debuggerSize: draft.debuggerGzip?.size,
        ...(thumbnail ? { thumbnailSize: thumbnail.size } : {}),
        durationMs: draft.captureType === "video" ? (durationMs ?? undefined) : undefined,
        pageUrl: draft.page.url.slice(0, 2048),
        pageTitle: draft.page.title.slice(0, 500),
        device: draft.device,
        debuggerSummary: summarize(payload?.events ?? [], payload?.incomplete ?? []),
      })
      current = {
        ...created,
        serverUrl: deps.serverUrl,
        mediaSize: media.size,
        mediaHash,
        mediaUploaded: false,
        debuggerUploaded: !(created.debuggerUpload && draft.debuggerGzip),
        // An older server answers without thumbnailUpload; then there is nothing to send.
        thumbnailUpload: created.thumbnailUpload ?? null,
        thumbnailUploaded: !(created.thumbnailUpload && thumbnail),
      }
      await save({ session: current })
    }

    // Bytes sent of each file. One already up counts in full, so a resumed upload shows where it stopped.
    const debuggerBytes = current.debuggerUpload && draft.debuggerGzip ? draft.debuggerGzip.size : 0
    const thumbnailBytes = current.thumbnailUpload && thumbnail ? thumbnail.size : 0
    const total = media.size + debuggerBytes + thumbnailBytes
    const sent = {
      media: current.mediaUploaded ? media.size : Math.min(media.size, (current.mediaPartsUploaded ?? 0) * (current.mediaParts?.partSize ?? 0)),
      debugger: current.debuggerUploaded ? debuggerBytes : 0,
      thumbnail: current.thumbnailUploaded === false ? 0 : thumbnailBytes,
    }
    const progress = (file: keyof typeof sent, bytes: number) => {
      sent[file] = bytes
      options.onProgress?.({ sent: sent.media + sent.debugger + sent.thumbnail, total })
    }
    progress("media", sent.media)

    /** One PUT, or the parts one after another; a retry goes on from the first part that hasn't arrived. */
    const sendMedia = async (session: UploadSessionState) => {
      let split = session.mediaParts
      if (!split) {
        if (!session.mediaUpload) throw new Error("The server sent no upload link for the file")
        return deps.putFile(session.mediaUpload, media, (bytes) => progress("media", bytes))
      }
      if (split.parts.length !== Math.ceil(media.size / split.partSize)) {
        throw new Error("The server's upload links don't match the file")
      }
      for (let index = session.mediaPartsUploaded ?? 0; index < split.parts.length; index++) {
        const start = index * split.partSize
        const body = media.slice(start, start + split.partSize)
        const partProgress = (bytes: number) => progress("media", Math.min(media.size, start + bytes))
        try {
          await deps.putFile(split.parts[index] as UploadTarget, body, partProgress)
        } catch (error) {
          // The links are signed when the upload starts, so on a slow connection the last ones can expire before
          // their turn. New links for the same upload let it go on; without them a new report starts from part one.
          if (!(error instanceof ApiError && error.code === "upload_expired" && deps.api.mediaParts)) throw error
          const fresh = await deps.api.mediaParts(session.reportId).catch(() => null)
          if (!fresh || fresh.partSize !== split.partSize || fresh.parts.length !== split.parts.length) throw error
          split = fresh
          current = { ...(current as UploadSessionState), mediaParts: fresh }
          await deps.putFile(split.parts[index] as UploadTarget, body, partProgress)
        }
        current = { ...(current as UploadSessionState), mediaPartsUploaded: index + 1 }
        // Kept in memory only: saving the draft writes the whole video again, too much for every part. The save
        // once the file is up, or the one marking the draft failed, keeps it.
        draft = { ...draft, session: current }
      }
    }

    // The files go up at the same time; each one is recorded as done on its own, so a retry
    // only sends what is still missing.
    const puts: Promise<void>[] = []
    if (!current.mediaUploaded) {
      puts.push(
        sendMedia(current).then(async () => {
          progress("media", media.size)
          current = { ...(current as UploadSessionState), mediaUploaded: true }
          await save({ session: current })
        }),
      )
    }
    if (!current.debuggerUploaded && current.debuggerUpload && draft.debuggerGzip) {
      const debuggerUpload = current.debuggerUpload
      const gzip = draft.debuggerGzip
      puts.push(
        deps.putFile(debuggerUpload, gzip, (bytes) => progress("debugger", bytes)).then(async () => {
          progress("debugger", debuggerBytes)
          current = { ...(current as UploadSessionState), debuggerUploaded: true }
          await save({ session: current })
        }),
      )
    }
    // Best effort: the server drops a thumbnail that never arrives, so a failure is neither retried nor fatal.
    if (current.thumbnailUploaded === false && current.thumbnailUpload && thumbnail) {
      const thumbnailUpload = current.thumbnailUpload
      puts.push(
        deps
          .putFile(thumbnailUpload, thumbnail, (bytes) => progress("thumbnail", bytes))
          .catch((error) => console.warn("thumbnail upload failed", error))
          .then(async () => {
            // Done either way: a thumbnail that failed is not sent again.
            progress("thumbnail", thumbnailBytes)
            current = { ...(current as UploadSessionState), thumbnailUploaded: true }
            await save({ session: current })
          }),
      )
    }
    await Promise.all(puts)
    try {
      return await deps.api.finalize(current.reportId)
    } catch (error) {
      if (error instanceof ApiError && SESSION_LOST_CODES.has(error.code)) {
        await save({ session: null })
        throw new ApiError(error.status, "session_lost", error.message)
      }
      throw error
    }
  }

  for (let retry = 0; ; retry++) {
    try {
      const finalized = await attempt()
      await deps.store.delete(draftId)
      // Only in memory, never in the draft. An older server without this endpoint still has the report.
      if (options.location && deps.api.setLocation) {
        await deps.api.setLocation(finalized.id, options.location).catch(() => undefined)
      }
      return { id: finalized.id, reportUrl: finalized.reportUrl, shareUrl: finalized.shareUrl }
    } catch (error) {
      if (error instanceof ApiError && error.code === "upload_expired") await save({ session: null })
      const delay = RETRY_DELAYS_MS[retry]
      if (!shouldRetry(error) || delay === undefined) {
        await save({ status: "failed", error: messageOf(error) })
        throw error
      }
      await deps.sleep(delay)
    }
  }
}
