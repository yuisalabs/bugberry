import { eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { user } from "../db/schema"

/** Marks an existing account as exempt from ACCOUNT_LIMITS, or takes the exemption away. */
export async function setUnlimited(
  db: Db,
  email: string,
  unlimited: boolean,
): Promise<{ userId: string; email: string; unlimited: boolean }> {
  const normalized = email.trim().toLowerCase()
  const [row] = await db
    .update(user)
    .set({ unlimited })
    .where(eq(user.email, normalized))
    .returning({ userId: user.id, email: user.email, unlimited: user.unlimited })
  if (!row) throw new Error(`No account with the email ${normalized}`)
  return row
}
