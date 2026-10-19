import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { and, eq, sql } from "drizzle-orm"
import { workspaceMember } from "../src/db/schema"
import { addMember, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

describe("ensure_workspace_admin migration", () => {
  test("a workspace left without an admin gets its oldest member as admin", async () => {
    const { db } = await setupTestApp()
    const orphan = await createWorkspaceRow(db, "No admin")
    const first = await createUser(db, { workspaceId: orphan.id, workspaceRole: "member" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await createUser(db, { workspaceId: orphan.id, workspaceRole: "member" })
    const fine = await createWorkspaceRow(db, "Has admin")
    const admin = await createUser(db, { workspaceId: fine.id, workspaceRole: "admin" })
    await addMember(db, fine.id, second.id, "member")

    const file = readdirSync(drizzleDir).find((name) => name.endsWith("_ensure_workspace_admin.sql"))
    expect(file).toBeDefined()
    for (const statement of readFileSync(`${drizzleDir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement))
    }

    const roleOf = async (workspaceId: string, userId: string) =>
      (
        await db
          .select({ role: workspaceMember.role })
          .from(workspaceMember)
          .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
      )[0]?.role
    expect(await roleOf(orphan.id, first.id)).toBe("admin")
    expect(await roleOf(orphan.id, second.id)).toBe("member")
    expect(await roleOf(fine.id, admin.id)).toBe("admin")
    expect(await roleOf(fine.id, second.id)).toBe("member")
  })
})
