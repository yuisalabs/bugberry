import { t } from "elysia"

const preset = t.Union([t.Literal("openai"), t.Literal("custom")])

export const providerBody = t.Object({
  preset,
  baseUrl: t.Optional(t.String({ maxLength: 500 })),
  model: t.String({ minLength: 1, maxLength: 200 }),
  apiKey: t.Optional(t.String({ maxLength: 500 })),
})

export const settingsBody = t.Object({
  sendResponseBodies: t.Optional(t.Boolean()),
  defaultTemplateId: t.Optional(t.Nullable(t.String())),
  projectDefaults: t.Optional(t.Array(t.Object({ projectId: t.String(), templateId: t.Nullable(t.String()) }), { maxItems: 500 })),
})

const line = t.Object({
  atMs: t.Number(),
  kind: t.Union([t.Literal("action"), t.Literal("navigate"), t.Literal("error"), t.Literal("request"), t.Literal("note")]),
  text: t.String({ maxLength: 5000 }),
  body: t.Optional(t.String({ maxLength: 20_000 })),
})

export const writeBody = t.Object({
  templateId: t.String(),
  material: t.Object({
    page: t.Object({ url: t.String({ maxLength: 4000 }), title: t.Nullable(t.String({ maxLength: 1000 })) }),
    device: t.Object({ browser: t.String({ maxLength: 200 }), os: t.String({ maxLength: 200 }) }),
    lines: t.Array(line, { maxItems: 400 }),
    omitted: t.Integer({ minimum: 0 }),
  }),
  hint: t.Object({ title: t.String({ maxLength: 200 }), description: t.String({ maxLength: 5000 }) }),
})

export const templateFields = {
  name: t.String({ minLength: 1, maxLength: 80 }),
  skeleton: t.String({ maxLength: 4000 }),
  instructions: t.String({ maxLength: 2000 }),
}

export type SettingsBody = typeof settingsBody.static
