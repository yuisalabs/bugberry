/**
 * Firefox sends no sign-in cookie from an extension frame embedded in a web page (the review over the page):
 * the request counts as cross-site there. Such a frame hands its API requests to the background, which is a
 * top-level extension context and sends the cookie, the way the popup's requests do.
 */
export interface ApiFetchRequest {
  type: "bugberry:api-fetch"
  url: string
  method: string
  headers: Record<string, string>
  /** JSON text; the API takes no other body (files go to signed upload URLs, which need no cookie). */
  body: string | null
}

export type ApiFetchReply =
  | { ok: true; status: number; headers: Array<[string, string]>; body: string }
  | { ok: false; error: string }

export function isApiFetchRequest(message: unknown): message is ApiFetchRequest {
  if (typeof message !== "object" || message === null) return false
  const value = message as Record<string, unknown>
  return (
    value.type === "bugberry:api-fetch" &&
    typeof value.url === "string" &&
    typeof value.method === "string" &&
    typeof value.headers === "object" &&
    value.headers !== null &&
    (value.body === null || typeof value.body === "string")
  )
}

/** A `fetch` for the API client that goes through the background. */
export function relayFetcher(send: (request: ApiFetchRequest) => Promise<unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
      throw new TypeError("Only JSON bodies go through the relay")
    }
    const request: ApiFetchRequest = {
      type: "bugberry:api-fetch",
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ?? null,
    }
    const reply = (await send(request)) as ApiFetchReply | undefined
    if (!reply?.ok) throw new TypeError(reply?.error ?? "No answer from the extension")
    return new Response(reply.body, { status: reply.status, headers: reply.headers })
  }) as typeof fetch
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The background's side: only to the server the extension sends to, so no page can use it to reach another. */
export async function handleApiFetch(request: ApiFetchRequest, serverUrl: string | null, fetcher: typeof fetch): Promise<ApiFetchReply> {
  let target: URL
  try {
    target = new URL(request.url)
    if (!serverUrl || target.origin !== new URL(serverUrl).origin) throw new Error()
  } catch {
    return { ok: false, error: "Not this extension's BugBerry server" }
  }
  try {
    const response = await fetcher(target.href, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: "include",
    })
    return { ok: true, status: response.status, headers: [...response.headers.entries()], body: await response.text() }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
