import type { CaptureType } from "@bugberry/shared"

const MEDIA_EXTENSIONS: Record<CaptureType, string> = { screenshot: "png", video: "webm", replay: "json.gz" }
const SAFE_KEY =
  /^(reports\/[A-Za-z0-9-]+\/(media\.(png|webm|json\.gz)|debugger\.json\.gz|thumbnail\.jpg|frames\/\d{3}\.jpg)|(avatars|logos|project-logos)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(png|jpg))$/

export function mediaKeyFor(reportId: string, captureType: CaptureType): string {
  return `reports/${reportId}/media.${MEDIA_EXTENSIONS[captureType]}`
}

/** A screenshot unpacked from a replay's stream at finalize. */
export function replayFrameKeyFor(reportId: string, index: number): string {
  return `reports/${reportId}/frames/${String(index).padStart(3, "0")}.jpg`
}

export function replayFrameKeys(reportId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => replayFrameKeyFor(reportId, index))
}

export function debuggerKeyFor(reportId: string): string {
  return `reports/${reportId}/debugger.json.gz`
}

export function thumbnailKeyFor(reportId: string): string {
  return `reports/${reportId}/thumbnail.jpg`
}

/** A profile photo: one object per upload, so an old link never shows a newer photo. */
export function avatarKeyFor(userId: string, avatarId: string): string {
  return `avatars/${userId}/${avatarId}`
}

/** A workspace logo: one object per upload, like avatars. */
export function logoKeyFor(workspaceId: string, logoId: string): string {
  return `logos/${workspaceId}/${logoId}`
}

/** A project logo: one object per upload, like workspace logos. */
export function projectLogoKeyFor(projectId: string, logoId: string): string {
  return `project-logos/${projectId}/${logoId}`
}

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error(`Invalid storage key: ${key}`)
}
