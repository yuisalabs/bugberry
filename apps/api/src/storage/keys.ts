import type { CaptureType } from "@bugberry/shared"

const MEDIA_EXTENSIONS: Record<CaptureType, string> = { screenshot: "png", video: "webm" }
const SAFE_KEY =
  /^(reports\/[A-Za-z0-9-]+\/(media\.(png|webm)|debugger\.json\.gz|thumbnail\.jpg)|(avatars|logos|project-logos)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(png|jpg))$/

export function mediaKeyFor(reportId: string, captureType: CaptureType): string {
  return `reports/${reportId}/media.${MEDIA_EXTENSIONS[captureType]}`
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
