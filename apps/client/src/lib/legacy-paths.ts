const MOVED = /^\/(p|r)\/.+|^\/settings(\/.*)?$/
/** Token pages, gone since the extension uses the dashboard sign-in. */
const RETIRED = new Set(["/app/settings/tokens", "/extension/connect"])

/**
 * The dashboard moved under /app when / became the landing page. Old links (issues in trackers,
 * bookmarks, older extensions) keep working: /p/…, /r/… and /settings… get the /app prefix.
 * The retired token pages go to the dashboard itself.
 */
export function legacyAppPath(pathname: string): string | null {
  if (RETIRED.has(pathname)) return "/app"
  return MOVED.test(pathname) ? `/app${pathname}` : null
}
