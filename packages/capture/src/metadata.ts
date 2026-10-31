import { type SdkHost, sdkGlobalOf } from "./hooks/sdk"
import { MAX_ARG_CHARS, MAX_METADATA_CHARS, MAX_METADATA_DEPTH } from "./limits"
import { isSensitiveKey, REDACTED, truncate } from "./sanitize"
import { describeNode, functionLabel, isDomNode } from "./serialize"

const MAX_ERROR_CHARS = 500
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 200

export interface MetadataSnapshot {
  fields: Record<string, unknown> | null
  error: string | null
  droppedKeys: number
}

export const NO_METADATA: MetadataSnapshot = Object.freeze({ fields: null, error: null, droppedKeys: 0 }) as MetadataSnapshot

const typeName = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value)

class OverBudget extends Error {}

/** Roughly the JSON size written so far; a walk over budget stops, so a whole store is never read in pagehide. */
interface Budget {
  left: number
}

function charge(budget: Budget, chars: number): void {
  budget.left -= chars
  if (budget.left < 0) throw new OverBudget()
}

function leaf(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") return truncate(value, MAX_ARG_CHARS)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function") return functionLabel(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()
  if (isDomNode(value)) return describeNode(value)
  return undefined
}

function bound(value: unknown, depth: number, ancestors: Set<object>, budget: Budget): unknown {
  if (typeof value !== "object" || value === null || value instanceof Error || value instanceof Date || isDomNode(value)) {
    const result = leaf(value)
    if (result !== undefined) charge(budget, typeof result === "string" ? result.length + 2 : String(result).length)
    return result
  }
  if (ancestors.has(value)) return "[Circular]"
  if (depth > MAX_METADATA_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]"
  charge(budget, 2)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => {
        charge(budget, 1)
        return bound(item, depth + 1, ancestors, budget) ?? null
      })
      if (value.length > MAX_ARRAY_ITEMS) items.push(`…${value.length - MAX_ARRAY_ITEMS} more`)
      return items
    }
    const result: Record<string, unknown> = {}
    const keys = Object.keys(value)
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      charge(budget, key.length + 4)
      const item = isSensitiveKey(key) ? REDACTED : bound((value as Record<string, unknown>)[key], depth + 1, ancestors, budget)
      if (item !== undefined) result[key] = item
    }
    if (keys.length > MAX_OBJECT_KEYS) result["…"] = `${keys.length - MAX_OBJECT_KEYS} more keys`
    return result
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Redaction, string cap, depth and cycles, then the 10 KB cap by whole top-level keys, in order: the first key
 * that does not fit and every key after it are dropped and counted without being read. Getters run, so this can throw.
 */
export function boundMetadata(value: Record<string, unknown>): { fields: Record<string, unknown>; droppedKeys: number } {
  const fields: Record<string, unknown> = {}
  const keys = Object.keys(value)
  const ancestors = new Set<object>([value])
  // "{}" plus each kept pair and the comma before it.
  let size = 2
  let kept = 0
  for (const key of keys) {
    let item: unknown
    try {
      item = isSensitiveKey(key) ? REDACTED : bound(value[key], 1, ancestors, { left: MAX_METADATA_CHARS - size })
    } catch (error) {
      if (error instanceof OverBudget) break
      throw error
    }
    if (item === undefined) {
      kept += 1
      continue
    }
    const pair = JSON.stringify({ [key]: item }).length - 2 + (Object.keys(fields).length ? 1 : 0)
    if (size + pair > MAX_METADATA_CHARS) break
    fields[key] = item
    size += pair
    kept += 1
  }
  return { fields, droppedKeys: keys.length - kept }
}

function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return "unreadable error"
  }
}

/** Calls the page's metadata callback and bounds the result. Never throws. */
export function readMetadata(host: SdkHost): MetadataSnapshot {
  try {
    const global = sdkGlobalOf(host)
    if (!global || global.metadata === null) return NO_METADATA
    if (typeof global.metadata !== "function") return { fields: null, error: "metadata is not a function", droppedKeys: 0 }
    try {
      const value: unknown = global.metadata()
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { fields: null, error: `callback returned ${typeName(value)}, not an object`, droppedKeys: 0 }
      }
      return { ...boundMetadata(value as Record<string, unknown>), error: null }
    } catch (error) {
      return { fields: null, error: `callback threw: ${messageOf(error).slice(0, MAX_ERROR_CHARS)}`, droppedKeys: 0 }
    }
  } catch {
    return NO_METADATA
  }
}
