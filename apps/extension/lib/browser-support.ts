/** The slice of the extension API that tells which recorder this browser can run. */
export interface RecorderApis {
  offscreen?: { createDocument?: unknown }
  tabCapture?: { getMediaStreamId?: unknown }
}

/**
 * Chrome and Opera record a tab through tabCapture and an offscreen document. Firefox has neither, so it
 * records a screen or window through a recorder window of its own.
 */
export function hasTabRecorder(api: RecorderApis): boolean {
  return typeof api.offscreen?.createDocument === "function" && typeof api.tabCapture?.getMediaStreamId === "function"
}
