import { RESERVED_WORKSPACE_SLUGS, WORKSPACE_SLUG_PATTERN } from "@bugberry/shared"
import type { Db } from "../../db/client"
import { listWorkspacesWithoutSlug, setWorkspaceSlug, slugInUse, slugsLike } from "./repository"

export const SLUG_PATTERN = new RegExp(WORKSPACE_SLUG_PATTERN)
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(RESERVED_WORKSPACE_SLUGS)
/** Room is left for a "-N" suffix within the 40-character limit. */
const BASE_LENGTH = 36

const trimDashes = (value: string) => value.replace(/^-+|-+$/g, "")

/** "Javan QA" → "javan-qa". Always a valid, unreserved slug, though not necessarily a free one. */
export function slugify(name: string): string {
  const plain = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
  const base = trimDashes(trimDashes(plain.replace(/[^a-z0-9]+/g, "-")).slice(0, BASE_LENGTH))
  if (!base) return "workspace"
  if (base.length < 3 || RESERVED_SLUGS.has(base)) return `${base}-workspace`
  return base
}

/** Why a typed slug can't be used, or null when it can (whether it is free is a separate question). */
export function slugProblem(slug: string): "invalid" | "reserved" | null {
  if (!SLUG_PATTERN.test(slug)) return "invalid"
  return RESERVED_SLUGS.has(slug) ? "reserved" : null
}

/** Whether another workspace already has this slug. */
export function slugTaken(db: Db, slug: string, exceptWorkspaceId?: string): Promise<boolean> {
  return slugInUse(db, slug, exceptWorkspaceId)
}

/** The name's slug if it is free, else the same with "-2", "-3"… */
export async function freeSlug(db: Db, name: string, exceptWorkspaceId?: string): Promise<string> {
  const base = slugify(name)
  const taken = await slugsLike(db, base, exceptWorkspaceId)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Gives every workspace without a slug one, oldest first. Safe to run on every start. */
export async function ensureWorkspaceSlugs(db: Db): Promise<number> {
  const missing = await listWorkspacesWithoutSlug(db)
  for (const row of missing) await setWorkspaceSlug(db, row.id, await freeSlug(db, row.name))
  return missing.length
}

/** Postgres refused a row because another one already has the same unique value. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const record = current as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown }
    if (record.code === "23505" || record.errno === "23505") return true
    if (typeof record.message === "string" && record.message.includes("duplicate key value")) return true
    current = record.cause
  }
  return false
}
