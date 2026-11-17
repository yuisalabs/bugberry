import type { LabelColor } from "@bugberry/shared"
import { queryOptions } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

export const labels = (workspaceId: string) => unwrap(eden.api.labels.get({ query: { workspaceId } }))
export const createLabel = (workspaceId: string, name: string, color?: LabelColor) =>
  unwrap(eden.api.labels.post({ workspaceId, name, ...(color ? { color } : {}) }))
export const updateLabel = (id: string, changes: { name?: string; color?: LabelColor }) => unwrap(eden.api.labels({ id }).patch(changes))
export const deleteLabel = (id: string) => unwrap(eden.api.labels({ id }).delete())
export const setReportLabels = (reportId: string, labelIds: string[]) => unwrap(eden.api.reports({ id: reportId }).labels.put({ labelIds }))

/** A workspace's label, with how many reports carry it. */
export type WorkspaceLabel = Awaited<ReturnType<typeof labels>>[number]
export type Label = Pick<WorkspaceLabel, "id" | "name" | "color">

export const labelQueries = {
  labels: (workspaceId: string) => queryOptions({ queryKey: qk.labels(workspaceId), queryFn: () => labels(workspaceId) }),
}
