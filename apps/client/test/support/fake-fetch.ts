let restoreLast: (() => void) | null = null

/** Answers every request through `answer` and records it, in place of the real fetch, until `restoreFetch()`. */
export function fakeFetch(answer: (request: Request) => Response | Promise<Response>): { requests: Request[] } {
  restoreFetch()
  const real = globalThis.fetch
  const requests: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return answer(request)
  }) as typeof fetch
  restoreLast = () => {
    globalThis.fetch = real
  }
  return { requests }
}

export function restoreFetch(): void {
  restoreLast?.()
  restoreLast = null
}
