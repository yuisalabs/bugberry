import { LABEL_COLORS } from "@bugberry/shared"
import { t } from "elysia"

const color = t.Union(LABEL_COLORS.map((name) => t.Literal(name)))
// Generous here: trimming and the one-line rule are checked by the service, with their own error code.
const name = t.String({ maxLength: 200 })

export const createLabelBody = t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })), name, color: t.Optional(color) })
export const updateLabelBody = t.Object({ name: t.Optional(name), color: t.Optional(color) })
export const listLabelsQuery = t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })) })
