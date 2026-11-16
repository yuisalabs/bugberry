import { type LabelColor, MAX_LABEL_NAME_LENGTH, MAX_LABELS_PER_REPORT, MAX_LABELS_PER_WORKSPACE } from "@bugberry/shared"
import type { AppDeps } from "../../deps"
import { type Db, withTransaction } from "../../db/client"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { recordActivity } from "../activity/repository"
import { loadReportDetail, type ReportDetail } from "../reports/detail"
import { memberRole, requireMember, requireReportMember } from "../workspaces/access"
import { isUniqueViolation } from "../workspaces/slug"
import {
  countLabels,
  deleteLabel,
  findLabel,
  findLabelsByIds,
  insertLabel,
  type LabelView,
  labelsOfReports,
  lockReportLabels,
  replaceReportLabels,
  updateLabel,
} from "./repository"

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

const names = (labels: readonly LabelView[]) => labels.map((label) => label.name)

/**
 * Makes the report carry exactly these labels, as a member. One activity line records what was added and removed,
 * by name; setting what is already there records nothing. `viaAgent` names the AI app when it came through MCP.
 */
export async function setReportLabels(
  deps: Pick<AppDeps, "db" | "storage">,
  caller: { id: string },
  reportId: string,
  /** The new set, or how to make it from the set the report carries once it is locked (adding and removing). */
  labelIds: readonly string[] | ((current: string[]) => string[]),
  opts: { viaAgent?: string } = {},
): Promise<ReportDetail> {
  const { db } = deps
  const target = await requireReportMember(db, caller.id, reportId)
  await withTransaction(db, async () => {
    // Two changes at once would each read the old set: one would undo the other, or pass the cap together.
    await lockReportLabels(db, reportId)
    const before = (await labelsOfReports(db, [reportId])).get(reportId) ?? []
    const wanted = [...new Set(typeof labelIds === "function" ? labelIds(before.map((label) => label.id)) : labelIds)]
    if (wanted.length > MAX_LABELS_PER_REPORT) {
      throw unprocessable("label_limit", `A report takes at most ${MAX_LABELS_PER_REPORT} labels`)
    }
    // A label of another workspace answers like one that doesn't exist.
    const found = await findLabelsByIds(db, target.workspaceId, wanted)
    if (found.length !== wanted.length) throw unprocessable("label_not_found", "Label not found in this workspace")
    const added = found.filter((label) => !before.some((had) => had.id === label.id))
    const removed = before.filter((had) => !wanted.includes(had.id))
    if (added.length === 0 && removed.length === 0) return
    await replaceReportLabels(db, reportId, wanted)
    await recordActivity(db, {
      reportId,
      kind: "labels",
      detail: { added: names(added), removed: names(removed) },
      actorId: caller.id,
      viaAgent: opts.viaAgent ?? null,
    })
  })
  const detail = await loadReportDetail(deps, { id: reportId }, { forMember: true })
  if (!detail) throw notFound("report_not_found", "Report not found")
  return detail
}
