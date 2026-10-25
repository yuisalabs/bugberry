import {
  AiWriteError,
  aiErrorText,
  type Material,
  normalizeBaseUrl,
  OPENAI_BASE_URL,
  type ProviderConfig,
  restrictMaterial,
  type TemplateText,
  testProvider,
  writeUp,
} from "@bugberry/ai-write"
import type { AiKeyStorage } from "./ai-key"

/**
 * Write with AI on the reporter's own key. The background calls the provider itself: the key stays in this
 * browser, and a provider on localhost or the reporter's network is reachable from here (not from the server).
 */
export interface AiWriteRequest {
  type: "bugberry:ai-write"
  /** Already restricted by the review page; restricted again here. */
  material: Material
  template: TemplateText
  hint: { title: string; description: string }
  /** The workspace's response-bodies switch: it holds for personal keys too. */
  includeResponseBodies?: boolean
}

/** Checks a key before it is saved in the extension's settings. */
export interface AiTestRequest {
  type: "bugberry:ai-test"
  provider: ProviderConfig
}

export type AiReply = { ok: true; title: string; description: string } | { ok: false; error: string }
export type AiTestReply = { ok: true; provider: ProviderConfig } | { ok: false; error: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

export function isAiWriteRequest(message: unknown): message is AiWriteRequest {
  return (
    isObject(message) &&
    message.type === "bugberry:ai-write" &&
    isObject(message.material) &&
    Array.isArray(message.material.lines) &&
    isObject(message.template) &&
    isObject(message.hint)
  )
}

export function isAiTestRequest(message: unknown): message is AiTestRequest {
  if (!isObject(message) || message.type !== "bugberry:ai-test" || !isObject(message.provider)) return false
  const { preset, baseUrl, model, apiKey } = message.provider
  return (preset === "openai" || preset === "custom") && typeof baseUrl === "string" && typeof model === "string" && typeof apiKey === "string"
}

const messageOf = (error: unknown, model: string) =>
  error instanceof AiWriteError ? aiErrorText(error, { path: "personal", model }) : error instanceof Error ? error.message : String(error)

export async function handleAiWrite(request: AiWriteRequest, storage: AiKeyStorage, fetcher: typeof fetch): Promise<AiReply> {
  const provider = await storage.get()
  if (!provider) return { ok: false, error: "No personal AI key is set." }
  const material = restrictMaterial(request.material, { includeResponseBodies: request.includeResponseBodies ?? false })
  try {
    return { ok: true, ...(await writeUp(provider, { material, template: request.template, hint: request.hint }, fetcher)) }
  } catch (error) {
    return { ok: false, error: messageOf(error, provider.model) }
  }
}

export async function handleAiTest(request: AiTestRequest, fetcher: typeof fetch): Promise<AiTestReply> {
  let provider: ProviderConfig
  try {
    provider = {
      ...request.provider,
      baseUrl: request.provider.preset === "openai" ? OPENAI_BASE_URL : normalizeBaseUrl(request.provider.baseUrl),
      model: request.provider.model.trim(),
      apiKey: request.provider.apiKey.trim(),
    }
  } catch (error) {
    return { ok: false, error: messageOf(error, request.provider.model) }
  }
  try {
    await testProvider(provider, fetcher)
    return { ok: true, provider }
  } catch (error) {
    return { ok: false, error: messageOf(error, provider.model) }
  }
}
