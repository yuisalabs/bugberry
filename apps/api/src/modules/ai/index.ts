import { AiWriteError, normalizeBaseUrl, OPENAI_BASE_URL, type ProviderConfig, restrictMaterial, testProvider, writeUp } from "@bugberry/ai-write"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { ensureTemplates, listTemplates } from "./setup"
import { authPlugin } from "../../plugins/auth"
import { conflict, notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createHostGuard, HostGuardError } from "../../lib/net/host-guard"
import { createRateLimiter } from "../../lib/rate-limit"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { requireMember } from "../workspaces/access"
import { providerBody, settingsBody, templateFields, writeBody } from "./model"
import {
  type AiProviderRow,
  deleteAiProvider,
  deleteTemplate,
  findAiProvider,
  findAiSettings,
  findTemplate,
  insertTemplate,
  listProjectTemplates,
  saveAiProvider,
  type TemplateRecord,
  updateTemplate,
} from "./repository"
import { aiFailure, keyHint, saveAiSettings } from "./service"

/** Each write-up costs the workspace money at its provider. */
const WRITES_PER_MINUTE = 20

/** Write with AI: the workspace's own key (BYOK), its settings and its shared templates. */
export function aiModule(deps: AppDeps) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const guard = createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts, lookup: deps.aiLookup })
  /** Checked on every call, not only when the key is saved: a name can come to point inside later. */
  const checkHost = async (baseUrl: string) => {
    try {
      await guard(baseUrl)
    } catch (error) {
      if (error instanceof HostGuardError) throw unprocessable("ai_host_refused", error.message)
      throw error
    }
  }
  const aiFetch = deps.aiFetch ?? fetch
  const writes = createRateLimiter({ limit: WRITES_PER_MINUTE, windowMs: 60_000 })
  // Saving sends a test request: limited too, so it can't be used to probe addresses.
  const saves = createRateLimiter({ limit: 10, windowMs: 60_000 })

  const openKey = (sealed: string) => {
    try {
      return box.open(sealed)
    } catch (error) {
      if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
      throw error
    }
  }

  const teamView = (key: AiProviderRow | null, role: "admin" | "member") =>
    !key
      ? { configured: false }
      : role === "admin"
        ? { configured: true, preset: key.preset, baseUrl: key.baseUrl, model: key.model, keyHint: key.keyHint }
        : { configured: true }

  /** What the dashboard and the extension need; only admins see the key's address, model and hint. */
  const setupView = async (workspaceId: string, role: "admin" | "member") => {
    await ensureTemplates(db, workspaceId)
    const settings = await findAiSettings(db, workspaceId)
    const projects = await listProjectTemplates(db, workspaceId)
    return {
      team: teamView(await findAiProvider(db, workspaceId), role),
      sendResponseBodies: settings?.sendResponseBodies ?? false,
      defaultTemplateId: settings?.defaultTemplateId ?? null,
      projectDefaults: projects.filter((entry) => entry.templateId !== null),
      templates: await listTemplates(db, workspaceId),
      role,
    }
  }

  const templateOf = async (workspaceId: string, templateId: string) => {
    const row = await findTemplate(db, workspaceId, templateId)
    if (!row) throw notFound("template_not_found", "Template not found")
    return row
  }

  const templateView = (row: TemplateRecord) => ({
    id: row.id,
    name: row.name,
    skeleton: row.skeleton,
    instructions: row.instructions,
    updatedAt: row.updatedAt,
  })

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/ai",
      async ({ user, params }) => {
        const role = await requireMember(db, user.id, params.id)
        return setupView(params.id, role)
      },
      { auth: true },
    )
    .put(
      "/workspaces/:id/ai/provider",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        if (!saves.consume(user.id)) throw tooManyRequests()
        const stored = await findAiProvider(db, params.id)
        const typed = body.apiKey?.trim() ?? ""
        if (!typed && !stored) throw unprocessable("ai_key_required", "Enter the API key")
        let baseUrl = OPENAI_BASE_URL
        if (body.preset === "custom") {
          if (!body.baseUrl?.trim()) throw unprocessable("ai_base_url_required", "Enter the provider's base URL")
          try {
            baseUrl = normalizeBaseUrl(body.baseUrl)
          } catch (error) {
            throw unprocessable("ai_base_url_invalid", error instanceof Error ? error.message : "That address isn't valid")
          }
          await checkHost(baseUrl)
        }
        // The saved key only goes back to the address it was saved for: another admin can't send it elsewhere.
        if (!typed && stored && (stored.preset !== body.preset || stored.baseUrl !== baseUrl)) {
          throw unprocessable("ai_key_required", "Enter the API key again for a new provider address")
        }
        const apiKey = typed || openKey(stored!.keyEncrypted)
        const model = body.model.trim()
        const config: ProviderConfig = { preset: body.preset, baseUrl, model, apiKey }
        try {
          await testProvider(config, aiFetch)
        } catch (error) {
          if (error instanceof AiWriteError) throw aiFailure(422, error, model)
          throw error
        }
        const saved = await saveAiProvider(db, params.id, {
          preset: body.preset,
          baseUrl,
          model,
          keyEncrypted: typed ? box.seal(typed) : stored!.keyEncrypted,
          keyHint: typed ? keyHint(typed) : stored!.keyHint,
          updatedBy: user.id,
        })
        return teamView(saved, "admin")
      },
      { auth: true, body: providerBody },
    )
    .delete(
      "/workspaces/:id/ai/provider",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        await deleteAiProvider(db, params.id)
        return { configured: false }
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/ai/settings",
      async ({ user, params, body }) => {
        const role = await requireMember(db, user.id, params.id, "admin")
        await ensureTemplates(db, params.id)
        await saveAiSettings(db, params.id, body)
        return setupView(params.id, role)
      },
      { auth: true, body: settingsBody },
    )
    .post(
      "/workspaces/:id/ai/templates",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        await ensureTemplates(db, params.id)
        const created = await insertTemplate(db, {
          workspaceId: params.id,
          name: body.name.trim(),
          skeleton: body.skeleton,
          instructions: body.instructions,
          createdBy: user.id,
        })
        return templateView(created)
      },
      { auth: true, body: t.Object(templateFields) },
    )
    .patch(
      "/workspaces/:id/ai/templates/:templateId",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        await templateOf(params.id, params.templateId)
        const changes: { name?: string; skeleton?: string; instructions?: string } = {}
        if (body.name !== undefined) changes.name = body.name.trim()
        if (body.skeleton !== undefined) changes.skeleton = body.skeleton
        if (body.instructions !== undefined) changes.instructions = body.instructions
        const updated = await updateTemplate(db, params.templateId, changes)
        if (!updated) throw notFound("template_not_found", "Template not found")
        return templateView(updated)
      },
      { auth: true, body: t.Partial(t.Object(templateFields)) },
    )
    .post(
      "/workspaces/:id/ai/write",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        if (!writes.consume(user.id)) throw tooManyRequests()
        const key = await findAiProvider(db, params.id)
        if (!key) throw conflict("ai_not_configured", "AI writing isn't set up for this workspace.")
        const template = await templateOf(params.id, body.templateId)
        const settings = await findAiSettings(db, params.id)
        // The extension already applies these rules; the server doesn't take its word for it.
        const material = restrictMaterial(body.material, { includeResponseBodies: settings?.sendResponseBodies ?? false })
        if (key.preset === "custom") await checkHost(key.baseUrl)
        const provider: ProviderConfig = { preset: key.preset, baseUrl: key.baseUrl, model: key.model, apiKey: openKey(key.keyEncrypted) }
        try {
          return await writeUp(provider, { material, template, hint: body.hint }, aiFetch)
        } catch (error) {
          if (error instanceof AiWriteError) throw aiFailure(502, error, key.model)
          throw error
        }
      },
      { auth: true, body: writeBody },
    )
    .delete(
      "/workspaces/:id/ai/templates/:templateId",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id)
        await templateOf(params.id, params.templateId)
        await deleteTemplate(db, params.templateId)
        return { deleted: true }
      },
      { auth: true },
    )
}
