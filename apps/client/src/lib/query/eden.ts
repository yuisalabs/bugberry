import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"

/**
 * The typed API client, on the page's own origin so the session cookie goes along. `fetch` is looked up on every
 * call, so a test that replaces it reaches this client too.
 */
export const eden = treaty<App>(window.location.origin, {
  fetcher: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch,
})
