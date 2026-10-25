import { asc, eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { ensureTemplates, listTemplates } from "../../ai/setup"
import { authPlugin } from "../../auth/plugin"
import { project, workspace, workspaceAiProvider } from "../../db/schema"
import { requireMember } from "../../workspaces/access"

/** Write with AI: the workspace's own key (BYOK), its settings and its shared templates. */
export function aiModule(deps: AppDeps) {
  const { db } = deps

  /** What the dashboard and the extension need; only admins see the key's address, model and hint. */
  const setupView = async (workspaceId: string, role: "admin" | "member") => {
    await ensureTemplates(db, workspaceId)
    const [settings] = await db
      .select({ sendResponseBodies: workspace.aiSendResponseBodies, defaultTemplateId: workspace.aiDefaultTemplateId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
    const [key] = await db.select().from(workspaceAiProvider).where(eq(workspaceAiProvider.workspaceId, workspaceId)).limit(1)
    const projects = await db
      .select({ projectId: project.id, templateId: project.aiTemplateId })
      .from(project)
      .where(eq(project.workspaceId, workspaceId))
      .orderBy(asc(project.createdAt))
    const team = !key
      ? { configured: false }
      : role === "admin"
        ? { configured: true, preset: key.preset, baseUrl: key.baseUrl, model: key.model, keyHint: key.keyHint }
        : { configured: true }
    return {
      team,
      sendResponseBodies: settings?.sendResponseBodies ?? false,
      defaultTemplateId: settings?.defaultTemplateId ?? null,
      projectDefaults: projects.filter((entry) => entry.templateId !== null),
      templates: await listTemplates(db, workspaceId),
      role,
    }
  }

  return new Elysia().use(authPlugin(deps)).get(
    "/workspaces/:id/ai",
    async ({ user, params }) => {
      const role = await requireMember(db, user.id, params.id)
      return setupView(params.id, role)
    },
    { auth: true },
  )
}
