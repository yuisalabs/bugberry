const dateTimeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" })
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" })
const clockFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

export function formatDateTime(value: Date | string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormat.format(date)
}

/** "Oct 3, 2026". */
export function formatDate(value: Date | string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : dateFormat.format(date)
}

/** "17 October 2026, 14:22 GMT+7", in the viewer's time zone unless one is given. */
export function formatTimestamp(value: Date | string | number, timeZone?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""
  // Some engines write UTC as "GMT+0"; browsers write "GMT".
  const zone = part("timeZoneName").replace(/^GMT\+0$/, "GMT")
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${zone}`
}

export function formatClock(t: number): string {
  const date = new Date(t)
  return Number.isNaN(date.getTime()) ? "-" : clockFormat.format(date)
}

/** Signed `m:ss` (or `h:mm:ss`) offset of an event from the capture moment, e.g. "-0:12". */
export function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000)
  const sign = ms < 0 && totalSeconds > 0 ? "-" : ""
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return hours > 0 ? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${sign}${minutes}:${seconds}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-"
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** A recording's length as `m:ss` (or `h:mm:ss`), e.g. "0:22". */
export function formatLength(ms: number): string {
  return formatOffset(Math.max(0, ms))
}

const shortDate = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" })
const shortDateWithYear = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" })
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"} ago`

/** "just now", "5 minutes ago", "17 hours ago", then "Oct 9" (or "Oct 9, 2025" in another year). */
export function formatRelative(value: Date | string | number, now: number): string {
  const date = new Date(value)
  const time = date.getTime()
  if (Number.isNaN(time)) return "-"
  const age = now - time
  if (age < MINUTE) return "just now"
  if (age < HOUR) return plural(Math.floor(age / MINUTE), "minute")
  if (age < DAY) return plural(Math.floor(age / HOUR), "hour")
  const format = date.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateWithYear
  return format.format(date)
}
