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
import { and, asc, eq, inArray } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { ensureTemplates, listTemplates } from "../../ai/setup"
import { authPlugin } from "../../plugins/auth"
import { project, reportTemplate, workspace, workspaceAiProvider } from "../../db/schema"
import { AppError, conflict, notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { createHostGuard, HostGuardError } from "../../lib/net/host-guard"
import { createRateLimiter } from "../../lib/rate-limit"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { requireMember } from "../../workspaces/access"

const preset = t.Union([t.Literal("openai"), t.Literal("custom")])
const providerBody = t.Object({
  preset,
  baseUrl: t.Optional(t.String({ maxLength: 500 })),
  model: t.String({ minLength: 1, maxLength: 200 }),
  apiKey: t.Optional(t.String({ maxLength: 500 })),
})
const settingsBody = t.Object({
  sendResponseBodies: t.Optional(t.Boolean()),
  defaultTemplateId: t.Optional(t.Nullable(t.String())),
  projectDefaults: t.Optional(t.Array(t.Object({ projectId: t.String(), templateId: t.Nullable(t.String()) }), { maxItems: 500 })),
})
const line = t.Object({
  atMs: t.Number(),
  kind: t.Union([t.Literal("action"), t.Literal("navigate"), t.Literal("error"), t.Literal("request"), t.Literal("note")]),
  text: t.String({ maxLength: 5000 }),
  body: t.Optional(t.String({ maxLength: 20_000 })),
})
const writeBody = t.Object({
  templateId: t.String(),
  material: t.Object({
    page: t.Object({ url: t.String({ maxLength: 4000 }), title: t.Nullable(t.String({ maxLength: 1000 })) }),
    device: t.Object({ browser: t.String({ maxLength: 200 }), os: t.String({ maxLength: 200 }) }),
    lines: t.Array(line, { maxItems: 400 }),
    omitted: t.Integer({ minimum: 0 }),
  }),
  hint: t.Object({ title: t.String({ maxLength: 200 }), description: t.String({ maxLength: 5000 }) }),
})

/** Each write-up costs the workspace money at its provider. */
const WRITES_PER_MINUTE = 20

const templateFields = {
  name: t.String({ minLength: 1, maxLength: 80 }),
  skeleton: t.String({ maxLength: 4000 }),
  instructions: t.String({ maxLength: 2000 }),
}

/** "sk-…a1b2": enough for admins to tell keys apart, too little to use. */
export const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "…")

/** An AI failure as the API answers it: what happened and who can fix it. */
export function aiFailure(status: number, error: AiWriteError, model: string): AppError {
  return new AppError(status, `ai_${error.code}`, aiErrorText(error, { path: "team", model }))
}

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

  const storedKey = async (workspaceId: string) =>
    (await db.select().from(workspaceAiProvider).where(eq(workspaceAiProvider.workspaceId, workspaceId)).limit(1))[0] ?? null

  const openKey = (sealed: string) => {
    try {
      return box.open(sealed)
    } catch (error) {
      if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
      throw error
    }
  }

  const teamView = (key: typeof workspaceAiProvider.$inferSelect | null, role: "admin" | "member") =>
    !key
      ? { configured: false }
      : role === "admin"
        ? { configured: true, preset: key.preset, baseUrl: key.baseUrl, model: key.model, keyHint: key.keyHint }
        : { configured: true }

  /** What the dashboard and the extension need; only admins see the key's address, model and hint. */
  const setupView = async (workspaceId: string, role: "admin" | "member") => {
    await ensureTemplates(db, workspaceId)
    const [settings] = await db
      .select({ sendResponseBodies: workspace.aiSendResponseBodies, defaultTemplateId: workspace.aiDefaultTemplateId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
    const projects = await db
      .select({ projectId: project.id, templateId: project.aiTemplateId })
      .from(project)
      .where(eq(project.workspaceId, workspaceId))
      .orderBy(asc(project.createdAt))
    return {
      team: teamView(await storedKey(workspaceId), role),
      sendResponseBodies: settings?.sendResponseBodies ?? false,
      defaultTemplateId: settings?.defaultTemplateId ?? null,
      projectDefaults: projects.filter((entry) => entry.templateId !== null),
      templates: await listTemplates(db, workspaceId),
      role,
    }
  }

  const findTemplate = async (workspaceId: string, templateId: string) => {
    const [row] = await db
      .select()
      .from(reportTemplate)
      .where(and(eq(reportTemplate.id, templateId), eq(reportTemplate.workspaceId, workspaceId)))
      .limit(1)
    if (!row) throw notFound("template_not_found", "Template not found")
    return row
  }

  const templateView = (row: typeof reportTemplate.$inferSelect) => ({
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
        const stored = await storedKey(params.id)
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
        const values = {
          preset: body.preset,
          baseUrl,
          model,
          keyEncrypted: typed ? box.seal(typed) : stored!.keyEncrypted,
          keyHint: typed ? keyHint(typed) : stored!.keyHint,
          updatedBy: user.id,
        }
        const [saved] = await db
          .insert(workspaceAiProvider)
          .values({ workspaceId: params.id, ...values })
          .onConflictDoUpdate({ target: workspaceAiProvider.workspaceId, set: values })
          .returning()
        return teamView(saved ?? null, "admin")
      },
      { auth: true, body: providerBody },
    )
    .delete(
      "/workspaces/:id/ai/provider",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        await db.delete(workspaceAiProvider).where(eq(workspaceAiProvider.workspaceId, params.id))
        return { configured: false }
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/ai/settings",
      async ({ user, params, body }) => {
        const role = await requireMember(db, user.id, params.id, "admin")
        await ensureTemplates(db, params.id)
        const templateIds = [
          ...(body.defaultTemplateId ? [body.defaultTemplateId] : []),
          ...(body.projectDefaults ?? []).flatMap((entry) => (entry.templateId ? [entry.templateId] : [])),
        ]
        if (templateIds.length > 0) {
          const found = await db
            .select({ id: reportTemplate.id })
            .from(reportTemplate)
            .where(and(eq(reportTemplate.workspaceId, params.id), inArray(reportTemplate.id, templateIds)))
          if (new Set(found.map((row) => row.id)).size !== new Set(templateIds).size) throw notFound("template_not_found", "Template not found")
        }
        const projectIds = (body.projectDefaults ?? []).map((entry) => entry.projectId)
        if (projectIds.length > 0) {
          const found = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.workspaceId, params.id), inArray(project.id, projectIds)))
          if (new Set(found.map((row) => row.id)).size !== new Set(projectIds).size) throw notFound("project_not_found", "Project not found")
        }
        await db.transaction(async (tx) => {
          const changes: Partial<typeof workspace.$inferInsert> = {}
          if (body.sendResponseBodies !== undefined) changes.aiSendResponseBodies = body.sendResponseBodies
          if (body.defaultTemplateId !== undefined) changes.aiDefaultTemplateId = body.defaultTemplateId
          if (Object.keys(changes).length > 0) await tx.update(workspace).set(changes).where(eq(workspace.id, params.id))
          for (const entry of body.projectDefaults ?? []) {
            await tx.update(project).set({ aiTemplateId: entry.templateId }).where(eq(project.id, entry.projectId))
          }
        })
        return setupView(params.id, role)
      },
      { auth: true, body: settingsBody },
    )
    .post(
      "/workspaces/:id/ai/templates",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        await ensureTemplates(db, params.id)
        const [created] = await db
          .insert(reportTemplate)
          .values({ id: newId(), workspaceId: params.id, name: body.name.trim(), skeleton: body.skeleton, instructions: body.instructions, createdBy: user.id })
          .returning()
        if (!created) throw new Error("Failed to create template")
        return templateView(created)
      },
      { auth: true, body: t.Object(templateFields) },
    )
    .patch(
      "/workspaces/:id/ai/templates/:templateId",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        await findTemplate(params.id, params.templateId)
        const changes: Partial<typeof reportTemplate.$inferInsert> = {}
        if (body.name !== undefined) changes.name = body.name.trim()
        if (body.skeleton !== undefined) changes.skeleton = body.skeleton
        if (body.instructions !== undefined) changes.instructions = body.instructions
        const [updated] = await db.update(reportTemplate).set(changes).where(eq(reportTemplate.id, params.templateId)).returning()
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
        const key = await storedKey(params.id)
        if (!key) throw conflict("ai_not_configured", "AI writing isn't set up for this workspace.")
        const template = await findTemplate(params.id, body.templateId)
        const [settings] = await db
          .select({ sendResponseBodies: workspace.aiSendResponseBodies })
          .from(workspace)
          .where(eq(workspace.id, params.id))
          .limit(1)
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
        await findTemplate(params.id, params.templateId)
        // Defaults that pointed at it go back to null (ON DELETE SET NULL).
        await db.delete(reportTemplate).where(eq(reportTemplate.id, params.templateId))
        return { deleted: true }
      },
      { auth: true },
    )
}
