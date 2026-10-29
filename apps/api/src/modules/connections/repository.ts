import { and, asc, eq, inArray } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { connection, integration, project } from "../../db/schema"
import { newId } from "../../lib/ids"

export type ConnectionRow = typeof connection.$inferSelect

/** Oldest first. */
export function listConnections(db: Db, workspaceId: string): Promise<ConnectionRow[]> {
  return executor(db).select().from(connection).where(eq(connection.workspaceId, workspaceId)).orderBy(asc(connection.createdAt))
}

export async function findConnection(db: Db, workspaceId: string, connectionId: string): Promise<ConnectionRow | null> {
  const [row] = await executor(db)
    .select()
    .from(connection)
    .where(and(eq(connection.id, connectionId), eq(connection.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

export async function insertConnection(db: Db, values: Omit<typeof connection.$inferInsert, "id">): Promise<ConnectionRow> {
  const [created] = await executor(db).insert(connection).values({ id: newId(), ...values }).returning()
  if (!created) throw new Error("Failed to create connection")
  return created
}

export async function updateConnection(
  db: Db,
  connectionId: string,
  changes: Partial<typeof connection.$inferInsert>,
): Promise<ConnectionRow | null> {
  const [updated] = await executor(db).update(connection).set(changes).where(eq(connection.id, connectionId)).returning()
  return updated ?? null
}

/** Its uses go with it; links to issues already sent stay (report_external_link.integration_id is set null). */
export async function deleteConnection(db: Db, connectionId: string): Promise<void> {
  await executor(db).delete(connection).where(eq(connection.id, connectionId))
}

/** Which projects use these connections, and how each use last went. */
export function listConnectionUses(db: Db, connectionIds: string[]) {
  return executor(db)
    .select({
      connectionId: integration.connectionId,
      projectId: integration.projectId,
      projectName: project.name,
      lastError: integration.lastError,
      lastDeliveredAt: integration.lastDeliveredAt,
      updatedAt: integration.updatedAt,
    })
    .from(integration)
    .innerJoin(project, eq(project.id, integration.projectId))
    .where(inArray(integration.connectionId, connectionIds))
}
