import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { project, reportTemplate, workspace, workspaceAiProvider } from "../../db/schema"
import { newId } from "../../lib/ids"

export type AiProviderRow = typeof workspaceAiProvider.$inferSelect
export type TemplateRecord = typeof reportTemplate.$inferSelect

export async function findAiProvider(db: Db, workspaceId: string): Promise<AiProviderRow | null> {
  const [row] = await executor(db).select().from(workspaceAiProvider).where(eq(workspaceAiProvider.workspaceId, workspaceId)).limit(1)
  return row ?? null
}

export async function saveAiProvider(
  db: Db,
  workspaceId: string,
  values: Omit<typeof workspaceAiProvider.$inferInsert, "workspaceId">,
): Promise<AiProviderRow | null> {
  const [saved] = await executor(db)
    .insert(workspaceAiProvider)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: workspaceAiProvider.workspaceId, set: values })
    .returning()
  return saved ?? null
}

export async function deleteAiProvider(db: Db, workspaceId: string): Promise<void> {
  await executor(db).delete(workspaceAiProvider).where(eq(workspaceAiProvider.workspaceId, workspaceId))
}

export async function findAiSettings(db: Db, workspaceId: string) {
  const [settings] = await executor(db)
    .select({ sendResponseBodies: workspace.aiSendResponseBodies, defaultTemplateId: workspace.aiDefaultTemplateId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return settings ?? null
}

export async function updateAiSettings(
  db: Db,
  workspaceId: string,
  changes: Pick<Partial<typeof workspace.$inferInsert>, "aiSendResponseBodies" | "aiDefaultTemplateId">,
): Promise<void> {
  await executor(db).update(workspace).set(changes).where(eq(workspace.id, workspaceId))
}

/** Each project's own default template, oldest project first. */
export function listProjectTemplates(db: Db, workspaceId: string) {
  return executor(db)
    .select({ projectId: project.id, templateId: project.aiTemplateId })
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(asc(project.createdAt))
}

export async function setProjectTemplate(db: Db, projectId: string, templateId: string | null): Promise<void> {
  await executor(db).update(project).set({ aiTemplateId: templateId }).where(eq(project.id, projectId))
}

/** Which of these ids are the workspace's templates. */
export async function templatesAmong(db: Db, workspaceId: string, templateIds: string[]): Promise<string[]> {
  const found = await executor(db)
    .select({ id: reportTemplate.id })
    .from(reportTemplate)
    .where(and(eq(reportTemplate.workspaceId, workspaceId), inArray(reportTemplate.id, templateIds)))
  return found.map((row) => row.id)
}

/** Which of these ids are the workspace's projects. */
export async function projectsAmong(db: Db, workspaceId: string, projectIds: string[]): Promise<string[]> {
  const found = await executor(db)
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), inArray(project.id, projectIds)))
  return found.map((row) => row.id)
}

export async function findTemplate(db: Db, workspaceId: string, templateId: string): Promise<TemplateRecord | null> {
  const [row] = await executor(db)
    .select()
    .from(reportTemplate)
    .where(and(eq(reportTemplate.id, templateId), eq(reportTemplate.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

/** Oldest first. */
export function listTemplateRows(db: Db, workspaceId: string) {
  return executor(db)
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

export async function insertTemplate(db: Db, values: Omit<typeof reportTemplate.$inferInsert, "id">): Promise<TemplateRecord> {
  const [created] = await executor(db).insert(reportTemplate).values({ id: newId(), ...values }).returning()
  if (!created) throw new Error("Failed to create template")
  return created
}

export async function insertTemplates(db: Db, rows: Array<typeof reportTemplate.$inferInsert>): Promise<void> {
  await executor(db).insert(reportTemplate).values(rows)
}

export async function updateTemplate(
  db: Db,
  templateId: string,
  changes: Partial<typeof reportTemplate.$inferInsert>,
): Promise<TemplateRecord | null> {
  const [updated] = await executor(db).update(reportTemplate).set(changes).where(eq(reportTemplate.id, templateId)).returning()
  return updated ?? null
}

/** Defaults that pointed at it go back to null (ON DELETE SET NULL). */
export async function deleteTemplate(db: Db, templateId: string): Promise<void> {
  await executor(db).delete(reportTemplate).where(eq(reportTemplate.id, templateId))
}

/** Marks the workspace's templates as seeded; false when they already were. */
export async function claimTemplateSeeding(db: Db, workspaceId: string): Promise<boolean> {
  const [claimed] = await executor(db)
    .update(workspace)
    .set({ aiTemplatesSeededAt: new Date() })
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.aiTemplatesSeededAt)))
    .returning({ id: workspace.id })
  return claimed !== undefined
}
