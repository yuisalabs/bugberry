import { t } from "elysia"
import { oneOf } from "../../lib/schema"

export const accessBody = t.Object({
  shareLink: t.Optional(oneOf(["on", "off", "reset"] as const)),
  joinDomain: t.Optional(t.Union([t.String({ maxLength: 253 }), t.Null()])),
  joinMode: t.Optional(oneOf(["direct", "approval"] as const)),
})

export const valueBody = t.Object({ value: t.String({ minLength: 1, maxLength: 500 }) })
