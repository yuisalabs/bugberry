import { LABEL_COLORS, MAX_LABELS_PER_REPORT } from "@bugberry/shared"
import { t } from "elysia"

const color = t.UnionEnum(LABEL_COLORS)
// Generous here: trimming and the one-line rule are checked by the service, with their own error code.
const name = t.String({ maxLength: 200 })

export const createLabelBody = t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })), name, color: t.Optional(color) })
export const updateLabelBody = t.Object({ name: t.Optional(name), color: t.Optional(color) })
export const setReportLabelsBody = t.Object({ labelIds: t.Array(t.String({ maxLength: 100 }), { maxItems: MAX_LABELS_PER_REPORT }) })
export const listLabelsQuery = t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })) })
