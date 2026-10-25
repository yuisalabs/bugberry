import { describe, expect, test } from "bun:test"
import type { ChatMessage } from "../src/prompt"
import { complete, normalizeBaseUrl, OPENAI_BASE_URL, type ProviderConfig, testProvider, writeUp } from "../src/provider"

const okChoice = { choices: [{ message: { content: '{"title":"T","description":"D"}' } }] }
const messages: ChatMessage[] = [{ role: "user", content: "hi" }]
const provider: ProviderConfig = { preset: "custom", baseUrl: "https://ai.test/v1", model: "m", apiKey: "k" }
const input = {
  material: { page: { url: "https://a.test/", title: null }, device: { browser: "Chrome", os: "Linux" }, lines: [], omitted: 0 },
  template: { skeleton: "", instructions: "" },
  hint: { title: "", description: "" },
}

function fakeFetch(seen: Request[], status: number, body: unknown): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(url, init))
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

const neverAnswers = ((_url: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch

describe("writeUp", () => {
  test("posts to {baseUrl}/chat/completions with the key and model; json mode only for the OpenAI preset", async () => {
    const seen: Request[] = []
    const fetcher = fakeFetch(seen, 200, okChoice)
    expect(await writeUp({ preset: "openai", baseUrl: OPENAI_BASE_URL, model: "gpt-4.1-mini", apiKey: "sk-1" }, input, fetcher)).toEqual({ title: "T", description: "D" })
    await writeUp({ preset: "custom", baseUrl: "http://localhost:8080/v1", model: "q", apiKey: "k" }, input, fetcher)
    expect(seen[0]?.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer sk-1")
    const first = await seen[0]!.json()
    expect(first.model).toBe("gpt-4.1-mini")
    expect(first.response_format).toEqual({ type: "json_object" })
    expect(first.messages[0].role).toBe("system")
    // Newer OpenAI models refuse any temperature but their default.
    expect(first.temperature).toBeUndefined()
    expect(seen[1]?.url).toBe("http://localhost:8080/v1/chat/completions")
    expect((await seen[1]!.json()).response_format).toBeUndefined()
  })
})

describe("complete", () => {
  test.each([
    [401, {}, "key_rejected"],
    [403, {}, "key_rejected"],
    [429, { error: { code: "insufficient_quota" } }, "quota"],
    [402, {}, "quota"],
    [429, {}, "busy"],
    [503, {}, "busy"],
    [404, { error: { code: "model_not_found" } }, "model_not_found"],
    [400, { error: { code: "model_not_found" } }, "model_not_found"],
    [404, { error: { message: "model 'q' not found" } }, "model_not_found"],
    [404, {}, "provider_error"],
    [500, { error: { message: "boom" } }, "provider_error"],
  ])("status %i with %j maps to %s", async (status, body, code) => {
    await expect(complete(provider, messages, fakeFetch([], status, body))).rejects.toMatchObject({ code })
  })

  test("a provider error keeps its message as detail", async () => {
    await expect(complete(provider, messages, fakeFetch([], 500, { error: { message: "boom" } }))).rejects.toMatchObject({ detail: "boom" })
  })

  test("a 200 without a choice is an unusable answer", async () => {
    await expect(complete(provider, messages, fakeFetch([], 200, { choices: [] }))).rejects.toMatchObject({ code: "unusable_answer" })
  })

  test("a redirect is not followed: the request is sent with redirect manual and a 3xx is a provider error", async () => {
    const seen: Request[] = []
    const redirecting = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(url, init))
      return new Response(null, { status: 307, headers: { location: "http://169.254.169.254/" } })
    }) as typeof fetch
    await expect(complete(provider, messages, redirecting)).rejects.toMatchObject({ code: "provider_error" })
    expect(seen[0]?.redirect).toBe("manual")
  })

  test("a body that never finishes counts against the timeout", async () => {
    const stalling = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":'))
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")))
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    await expect(complete(provider, messages, stalling, { timeoutMs: 20 })).rejects.toMatchObject({ code: "unreachable" })
  })

  test("a huge body is not read past the cap", async () => {
    const huge = (async () => new Response("x".repeat(3_000_000), { status: 200 })) as unknown as typeof fetch
    await expect(complete(provider, messages, huge)).rejects.toMatchObject({ code: "unusable_answer" })
  })

  test("writeUp passes a longer timeout through", async () => {
    await expect(writeUp(provider, input, neverAnswers, { timeoutMs: 10 })).rejects.toMatchObject({ code: "unreachable" })
  })


  test("a network failure or a timeout is unreachable", async () => {
    const throws = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await expect(complete(provider, messages, throws)).rejects.toMatchObject({ code: "unreachable" })
    await expect(complete(provider, messages, neverAnswers, { timeoutMs: 10 })).rejects.toMatchObject({ code: "unreachable" })
  })
})

test("testProvider sends a tiny request and resolves on a reply with a choice", async () => {
  const seen: Request[] = []
  await testProvider(provider, fakeFetch(seen, 200, { choices: [{ message: { content: "ok" } }] }))
  expect((await seen[0]!.json()).max_tokens).toBe(5)
  // OpenAI's newer models take max_completion_tokens, and json mode needs the word JSON in the messages.
  await testProvider({ ...provider, preset: "openai" }, fakeFetch(seen, 200, { choices: [{ message: { content: "" } }] }))
  const openai = await seen[1]!.json()
  expect(openai.max_completion_tokens).toBe(5)
  expect(openai.max_tokens).toBeUndefined()
  expect(JSON.stringify(openai.messages)).toContain("JSON")
  await expect(testProvider(provider, fakeFetch([], 401, {}))).rejects.toMatchObject({ code: "key_rejected" })
})

test("normalizeBaseUrl accepts a pasted endpoint and refuses non-http", () => {
  expect(normalizeBaseUrl(" https://x.test/v1/chat/completions/ ")).toBe("https://x.test/v1")
  expect(normalizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1")
  expect(() => normalizeBaseUrl("ftp://x")).toThrow("That address isn't valid")
  expect(() => normalizeBaseUrl("not a url")).toThrow("That address isn't valid")
})
