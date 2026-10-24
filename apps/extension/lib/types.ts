import type { DebuggerPayload } from "@bugberry/capture"
import type { DeviceInfo, Priority, Visibility } from "@bugberry/shared"
import type { Shape } from "./annotations"
import type { ScreenshotMode } from "./capture-prefs"
import type { PageCaptureRecord } from "./page-merge"
import type { TrimRange } from "./review-data"

export interface ReportForm {
  /** The workspace the report goes to. Forms saved before workspaces have none. */
  workspaceId?: string
  /** Empty for "No project". */
  projectId: string
  title: string
  description: string
  priority: Priority
  visibility: Visibility
  /** Assigned once the report exists; absent or empty for nobody. */
  assigneeId?: string
}

export interface UploadTarget {
  method: "PUT"
  url: string
  headers: Record<string, string>
}

/** Progress of an upload, kept so a retry resumes instead of creating a second report. */
export interface UploadSessionState {
  reportId: string
  reportUrl: string
  shareUrl: string
  /** Null when the media goes up in parts. */
  mediaUpload: UploadTarget | null
  /**
   * Media sent in parts, so no request is bigger than a proxy allows (Cloudflare: 100 MB): one link per part, in
   * order, each `partSize` bytes but the last. Older servers, and sessions saved before parts existed, have none.
   */
  mediaParts?: { partSize: number; parts: UploadTarget[] } | null
  /** How many parts, from the first, have arrived. */
  mediaPartsUploaded?: number
  debuggerUpload: UploadTarget | null
  /** Size declared to the server; a different media size needs a new session. */
  mediaSize: number
  /** SHA-256 of the media the session was created for; different content needs a new session. */
  mediaHash?: string
  mediaUploaded: boolean
  debuggerUploaded: boolean
  /** Server the session was created on; sessions saved before servers could change have none. */
  serverUrl?: string
  /** Optional: sessions saved before thumbnails existed have neither field and simply skip it. */
  thumbnailUpload?: UploadTarget | null
  thumbnailUploaded?: boolean
}

export type DraftStatus = "recording" | "editing" | "uploading" | "failed"

interface DraftBase {
  id: string
  createdAt: number
  page: { url: string; title: string }
  device: DeviceInfo
  debuggerPayload: DebuggerPayload | null
  /** Encoded once, so a retried upload sends exactly the bytes it declared. */
  debuggerGzip: Blob | null
  status: DraftStatus
  error: string | null
  session: UploadSessionState | null
  /** Form values the current session was created with; different values need a new session. */
  form: ReportForm | null
  /** The tab it was made on, so "Record again" or "Retake" can go back there. Older drafts have none. */
  tabId?: number
}

export interface ScreenshotDraft extends DraftBase {
  captureType: "screenshot"
  screenshot: Blob
  /** Kept so a reopened draft still shows (and exports) its blur and markings. */
  annotations: Shape[]
  /** How it was taken, so "Retake" takes it the same way. */
  screenshotMode?: ScreenshotMode
}

export interface VideoDraft extends DraftBase {
  captureType: "video"
  /** Null while recording; the offscreen recorder stores the finished video here. */
  video: Blob | null
  durationMs: number | null
  /** Epoch ms when recording started; event offsets in the dashboard are measured from it. */
  recordingStartedAt: number | null
  /** While recording: each page the tab left, flushed on pagehide. Merged into the payload at stop. */
  pages?: PageCaptureRecord[]
  /**
   * While recording: the notes pinned so far (`atMs` is video time). Kept here, in the extension's own
   * IndexedDB, rather than in session storage, which content scripts can read.
   */
  liveNotes?: Array<{ n: number; atMs: number; text: string }>
  /** The part the reporter keeps (video time); absent or null sends the whole video. */
  trim?: TrimRange | null
  /** The video re-encoded to `range`, so a retried send uploads the same bytes. */
  trimmed?: { range: TrimRange; video: Blob } | null
  /** Set when the time limit ended the recording: the limit it stopped at. */
  stoppedAtLimitMs?: number
  /** Set at the first Send: from then on the trim can't change, as part of the full video may be on the server. */
  sendStarted?: boolean
}

export type ReportDraft = ScreenshotDraft | VideoDraft
