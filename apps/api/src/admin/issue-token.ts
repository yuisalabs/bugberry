import { eq } from "drizzle-orm"
import { isEmailAllowed } from "../modules/auth/policy"
import type { Config } from "../config"
import type { Db } from "../db/client"
import { apiToken, user } from "../db/schema"
import { generateApiToken, hashToken } from "../lib/api-token"
import { newId } from "../lib/ids"
import { provisionNewUser } from "../modules/workspaces/provision"

export interface IssueTokenInput {
  email: string
  name?: string
  label?: string
}

export interface IssuedToken {
  userId: string
  email: string
  token: string
  createdUser: boolean
}

/**
 * Creates an API token from the command line, for automation. A new user gets a workspace of their
 * own (as admin), the same as someone signing up.
 */
export async function issueExtensionToken(
  db: Db,
  config: Pick<Config, "allowedEmailDomains" | "accountLimits">,
  input: IssueTokenInput,
): Promise<IssuedToken> {
  const email = input.email.trim().toLowerCase()
  if (!isEmailAllowed(email, config.allowedEmailDomains)) {
    throw new Error(`${email} is not in ALLOWED_EMAIL_DOMAINS`)
  }

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  let userId: string
  if (existing) {
    userId = existing.id
  } else {
    userId = newId()
    await db.insert(user).values({
      id: userId,
      email,
      name: input.name?.trim() || email.split("@")[0] || email,
      emailVerified: true,
    })
  }

  const token = generateApiToken()
  await db.insert(apiToken).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    label: input.label?.trim() || "Chrome extension (CLI)",
  })
  if (!existing) await provisionNewUser(db, { id: userId, name: input.name?.trim() || email.split("@")[0] || email, email }, config.accountLimits)
  return { userId, email, token, createdUser: !existing }
}
