import { eq, sql } from "drizzle-orm"
import type { Db } from "../../db/client"
import { workspace } from "../../db/schema"

type Executor = Pick<Db, "update">

/**
 * Takes the workspace's next report number. The update locks the workspace row until the
 * caller's transaction ends, so two uploads at once never get the same number.
 */
export async function claimReportNumber(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .update(workspace)
    .set({ nextReportNumber: sql`${workspace.nextReportNumber} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ next: workspace.nextReportNumber })
  if (!row) throw new Error("Workspace not found")
  return row.next - 1
}
