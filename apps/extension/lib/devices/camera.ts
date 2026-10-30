export type CameraAccess = "granted" | "prompt" | "denied"

/** Whether BugBerry may use the camera. A browser that can't say is treated as "ask". */
export async function cameraAccess(query: (name: "camera") => Promise<{ state: string }>): Promise<CameraAccess> {
  try {
    const { state } = await query("camera")
    return state === "granted" || state === "denied" ? state : "prompt"
  } catch {
    return "prompt"
  }
}

/** A camera as the popup's picker shows it. */
export interface CameraDevice {
  id: string
  name: string
}

/** Chrome's "(0bda:5520)" after a USB camera's name. */
const USB_ID = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i

/**
 * The cameras to choose from. Chrome hides the labels until the camera may be used: then there is nothing
 * to show. Its "default" entry repeats a real camera under another id.
 */
export function cameraDevices(devices: Array<{ kind: string; deviceId: string; label: string }>): CameraDevice[] {
  return devices
    .filter((device) => device.kind === "videoinput" && device.deviceId !== "default" && device.label.trim() !== "")
    .map((device) => ({ id: device.deviceId, name: device.label.trim().replace(USB_ID, "") }))
}

/** What the camera page says when Chrome's request fails; `access` is the permission state afterwards. */
export function cameraErrorText(error: unknown, access: CameraAccess): string {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError") {
    if (access === "denied") return "Camera is blocked. Allow it for BugBerry in Chrome's site settings."
    // Chrome allows it, the computer doesn't (macOS or Windows privacy settings).
    if (access === "granted") return "Your computer's privacy settings block the camera for Chrome. Allow it there, then try again."
    return "Chrome didn't get an answer. Try again and choose Allow."
  }
  if (name === "NotReadableError" || name === "AbortError") return "The camera is in use by another app. Close it there, then try again."
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found."
  return "The camera couldn't be started. Try again."
}
