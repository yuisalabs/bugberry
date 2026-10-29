import { BUILT_IN_TEMPLATES } from "@bugberry/ai-write"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { Db } from "../../db/client"
import { reportTemplate, workspace } from "../../db/schema"
import { newId } from "../../lib/ids"

export interface TemplateRow {
  id: string
  name: string
  skeleton: string
  instructions: string
  updatedAt: Date
}

export interface AiSetup {
  defaultTemplateId: string | null
  projectDefaults: Array<{ projectId: string; templateId: string | null }>
  templates: TemplateRow[]
}

/**
 * Copies the built-in templates into the workspace the first time its AI setup is read, and makes the first one
 * the default. Only once: a workspace that deleted them all keeps none.
 */
export async function ensureTemplates(db: Db, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(workspace)
      .set({ aiTemplatesSeededAt: new Date() })
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.aiTemplatesSeededAt)))
      .returning({ id: workspace.id })
    if (!claimed) return
    const rows = BUILT_IN_TEMPLATES.map((template) => ({ id: newId(), workspaceId, ...template }))
    await tx.insert(reportTemplate).values(rows)
    await tx.update(workspace).set({ aiDefaultTemplateId: rows[0]?.id ?? null }).where(eq(workspace.id, workspaceId))
  })
}

export async function listTemplates(db: Db, workspaceId: string): Promise<TemplateRow[]> {
  return db
    .select({
      id: reportTemplate.id,
      name: reportTemplate.name,
      skeleton: reportTemplate.skeleton,
      instructions: reportTemplate.instructions,
      updatedAt: reportTemplate.updatedAt,
    })
    .from(reportTemplate)
    .where(eq(reportTemplate.workspaceId, workspaceId))
    .orderBy(asc(reportTemplate.createdAt), asc(reportTemplate.id))
}

export { templateFor } from "@bugberry/ai-write"
