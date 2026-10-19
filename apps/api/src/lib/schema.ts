import { t } from "elysia"

/**
 * Like `t.UnionEnum`, minus the implicit `default` (the first value) that UnionEnum adds.
 * With that default, a missing field is silently filled in: a partial PATCH would reset it,
 * and an empty role change would grant "admin".
 */
export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  const schema = t.UnionEnum(values)
  delete (schema as { default?: unknown }).default
  return schema
}
