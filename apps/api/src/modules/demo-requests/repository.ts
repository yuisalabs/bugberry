import { type Db, executor } from "../../db/client"
import { demoRequest } from "../../db/schema"
import { newId } from "../../lib/ids"

export async function insertDemoRequest(db: Db, input: Omit<typeof demoRequest.$inferInsert, "id">): Promise<void> {
  await executor(db).insert(demoRequest).values({ id: newId(), ...input })
}
