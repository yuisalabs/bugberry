export const APP_NAME_MAX = 60
const FALLBACK = "AI app"

/**
 * An OAuth app's name, safe to show and store. Anyone can register an app with any name, and it ends up
 * on the consent page, in "via AI" badges and in mention emails: control and format characters (line
 * breaks, bidi overrides, zero-width) are dropped, whitespace is folded, and long names are cut.
 */
export function cleanAppName(name: string | null | undefined): string {
  const cleaned = (name ?? "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, (match) => (/[\t\n\r]/.test(match) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return FALLBACK
  return cleaned.length > APP_NAME_MAX ? `${cleaned.slice(0, APP_NAME_MAX - 1)}…` : cleaned
}
