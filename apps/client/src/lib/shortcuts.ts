/** Enough of `navigator` to tell the system; Chromium's userAgentData is newer and preferred when present. */
export interface PlatformInfo {
  platform: string
  userAgentData?: { platform: string }
}

/** Macs (and iPads) use ⌘ where Windows and Linux use Ctrl. */
export function isMacPlatform(info: PlatformInfo = navigator as PlatformInfo): boolean {
  return /mac|iphone|ipad/i.test(info.userAgentData?.platform || info.platform)
}

/** Focuses "Search reports" on the report list. */
export function searchShortcut(mac: boolean): string {
  return mac ? "⌘K" : "Ctrl K"
}
