import { t } from "elysia"

export const projectFields = {
  name: t.String({ minLength: 1, maxLength: 80 }),
  slug: t.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  /** Glob patterns such as `*.app.kantor.com/*`, used by the extension to pick a project. */
  urlPatterns: t.Array(t.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 }),
}
