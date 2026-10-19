import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { ApiError } from "./api"

const MAX_RETRIES = 2

/** Retries network and server errors; a 4xx answer will not change by asking again. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < MAX_RETRIES
}

export function createQueryClient(onUnauthorized: () => void): QueryClient {
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) onUnauthorized()
  }
  return new QueryClient({
    // Queries marked `meta: { signedOutIsFine: true }` (the public landing page asking who is there)
    // treat 401 as an answer, not as a session that ended.
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.signedOutIsFine === true) return
        onError(error)
      },
    }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
      mutations: { retry: false },
    },
  })
}
