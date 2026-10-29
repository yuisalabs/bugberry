import { BUILT_IN_TEMPLATES } from "@bugberry/ai-write"
import { type Db, withTransaction } from "../../db/client"
import { newId } from "../../lib/ids"
import { claimTemplateSeeding, insertTemplates, listTemplateRows, updateAiSettings } from "./repository"

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
  await withTransaction(db, async () => {
    if (!(await claimTemplateSeeding(db, workspaceId))) return
    const rows = BUILT_IN_TEMPLATES.map((template) => ({ id: newId(), workspaceId, ...template }))
    await insertTemplates(db, rows)
    await updateAiSettings(db, workspaceId, { aiDefaultTemplateId: rows[0]?.id ?? null })
  })
}

export function listTemplates(db: Db, workspaceId: string): Promise<TemplateRow[]> {
  return listTemplateRows(db, workspaceId)
}

export { templateFor } from "@bugberry/ai-write"
