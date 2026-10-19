import type { DeviceInfo } from "@bugberry/shared"

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/Firefox\/(\d+)/, "Firefox"],
  [/Chrome\/(\d+)/, "Chrome"],
  [/Version\/(\d+).*Safari/, "Safari"],
]

const SYSTEMS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/Windows NT/, () => "Windows"],
  [/CrOS/, () => "ChromeOS"],
  [/Android (\d+)/, (match) => `Android ${match[1]}`],
  [/(?:iPhone|iPad).*OS (\d+)/, (match) => `iOS ${match[1]}`],
  [/Mac OS X/, () => "macOS"],
  [/Linux/, () => "Linux"],
]

export function deviceInfoFrom(userAgent: string, viewport: { width?: number; height?: number }): DeviceInfo {
  let browser = "Unknown browser"
  for (const [pattern, name] of BROWSERS) {
    const match = userAgent.match(pattern)
    if (match) {
      browser = `${name} ${match[1]}`
      break
    }
  }
  let os = "Unknown OS"
  for (const [pattern, label] of SYSTEMS) {
    const match = userAgent.match(pattern)
    if (match) {
      os = label(match)
      break
    }
  }
  const size = viewport.width && viewport.height ? `${viewport.width}x${viewport.height}` : "unknown"
  return { browser, os, viewport: size }
}
