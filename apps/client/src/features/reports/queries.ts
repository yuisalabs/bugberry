/**
 * Report lists carry signed preview links that expire (READ_URL_TTL_SECONDS, an hour by default), so a
 * list left open is refreshed well before that.
 */
export const REPORT_LIST_REFRESH_MS = 5 * 60_000

/**
 * A report list is fresh for a minute: switching back to the window within that time doesn't fetch every part
 * shown again. Changes made here invalidate it at once.
 */
export const REPORT_LIST_STALE_MS = 60_000
