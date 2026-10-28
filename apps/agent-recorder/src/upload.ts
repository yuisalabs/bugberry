import { readFileSync } from "node:fs"
import type { StoredRecording } from "./session"

interface UploadTarget {
  method: "PUT"
  url: string
  headers: Record<string, string>
}

interface LinkTargets {
  mediaUpload: UploadTarget | null
  mediaParts: { partSize: number; parts: UploadTarget[] } | null
  debuggerUpload: UploadTarget | null
  thumbnailUpload: UploadTarget | null
}

const UPLOAD_LINK_PATH = /^\/api\/agent-uploads\/[A-Za-z0-9_-]+$/

/** A PUT to the server itself (local storage) or to https storage (S3); nothing in the clear elsewhere. */
function safeTarget(target: UploadTarget, server: string): boolean {
  if (target.method !== "PUT") return false
  try {
    const url = new URL(target.url)
    return url.protocol === "https:" || url.origin === new URL(server).origin
  } catch {
    return false
  }
}

/** One try plus three retries, waiting 1, 3 and 9 seconds: the extension's own uploader does the same. */
const RETRY_DELAYS_MS = [1000, 3000, 9000]

export interface SubmitOptions {
  /** The --server origin: the only place a recording may go. */
  server: string
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** The server's own message when it gave one ("This upload link expired. Call createUpload again."). */
async function serverError(response: Response, doing: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null
  return new Error(typeof body?.message === "string" ? body.message : `BugBerry answered ${response.status} while ${doing}.`)
}

/**
 * Sends a stopped recording to the report createUpload made: the link names the files' PUT targets, then finalizes.
 * A link on any other server than --server is refused before anything is sent: a recording can show a signed-in app,
 * and an agent talked into it must not hand it to someone else.
 */
export async function submitRecording(recording: StoredRecording, uploadLink: string, opts: SubmitOptions): Promise<{ reportUrl: string }> {
  const fetcher = opts.fetcher ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let link: URL
  try {
    link = new URL(uploadLink)
  } catch {
    throw new Error("uploadLink is not a link. Pass the uploadLink createUpload returned.")
  }
  if (link.origin !== new URL(opts.server).origin) {
    throw new Error(`This upload link is not on ${opts.server}. The recorder only sends recordings to the BugBerry server it was set up with.`)
  }
  // Only the link createUpload hands out: another address on the same server could answer with someone's own files.
  if (!UPLOAD_LINK_PATH.test(link.pathname) || link.search || link.hash) {
    throw new Error("This is not an upload link. Pass the uploadLink createUpload returned, unchanged.")
  }

  // A redirect could lead anywhere, so none is followed.
  const answer = await fetcher(link.href, { redirect: "error" })
  if (!answer.ok) throw await serverError(answer, "reading the upload link")
  const targets = (await answer.json()) as LinkTargets
  const allTargets = [targets.mediaUpload, ...(targets.mediaParts?.parts ?? []), targets.debuggerUpload, targets.thumbnailUpload]
  if (!allTargets.every((target) => target === null || safeTarget(target, opts.server))) {
    throw new Error("BugBerry answered with an unexpected upload address, so nothing was sent.")
  }

  const send = async (target: UploadTarget, bytes: Uint8Array) => {
    // A copy with its own ArrayBuffer: fetch takes that, not a view into Node's shared Buffer pool.
    const body = new Uint8Array(bytes)
    for (let attempt = 0; ; attempt++) {
      const response = await fetcher(target.url, { method: target.method, headers: target.headers, body, redirect: "error" }).catch(() => null)
      if (response?.ok) return
      const wait = RETRY_DELAYS_MS[attempt]
      if (wait === undefined) throw new Error("The recording couldn't be sent: the upload kept failing. Try submitRecording again.")
      await sleep(wait)
    }
  }

  const media = readFileSync(recording.mediaPath)
  if (targets.mediaParts) {
    const { partSize, parts } = targets.mediaParts
    for (const [index, part] of parts.entries()) await send(part, media.subarray(index * partSize, (index + 1) * partSize))
  } else if (targets.mediaUpload) {
    await send(targets.mediaUpload, media)
  }
  if (targets.debuggerUpload) await send(targets.debuggerUpload, readFileSync(recording.debuggerPath))
  if (targets.thumbnailUpload && recording.thumbnailPath) await send(targets.thumbnailUpload, readFileSync(recording.thumbnailPath))

  const finalized = await fetcher(`${link.href}/finalize`, { method: "POST", redirect: "error" })
  if (!finalized.ok) throw await serverError(finalized, "finishing the upload")
  const { reportUrl } = (await finalized.json()) as { reportUrl: string }
  return { reportUrl }
}
