export type MicAccess = "granted" | "prompt" | "denied"

/** Whether BugBerry may use the microphone. A browser that can't say is treated as "ask". */
export async function micAccess(query: (name: "microphone") => Promise<{ state: string }>): Promise<MicAccess> {
  try {
    const { state } = await query("microphone")
    return state === "granted" || state === "denied" ? state : "prompt"
  } catch {
    return "prompt"
  }
}

/** The default microphone's name as the popup shows it; Chrome hides names until permission is granted. */
export function micDeviceLabel(devices: Array<{ kind: string; deviceId: string; label: string }>): string {
  const inputs = devices.filter((device) => device.kind === "audioinput")
  const chosen = inputs.find((device) => device.deviceId === "default") ?? inputs[0]
  const label = chosen?.label.replace(/^Default - /, "").trim()
  return label || "Microphone"
}

/** "Mic on" only while BugBerry may still use the microphone; a revoked permission shows as "Mic off". */
export function micChoiceAfterCheck(mic: boolean, access: MicAccess): boolean {
  return mic && access === "granted"
}

/** What the microphone page says when Chrome's request fails; `access` is the permission state afterwards. */
export function micErrorText(error: unknown, access: MicAccess): string {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError") {
    if (access === "denied") return "Microphone is blocked. Allow it for BugBerry in Chrome's site settings."
    // Chrome allows it, the computer doesn't (macOS or Windows privacy settings).
    if (access === "granted") return "Your computer's privacy settings block the microphone for Chrome. Allow it there, then try again."
    return "Chrome didn't get an answer. Try again and choose Allow."
  }
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is in use by another app. Close it there, then try again."
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found."
  return "The microphone couldn't be started. Try again."
}
