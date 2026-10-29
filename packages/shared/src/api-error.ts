/** An API call that failed, with the server's `{ code, message }` when it answered. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The whole error body, for answers that carry more than code and message (use_share_link). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "ApiError"
  }

  /** How long the request waited for this answer (the dashboard's 504 page shows it). */
  waitedMs: number | null = null

  /** Network failures, rate limits, server errors and not-yet-visible uploads may succeed on a later try. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.code === "upload_incomplete"
  }
}

/** Each app's own words for a failed call: the dashboard and the extension say it differently. */
export interface UnwrapText {
  network: string
  /** For an answer that carries no message. */
  fallback: string
  /** Replaces the server's message for these codes. */
  messages?: Record<string, string>
}

export interface EdenResult<T> {
  data: T | null
  error: { status: unknown; value: unknown } | null
}

/** Resolves an Eden call to its data, or throws an ApiError worded with `text`. */
export async function unwrapWith<T>(text: UnwrapText, request: Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  const started = Date.now()
  let result: EdenResult<T>
  try {
    result = await request
  } catch {
    throw new ApiError(0, "network", text.network)
  }
  if (result.error) {
    // Eden reports a failed fetch as status 503 carrying the thrown Error, not a server response.
    if (result.error.value instanceof Error) throw new ApiError(0, "network", text.network)
    const body = (result.error.value ?? {}) as { code?: unknown; message?: unknown }
    const code = typeof body.code === "string" ? body.code : "error"
    const error = new ApiError(
      Number(result.error.status) || 0,
      code,
      text.messages?.[code] ?? (typeof body.message === "string" ? body.message : text.fallback),
      typeof body === "object" ? (body as Record<string, unknown>) : {},
    )
    error.waitedMs = Date.now() - started
    throw error
  }
  if (result.data === null || result.data === undefined) throw new ApiError(0, "empty", "The server sent an empty response")
  return result.data as NonNullable<T>
}
