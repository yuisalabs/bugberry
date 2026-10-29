import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { eq, sql } from "drizzle-orm"
import { apiToken } from "../src/db/schema"
import { generateApiToken, hashToken } from "../src/modules/tokens/token"
import { newId } from "../src/lib/ids"
import { createUser, setupTestApp } from "./helpers"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

describe("revoke_api_tokens migration", () => {
  test("the migration revokes every live token and keeps revoked dates", async () => {
    const { db } = await setupTestApp()
    const owner = await createUser(db)
    const oldRevocation = new Date("2026-01-01T00:00:00Z")
    const live = newId()
    const revoked = newId()
    await db.insert(apiToken).values([
      { id: live, userId: owner.id, tokenHash: hashToken(generateApiToken()), label: "live" },
      { id: revoked, userId: owner.id, tokenHash: hashToken(generateApiToken()), label: "old", revokedAt: oldRevocation },
    ])

    const file = readdirSync(drizzleDir).find((name) => name.endsWith("_revoke_api_tokens.sql"))
    expect(file).toBeDefined()
    for (const statement of readFileSync(`${drizzleDir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement))
    }

    const [liveRow] = await db.select().from(apiToken).where(eq(apiToken.id, live))
    const [revokedRow] = await db.select().from(apiToken).where(eq(apiToken.id, revoked))
    expect(liveRow?.revokedAt).toBeInstanceOf(Date)
    expect(revokedRow?.revokedAt?.toISOString()).toBe(oldRevocation.toISOString())
  })
})
