import { describe, expect, jest, test } from "bun:test"
import type { ProviderConfig } from "@bugberry/ai-write"
import { type AiKeyStorage, readStoredKey } from "../../lib/ai/ai-key"
import { type AiWriteRequest, handleAiTest, handleAiWrite, isAiTestRequest, isAiWriteRequest } from "../../lib/ai/ai-relay"

const okChoice = { choices: [{ message: { content: '{"title":"T","description":"D"}' } }] }
const local: ProviderConfig = { preset: "custom", baseUrl: "http://localhost:11434/v1", model: "q", apiKey: "k" }

function memoryStorage(initial: ProviderConfig | null): AiKeyStorage & { value: ProviderConfig | null } {
  const box = {
    value: initial,
    get: async () => box.value,
    set: async (next: ProviderConfig) => {
      box.value = next
    },
    clear: async () => {
      box.value = null
    },
  }
  return box
}

function fakeFetch(seen: Request[], status: number, body: unknown): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(url, init))
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

const writeRequest: AiWriteRequest = {
  type: "bugberry:ai-write",
  material: { page: { url: "https://a.test/?email=x@y.z", title: null }, device: { browser: "Chrome", os: "Linux" }, omitted: 0, lines: [] },
  template: { skeleton: "## Steps", instructions: "" },
  hint: { title: "", description: "pay fails" },
}

describe("handleAiWrite", () => {
  test("writes with the stored personal key, straight to a localhost provider", async () => {
    const seen: Request[] = []
    const reply = await handleAiWrite(writeRequest, memoryStorage(local), fakeFetch(seen, 200, okChoice))
    expect(reply).toEqual({ ok: true, title: "T", description: "D" })
    expect(seen[0]?.url).toBe("http://localhost:11434/v1/chat/completions")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer k")
    const sent = JSON.stringify(await seen[0]!.json())
    expect(sent).toContain("pay fails")
    // The material is restricted again here: no query strings reach the provider.
    expect(sent).not.toContain("x@y.z")
  })

  test("an unreachable local provider answers the unreachable text", async () => {
    const throws = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    expect(await handleAiWrite(writeRequest, memoryStorage(local), throws)).toEqual({ ok: false, error: "The AI server didn't answer. Try again." })
  })

  test("a rejected personal key points to the extension's settings", async () => {
    expect(await handleAiWrite(writeRequest, memoryStorage(local), fakeFetch([], 401, {}))).toEqual({
      ok: false,
      error: "The AI key was rejected. Update it in the extension's settings.",
    })
  })

  test("no stored key answers plainly", async () => {
    expect(await handleAiWrite(writeRequest, memoryStorage(null), fakeFetch([], 200, okChoice))).toEqual({ ok: false, error: "No personal AI key is set." })
  })
})

test("the reporter's own provider gets longer than the server's 30 seconds", async () => {
  jest.useFakeTimers()
  try {
    let release: () => void = () => {}
    const slow = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        release = () => resolve(new Response(JSON.stringify(okChoice), { status: 200 }))
      })) as typeof fetch
    const pending = handleAiWrite(writeRequest, memoryStorage(local), slow)
    await Promise.resolve()
    jest.advanceTimersByTime(60_000)
    release()
    expect(await pending).toEqual({ ok: true, title: "T", description: "D" })
  } finally {
    jest.useRealTimers()
  }
})

describe("handleAiTest", () => {
  test("a working key comes back tidied, ready to store", async () => {
    const seen: Request[] = []
    const reply = await handleAiTest(
      { type: "bugberry:ai-test", provider: { ...local, baseUrl: "http://localhost:11434/v1/chat/completions/" } },
      fakeFetch(seen, 200, { choices: [{ message: { content: "ok" } }] }),
    )
    expect(reply).toEqual({ ok: true, provider: local })
    expect(seen[0]?.url).toBe("http://localhost:11434/v1/chat/completions")
  })

  test("the OpenAI preset always uses OpenAI's address", async () => {
    const reply = await handleAiTest(
      { type: "bugberry:ai-test", provider: { preset: "openai", baseUrl: "", model: "gpt-4.1-mini", apiKey: "sk-1" } },
      fakeFetch([], 200, { choices: [{ message: { content: "" } }] }),
    )
    expect(reply).toEqual({ ok: true, provider: { preset: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "sk-1" } })
  })

  test("a bad address or a failing provider says why", async () => {
    expect(await handleAiTest({ type: "bugberry:ai-test", provider: { ...local, baseUrl: "ftp://x" } }, fakeFetch([], 200, {}))).toEqual({
      ok: false,
      error: "That address isn't valid",
    })
    expect(await handleAiTest({ type: "bugberry:ai-test", provider: local }, fakeFetch([], 404, { error: { code: "model_not_found" } }))).toEqual({
      ok: false,
      error: 'The model "q" wasn\'t found at this provider.',
    })
  })
})

test("only well-formed messages are taken", () => {
  expect(isAiWriteRequest(writeRequest)).toBe(true)
  expect(isAiWriteRequest({ type: "bugberry:ai-write" })).toBe(false)
  expect(isAiTestRequest({ type: "bugberry:ai-test", provider: local })).toBe(true)
  expect(isAiTestRequest({ type: "bugberry:ai-test", provider: { baseUrl: 1 } })).toBe(false)
})

test("a stored value of the wrong shape counts as no key", () => {
  expect(readStoredKey(local)).toEqual(local)
  expect(readStoredKey({ preset: "custom", baseUrl: "x" })).toBeNull()
  expect(readStoredKey(undefined)).toBeNull()
})
