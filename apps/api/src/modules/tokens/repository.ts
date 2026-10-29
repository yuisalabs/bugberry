import { and, count, desc, eq, isNull } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { apiToken, user } from "../../db/schema"
import { newId } from "../../lib/ids"

const mine = (userId: string) => and(eq(apiToken.userId, userId), eq(apiToken.kind, "mcp"), isNull(apiToken.revokedAt))

export function listActiveMcpTokens(db: Db, userId: string) {
  return executor(db)
    .select({ id: apiToken.id, label: apiToken.label, createdAt: apiToken.createdAt, lastUsedAt: apiToken.lastUsedAt })
    .from(apiToken)
    .where(mine(userId))
    .orderBy(desc(apiToken.createdAt), desc(apiToken.id))
}

export async function countActiveMcpTokens(db: Db, userId: string): Promise<number> {
  const [active] = await executor(db).select({ value: count() }).from(apiToken).where(mine(userId))
  return active?.value ?? 0
}

export async function insertMcpToken(db: Db, input: { userId: string; tokenHash: string; label: string }) {
  const [row] = await executor(db)
    .insert(apiToken)
    .values({ id: newId(), ...input, kind: "mcp" })
    .returning({ id: apiToken.id, label: apiToken.label, createdAt: apiToken.createdAt })
  return row
}

/** True when the person had that active MCP token. */
export async function revokeMcpToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const revoked = await executor(db)
    .update(apiToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiToken.id, tokenId), mine(userId)))
    .returning({ id: apiToken.id })
  return revoked.length > 0
}

/** The signed-in person behind an unrevoked token, with the token's id, kind and last use. */
export async function findActiveTokenCaller(db: Db, tokenHash: string) {
  const [row] = await executor(db)
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      lastWorkspaceId: user.lastWorkspaceId,
      tokenId: apiToken.id,
      lastUsedAt: apiToken.lastUsedAt,
      kind: apiToken.kind,
    })
    .from(apiToken)
    .innerJoin(user, eq(apiToken.userId, user.id))
    .where(and(eq(apiToken.tokenHash, tokenHash), isNull(apiToken.revokedAt)))
    .limit(1)
  return row ?? null
}

export async function touchTokenLastUsed(db: Db, tokenId: string, at: Date): Promise<void> {
  await executor(db).update(apiToken).set({ lastUsedAt: at }).where(eq(apiToken.id, tokenId))
}
