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

export type MicKind = "built-in" | "headset" | "usb" | "other"

/** A microphone as the popup's picker shows it. */
export interface MicDevice {
  id: string
  name: string
  /** The line under the name: "Realtek(R) Audio · built-in", "Bluetooth headset". */
  detail: string
  /** The chip's name: "Realtek Audio". */
  short: string
  kind: MicKind
}

const USB_ID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i
/** Chrome's own entries, which repeat a real device under another id. */
const PSEUDO = new Set(["default", "communications"])

function kindOf(label: string): MicKind {
  if (/bluetooth|airpods|headset|hands-free|buds/i.test(label)) return "headset"
  if (/usb|yeti|[0-9a-f]{4}:[0-9a-f]{4}/i.test(label)) return "usb"
  if (/array|built-in|internal|macbook/i.test(label)) return "built-in"
  return "other"
}

function micDevice(deviceId: string, rawLabel: string): MicDevice {
  const label = rawLabel.replace(/^Default - /, "").trim()
  const grouped = /^(.*?)\s*\((.*)\)$/.exec(label)
  const name = grouped?.[1] || label
  const inner = grouped?.[2]
  const part = inner && !USB_ID.test(inner) ? inner : null
  const kind = kindOf(label)
  const detail =
    kind === "built-in" ? (part ? `${part} · built-in` : "Built-in") : kind === "headset" ? "Bluetooth headset" : kind === "usb" ? "USB microphone" : (part ?? "")
  const short =
    kind === "built-in" && part
      ? part
          .replace(/\((R|TM)\)|®|™/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : name
  return { id: deviceId, name, detail, short, kind }
}

/**
 * The microphones to choose from, and which one the system uses by default. Chrome hides the labels until
 * the microphone may be used: then there is nothing to show.
 */
export function micDevices(devices: Array<{ kind: string; deviceId: string; groupId: string; label: string }>): {
  devices: MicDevice[]
  defaultId: string | null
} {
  const inputs = devices.filter((device) => device.kind === "audioinput" && device.label.trim() !== "")
  const real = inputs.filter((device) => !PSEUDO.has(device.deviceId))
  const fallback = inputs.find((device) => device.deviceId === "default")
  const chosen = (fallback && real.find((device) => device.groupId === fallback.groupId)) ?? real[0]
  return { devices: real.map((device) => micDevice(device.deviceId, device.label)), defaultId: chosen?.deviceId ?? null }
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
