import { t } from "elysia"
import { OPTION_LISTS } from "./accounts"
import { settingsBody, settingsSchemas } from "./validate"

const name = t.String({ minLength: 1, maxLength: 80 })
const secret = t.String({ minLength: 1, maxLength: 500 })

export const createBody = t.Union([
  t.Object({ provider: t.Union([t.Literal("github"), t.Literal("linear")]), name, settings: settingsSchemas.none, secret }),
  t.Object({ provider: t.Union([t.Literal("gitlab"), t.Literal("activecollab")]), name, settings: settingsSchemas.address, secret }),
  t.Object({ provider: t.Literal("jira"), name, settings: settingsSchemas.jira, secret }),
  // Checked field by field in normalizeSettings, so a wrong workspace slug gets its own message.
  t.Object({ provider: t.Literal("plane"), name, settings: settingsBody, secret }),
  t.Object({ provider: t.Union([t.Literal("slack"), t.Literal("discord"), t.Literal("telegram")]), name, settings: settingsSchemas.none, secret }),
  // A webhook's signing secret is optional.
  t.Object({ provider: t.Literal("webhook"), name, settings: settingsSchemas.webhook, secret: t.Optional(t.String({ maxLength: 500 })) }),
])

export const patchBody = t.Object({
  name: t.Optional(name),
  settings: t.Optional(settingsBody),
  /** Empty keeps the current secret. */
  secret: t.Optional(t.String({ maxLength: 500 })),
})

export const optionsQuery = t.Object({
  list: t.Union(OPTION_LISTS.map((list) => t.Literal(list))),
  q: t.Optional(t.String({ maxLength: 100 })),
  parent: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
})
