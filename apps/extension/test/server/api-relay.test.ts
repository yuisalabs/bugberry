import { describe, expect, mock, test } from "bun:test"
import { type ApiFetchRequest, handleApiFetch, isApiFetchRequest, relayFetcher } from "../../lib/server/api-relay"
import { createBugberryApi } from "../../lib/server/api"

const SERVER = "https://bugberry.kantor.test"

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

describe("relayFetcher", () => {
  test("hands the request to the background and rebuilds its answer", async () => {
    const send = mock(async (_request: ApiFetchRequest) => ({
      ok: true,
      status: 201,
      headers: [["content-type", "application/json"]],
      body: '{"id":"r1"}',
    }))
    const response = await relayFetcher(send)(`${SERVER}/api/reports/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"title":"x"}',
    })
    expect(send).toHaveBeenCalledWith({
      type: "bugberry:api-fetch",
      url: `${SERVER}/api/reports/uploads`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"title":"x"}',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: "r1" })
  })

  test("a relay that could not reach the server is a network failure", async () => {
    const fetcher = relayFetcher(async () => ({ ok: false, error: "Can't reach" }))
    await expect(fetcher(`${SERVER}/api/me`)).rejects.toThrow("Can't reach")
  })
})

describe("handleApiFetch", () => {
  const request: ApiFetchRequest = { type: "bugberry:api-fetch", url: `${SERVER}/api/me`, method: "GET", headers: {}, body: null }

  test("fetches the extension's server with the sign-in cookie and returns status, headers and body", async () => {
    const fetcher = mock(async (_url: string, _init?: RequestInit) => json({ email: "ana@kantor.test" }))
    const reply = await handleApiFetch(request, SERVER, fetcher as unknown as typeof fetch)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "include" })
    expect(reply).toMatchObject({ ok: true, status: 200, body: '{"email":"ana@kantor.test"}' })
  })

  test("only the server the extension sends to: another address is refused", async () => {
    const fetcher = mock(async () => json({}))
    const elsewhere = { ...request, url: "https://evil.test/api/me" }
    expect(await handleApiFetch(elsewhere, SERVER, fetcher as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "Not this extension's BugBerry server",
    })
    expect(await handleApiFetch(request, null, fetcher as unknown as typeof fetch)).toMatchObject({ ok: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("a failed fetch is a failure, not a throw", async () => {
    const reply = await handleApiFetch(request, SERVER, (async () => {
      throw new TypeError("NetworkError")
    }) as unknown as typeof fetch)
    expect(reply).toEqual({ ok: false, error: "NetworkError" })
  })
})

test("isApiFetchRequest accepts only well-formed requests", () => {
  expect(isApiFetchRequest({ type: "bugberry:api-fetch", url: `${SERVER}/api/me`, method: "GET", headers: {}, body: null })).toBe(true)
  expect(isApiFetchRequest({ type: "bugberry:api-fetch", url: 5, method: "GET", headers: {}, body: null })).toBe(false)
  expect(isApiFetchRequest({ type: "bugberry:api-fetch", url: `${SERVER}/api/me`, method: "GET", headers: {}, body: {} })).toBe(false)
  expect(isApiFetchRequest({ type: "other" })).toBe(false)
})

test("the API client works through the relay end to end", async () => {
  const serverFetch = async (url: string) => (url.endsWith("/api/workspaces") ? json([{ id: "w1", name: "Ana's workspace" }]) : json({}, 404))
  const api = createBugberryApi(
    { serverUrl: SERVER },
    relayFetcher((relayed) => handleApiFetch(relayed, SERVER, serverFetch as unknown as typeof fetch)),
  )
  expect(await api.listWorkspaces()).toMatchObject([{ id: "w1", name: "Ana's workspace" }])
})
