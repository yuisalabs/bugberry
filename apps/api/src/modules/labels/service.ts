import { type LabelColor, MAX_LABEL_NAME_LENGTH, MAX_LABELS_PER_WORKSPACE } from "@bugberry/shared"
import type { Db } from "../../db/client"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { memberRole, requireMember } from "../workspaces/access"
import { isUniqueViolation } from "../workspaces/slug"
import { countLabels, deleteLabel, findLabel, insertLabel, type LabelView, updateLabel } from "./repository"

const labelNotFound = () => notFound("label_not_found", "Label not found")
const labelExists = () => conflict("label_exists", "A label with this name already exists")

/** The name as stored: trimmed, 1 to 40 characters, one line. */
export function labelName(input: string): string {
  const name = input.trim()
  if (!name || name.length > MAX_LABEL_NAME_LENGTH || /[\r\n]/.test(name)) {
    throw unprocessable("label_name_invalid", `A label name is 1 to ${MAX_LABEL_NAME_LENGTH} characters on one line`)
  }
  return name
}

/** The unique index settles two creates of one name at once; the loser gets the same 409 as a later one. */
async function unlessTaken<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isUniqueViolation(error)) throw labelExists()
    throw error
  }
}

export async function createLabel(
  db: Db,
  caller: { id: string },
  workspaceId: string,
  input: { name: string; color?: LabelColor },
): Promise<LabelView> {
  await requireMember(db, caller.id, workspaceId)
  const name = labelName(input.name)
  if ((await countLabels(db, workspaceId)) >= MAX_LABELS_PER_WORKSPACE) {
    throw unprocessable("label_limit", `A workspace can have at most ${MAX_LABELS_PER_WORKSPACE} labels`)
  }
  return unlessTaken(() => insertLabel(db, { id: newId(), workspaceId, name, color: input.color ?? "gray", createdById: caller.id }))
}

/** A label the caller may change: an outsider gets the same 404 as a label that doesn't exist. */
async function labelForAdmin(db: Db, callerId: string, id: string) {
  const found = await findLabel(db, id)
  if (!found || !(await memberRole(db, callerId, found.workspaceId))) throw labelNotFound()
  await requireMember(db, callerId, found.workspaceId, "admin")
  return found
}

export async function changeLabel(
  db: Db,
  caller: { id: string },
  id: string,
  input: { name?: string; color?: LabelColor },
): Promise<LabelView> {
  await labelForAdmin(db, caller.id, id)
  const changes = { ...(input.name === undefined ? {} : { name: labelName(input.name) }), ...(input.color ? { color: input.color } : {}) }
  const updated = await unlessTaken(() => updateLabel(db, id, changes))
  if (!updated) throw labelNotFound()
  return updated
}

/** Takes the label off every report too (the links cascade), without an activity line on each. */
export async function removeLabel(db: Db, caller: { id: string }, id: string): Promise<void> {
  await labelForAdmin(db, caller.id, id)
  await deleteLabel(db, id)
}
