import {
  AiWriteError,
  aiErrorText,
  normalizeBaseUrl,
  OPENAI_BASE_URL,
  type ProviderConfig,
  restrictMaterial,
  testProvider,
  writeUp,
} from "@bugberry/ai-write"
import { type Db, withTransaction } from "../../db/client"
import type { AppDeps } from "../../deps"
import { AppError, conflict, notFound, unprocessable } from "../../lib/errors"
import { createHostGuard, HostGuardError } from "../../lib/net/host-guard"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import type { providerBody, SettingsBody, templateFields, writeBody } from "./model"
import {
  type AiProviderRow,
  deleteAiProvider,
  deleteTemplate,
  findAiProvider,
  findAiSettings,
  findTemplate,
  insertTemplate,
  listProjectTemplates,
  projectsAmong,
  saveAiProvider,
  setProjectTemplate,
  type TemplateRecord,
  templatesAmong,
  updateAiSettings,
  updateTemplate,
} from "./repository"
import { ensureTemplates, listTemplates } from "./setup"

type ProviderBody = typeof providerBody.static
type WriteBody = typeof writeBody.static
type TemplateFields = { [K in keyof typeof templateFields]: (typeof templateFields)[K]["static"] }

/** "sk-…a1b2": enough for admins to tell keys apart, too little to use. */
export const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "…")

/** An AI failure as the API answers it: what happened and who can fix it. */
export function aiFailure(status: number, error: AiWriteError, model: string): AppError {
  return new AppError(status, `ai_${error.code}`, aiErrorText(error, { path: "team", model }))
}

/** The workspace's AI settings and project defaults; every template and project named must be the workspace's. */
async function saveAiSettings(db: Db, workspaceId: string, body: SettingsBody): Promise<void> {
  const templateIds = [
    ...(body.defaultTemplateId ? [body.defaultTemplateId] : []),
    ...(body.projectDefaults ?? []).flatMap((entry) => (entry.templateId ? [entry.templateId] : [])),
  ]
  if (templateIds.length > 0) {
    const found = await templatesAmong(db, workspaceId, templateIds)
    if (new Set(found).size !== new Set(templateIds).size) throw notFound("template_not_found", "Template not found")
  }
  const projectIds = (body.projectDefaults ?? []).map((entry) => entry.projectId)
  if (projectIds.length > 0) {
    const found = await projectsAmong(db, workspaceId, projectIds)
    if (new Set(found).size !== new Set(projectIds).size) throw notFound("project_not_found", "Project not found")
  }
  await withTransaction(db, async () => {
    const changes: { aiSendResponseBodies?: boolean; aiDefaultTemplateId?: string | null } = {}
    if (body.sendResponseBodies !== undefined) changes.aiSendResponseBodies = body.sendResponseBodies
    if (body.defaultTemplateId !== undefined) changes.aiDefaultTemplateId = body.defaultTemplateId
    if (Object.keys(changes).length > 0) await updateAiSettings(db, workspaceId, changes)
    for (const entry of body.projectDefaults ?? []) await setProjectTemplate(db, entry.projectId, entry.templateId)
  })
}

const teamView = (key: AiProviderRow | null, role: "admin" | "member") =>
  !key
    ? { configured: false }
    : role === "admin"
      ? { configured: true, preset: key.preset, baseUrl: key.baseUrl, model: key.model, keyHint: key.keyHint }
      : { configured: true }

const templateView = (row: TemplateRecord) => ({
  id: row.id,
  name: row.name,
  skeleton: row.skeleton,
  instructions: row.instructions,
  updatedAt: row.updatedAt,
})

/** Write with AI's rules: the workspace's own key (BYOK), its settings and its shared templates. */
export function createAiService(deps: Pick<AppDeps, "db" | "config" | "aiFetch" | "aiLookup">) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const guard = createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts, lookup: deps.aiLookup })
  const aiFetch = deps.aiFetch ?? fetch
  /** Checked on every call, not only when the key is saved: a name can come to point inside later. */
  const checkHost = async (baseUrl: string) => {
    try {
      await guard(baseUrl)
    } catch (error) {
      if (error instanceof HostGuardError) throw unprocessable("ai_host_refused", error.message)
      throw error
    }
  }
  const openKey = (sealed: string) => {
    try {
      return box.open(sealed)
    } catch (error) {
      if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
      throw error
    }
  }
  const templateOf = async (workspaceId: string, templateId: string) => {
    const row = await findTemplate(db, workspaceId, templateId)
    if (!row) throw notFound("template_not_found", "Template not found")
    return row
  }

  /** What the dashboard and the extension need; only admins see the key's address, model and hint. */
  const setup = async (workspaceId: string, role: "admin" | "member") => {
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

  return {
    setup,

    /** Tests the key against the provider before saving it. */
    async saveProvider(workspaceId: string, userId: string, body: ProviderBody) {
      const stored = await findAiProvider(db, workspaceId)
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
      const saved = await saveAiProvider(db, workspaceId, {
        preset: body.preset,
        baseUrl,
        model,
        keyEncrypted: typed ? box.seal(typed) : stored!.keyEncrypted,
        keyHint: typed ? keyHint(typed) : stored!.keyHint,
        updatedBy: userId,
      })
      return teamView(saved, "admin")
    },

    async removeProvider(workspaceId: string) {
      await deleteAiProvider(db, workspaceId)
      return { configured: false }
    },

    async saveSettings(workspaceId: string, role: "admin" | "member", body: SettingsBody) {
      await ensureTemplates(db, workspaceId)
      await saveAiSettings(db, workspaceId, body)
      return setup(workspaceId, role)
    },

    async createTemplate(workspaceId: string, userId: string, body: TemplateFields) {
      await ensureTemplates(db, workspaceId)
      const created = await insertTemplate(db, {
        workspaceId,
        name: body.name.trim(),
        skeleton: body.skeleton,
        instructions: body.instructions,
        createdBy: userId,
      })
      return templateView(created)
    },

    async changeTemplate(workspaceId: string, templateId: string, body: Partial<TemplateFields>) {
      await templateOf(workspaceId, templateId)
      const changes: { name?: string; skeleton?: string; instructions?: string } = {}
      if (body.name !== undefined) changes.name = body.name.trim()
      if (body.skeleton !== undefined) changes.skeleton = body.skeleton
      if (body.instructions !== undefined) changes.instructions = body.instructions
      const updated = await updateTemplate(db, templateId, changes)
      if (!updated) throw notFound("template_not_found", "Template not found")
      return templateView(updated)
    },

    async removeTemplate(workspaceId: string, templateId: string) {
      await templateOf(workspaceId, templateId)
      await deleteTemplate(db, templateId)
      return { deleted: true }
    },

    async write(workspaceId: string, body: WriteBody) {
      const key = await findAiProvider(db, workspaceId)
      if (!key) throw conflict("ai_not_configured", "AI writing isn't set up for this workspace.")
      const template = await templateOf(workspaceId, body.templateId)
      const settings = await findAiSettings(db, workspaceId)
      // The extension already applies these rules; the server doesn't take its word for it.
      const material = restrictMaterial(body.material, { includeResponseBodies: settings?.sendResponseBodies ?? false })
      if (key.preset === "custom") await checkHost(key.baseUrl)
      const apiKey = openKey(key.keyEncrypted)
      const provider: ProviderConfig = { preset: key.preset, baseUrl: key.baseUrl, model: key.model, apiKey }
      try {
        return await writeUp(provider, { material, template, hint: body.hint }, aiFetch)
      } catch (error) {
        if (error instanceof AiWriteError) throw aiFailure(502, error, key.model)
        throw error
      }
    },
  }
}
