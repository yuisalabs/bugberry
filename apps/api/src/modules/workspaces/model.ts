import { t } from "elysia"

export const name = t.String({ minLength: 1, maxLength: 80 })
export const slug = t.String({ minLength: 1, maxLength: 60 })
