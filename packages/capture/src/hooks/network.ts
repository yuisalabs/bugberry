import { sanitizeBody } from "../sanitize"

export function absoluteUrl(raw: string, baseHref: string): string {
  try {
    return new URL(raw, baseHref).toString()
  } catch {
    return raw
  }
}

/** Text of a request body we are able to show; binary and streamed bodies are skipped. */
export function bodyPreview(body: unknown, contentType: string | null | undefined): string | undefined {
  if (typeof body === "string") return sanitizeBody(body, contentType ?? "text/plain")
  if (body instanceof URLSearchParams) return sanitizeBody(body.toString(), "application/x-www-form-urlencoded")
  return undefined
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
