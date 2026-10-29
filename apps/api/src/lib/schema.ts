import { t } from "elysia"

/**
 * Like `t.UnionEnum` without its implicit `default` (the first value), which fills in a missing field: a partial
 * PATCH would reset it, and an empty role change would grant "admin".
 */
export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  const schema = t.UnionEnum(values)
  delete (schema as { default?: unknown }).default
  return schema
}
