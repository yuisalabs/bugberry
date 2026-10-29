import { AiWriteError, aiErrorText } from "@bugberry/ai-write"
import { type Db, withTransaction } from "../../db/client"
import { AppError, notFound } from "../../lib/errors"
import type { SettingsBody } from "./model"
import { projectsAmong, setProjectTemplate, templatesAmong, updateAiSettings } from "./repository"

/** "sk-…a1b2": enough for admins to tell keys apart, too little to use. */
export const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "…")

/** An AI failure as the API answers it: what happened and who can fix it. */
export function aiFailure(status: number, error: AiWriteError, model: string): AppError {
  return new AppError(status, `ai_${error.code}`, aiErrorText(error, { path: "team", model }))
}

/** The workspace's AI settings and project defaults; every template and project named must be the workspace's. */
export async function saveAiSettings(db: Db, workspaceId: string, body: SettingsBody): Promise<void> {
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
