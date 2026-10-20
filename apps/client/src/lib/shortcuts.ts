/** Enough of `navigator` to tell the system; Chromium's userAgentData is newer and preferred when present. */
export interface PlatformInfo {
  platform: string
  userAgentData?: { platform: string }
}

/** Macs (and iPads) use ⌘ where Windows and Linux use Ctrl. */
export function isMacPlatform(info: PlatformInfo = navigator as PlatformInfo): boolean {
  return /mac|iphone|ipad/i.test(info.userAgentData?.platform || info.platform)
}

/** Firefox, not Chrome or a Chromium browser (Opera's user agent says Chrome too, never Firefox). */
export function isFirefox(userAgent: string = navigator.userAgent): boolean {
  return /Firefox\/\d+/.test(userAgent)
}

/** The extension's "Open BugBerry" shortcut, as its manifest suggests it; Firefox's Ctrl+Shift+K is its Web Console. */
export function openShortcut(mac: boolean, firefox = false): string {
  if (firefox) return mac ? "⌥⇧B" : "Alt+Shift+B"
  return mac ? "⌘⇧K" : "Ctrl+Shift+K"
}

/** Focuses "Search reports" on the report list. */
export function searchShortcut(mac: boolean): string {
  return mac ? "⌘K" : "Ctrl K"
}
