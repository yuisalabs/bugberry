/** A fake AI provider: answers from a queue (200 with a short reply when empty) and keeps every request. */
export function fakeAi() {
  const requests: Request[] = []
  const replies: Array<{ status: number; body: unknown }> = []
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(url, init))
    const next = replies.shift() ?? { status: 200, body: okChoice('{"title":"T","description":"D"}') }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return { fetcher, requests, replies, last: () => requests.at(-1) }
}

export const okChoice = (content: string) => ({ choices: [{ message: { content } }] })
