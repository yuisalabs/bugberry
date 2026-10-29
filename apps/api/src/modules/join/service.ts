import type { AccountLimits } from "../../config"
import { type Db, withTransaction } from "../../db/client"
import { updateUser } from "../account/repository"
import { assertCanAddMembers } from "../workspaces/limits"
import { addMemberIfAbsent } from "../workspaces/repository"
import { isUniqueViolation } from "../workspaces/slug"
import { newJoinCode } from "./join-codes"
import { deleteJoinRequest, updateJoinSettings } from "./repository"

/** Adds the person as Member (once) and makes the workspace their current one. */
export async function joinAsMember(db: Db, limits: AccountLimits | null, workspaceId: string, userId: string) {
  await withTransaction(db, async () => {
    await assertCanAddMembers(db, limits, workspaceId, "joiner")
    await addMemberIfAbsent(db, workspaceId, userId, "member")
    // A request still waiting would keep counting in the admins' sidebar.
    await deleteJoinRequest(db, workspaceId, userId)
    await updateUser(db, userId, { lastWorkspaceId: workspaceId })
  })
  return { workspaceId }
}

/** A fresh shared code; a clash with another workspace's code just draws again. */
export async function setNewShareCode(db: Db, workspaceId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await updateJoinSettings(db, workspaceId, { shareCode: newJoinCode() })
      return
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error
    }
  }
}
