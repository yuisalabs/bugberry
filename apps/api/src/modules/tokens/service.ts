import type { Db } from "../../db/client"
import { conflict, notFound } from "../../lib/errors"
import { countActiveMcpTokens, insertMcpToken, revokeMcpToken } from "./repository"
import { generateApiToken, hashToken } from "./token"

const MAX_ACTIVE_TOKENS = 25

/** A new MCP token: only its hash is stored, so the secret is shown this once. */
export async function createMcpToken(db: Db, userId: string, label: string) {
  if ((await countActiveMcpTokens(db, userId)) >= MAX_ACTIVE_TOKENS) throw conflict("too_many_tokens", "Revoke a token before making another")
  const token = generateApiToken()
  const row = await insertMcpToken(db, { userId, tokenHash: hashToken(token), label: label.trim() })
  if (!row) throw new Error("failed to insert token")
  return { ...row, token }
}

export async function revokeToken(db: Db, userId: string, tokenId: string) {
  if (!(await revokeMcpToken(db, userId, tokenId))) throw notFound("token_not_found", "Token not found")
  return { ok: true }
}
