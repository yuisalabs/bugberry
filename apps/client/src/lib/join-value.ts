/**
 * Whether pasted text could be an invite link or a whole code. Each lookup counts toward a small per-person
 * limit, so half-typed codes ("7KX") are never sent and never shown as "doesn't work".
 */
export function plausibleJoinValue(value: string): boolean {
  const text = value.trim()
  if (/\/(invite|join)\/[A-Za-z0-9_-]+/.test(text)) return true
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "").length === 7
}
