import { t } from "elysia"
import { targetBody } from "../connections/validate"

export const createBody = t.Object({
  connectionId: t.String({ minLength: 1 }),
  target: targetBody,
  autoSend: t.Optional(t.Boolean()),
})

/** A use's target never changes: changing it is removing the use and adding it again. */
export const patchBody = t.Object({
  labels: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 50 }), { maxItems: 10 })),
  autoSend: t.Optional(t.Boolean()),
  // Elysia drops unknown keys silently; a target sent here is refused instead (422).
  target: t.Optional(t.Never()),
})
