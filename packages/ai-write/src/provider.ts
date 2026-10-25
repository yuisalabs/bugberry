import { AiWriteError } from "./errors"
import { buildMessages, type ChatMessage, parseWriteUp } from "./prompt"

/** An OpenAI-compatible provider: OpenAI itself, or any server with the same `/chat/completions`. */
export interface ProviderConfig {
  preset: "openai" | "custom"
  baseUrl: string
  model: string
  apiKey: string
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1"
export const REQUEST_TIMEOUT_MS = 30_000

/** The base URL as stored: a pasted `/chat/completions` endpoint or a trailing slash is dropped. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "")
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("That address isn't valid")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("That address isn't valid")
  return trimmed
}

interface ProviderErrorBody {
  error?: { code?: unknown; type?: unknown; message?: unknown }
}

function failure(status: number, body: ProviderErrorBody | null): AiWriteError {
  const code = typeof body?.error?.code === "string" ? body.error.code : typeof body?.error?.type === "string" ? body.error.type : ""
  const message = typeof body?.error?.message === "string" ? body.error.message : ""
  if (status === 401 || status === 403) return new AiWriteError("key_rejected")
  if (status === 402 || code === "insufficient_quota") return new AiWriteError("quota")
  if (code === "model_not_found" || (status === 404 && /model/i.test(message))) return new AiWriteError("model_not_found")
  if (status === 429 || status === 503) return new AiWriteError("busy")
  return new AiWriteError("provider_error", (message || `HTTP ${status}`).slice(0, 200))
}

/** One chat completion's text. Errors come back as AiWriteError, by what the reporter can do about them. */
export async function complete(
  provider: ProviderConfig,
  messages: ChatMessage[],
  fetcher: typeof fetch,
  opts: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages,
        // No temperature: OpenAI's newer models refuse any but their default. They also take
        // max_completion_tokens, which compatible servers don't know.
        ...(opts.maxTokens ? { [provider.preset === "openai" ? "max_completion_tokens" : "max_tokens"]: opts.maxTokens } : {}),
        // Many compatible servers reject response_format, so only OpenAI gets it.
        ...(provider.preset === "openai" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    })
  } catch {
    throw new AiWriteError("unreachable")
  } finally {
    clearTimeout(timer)
  }
  const body = (await response.json().catch(() => null)) as (ProviderErrorBody & { choices?: Array<{ message?: { content?: unknown } }> }) | null
  if (!response.ok) throw failure(response.status, body)
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new AiWriteError("unusable_answer")
  return content
}

/** A title and description drafted from the recording, with the template and the reporter's hint. */
export async function writeUp(
  provider: ProviderConfig,
  input: Parameters<typeof buildMessages>[0],
  fetcher: typeof fetch,
): Promise<{ title: string; description: string }> {
  return parseWriteUp(await complete(provider, buildMessages(input), fetcher))
}

/** Whether the provider answers with this key and model: a tiny request, run when a key is saved. */
export async function testProvider(provider: ProviderConfig, fetcher: typeof fetch): Promise<void> {
  await complete(provider, [{ role: "user", content: 'Reply with the JSON {"ok": true}.' }], fetcher, { maxTokens: 5 })
}
