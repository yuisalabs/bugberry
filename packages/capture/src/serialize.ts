import { describeElement } from "./describe"
import { MAX_ARG_CHARS } from "./limits"
import { isSensitiveKey, REDACTED, truncate } from "./sanitize"

const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 50

function isDomNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { nodeType?: unknown }).nodeType === "number" &&
    typeof (value as { nodeName?: unknown }).nodeName === "string"
  )
}

function describeNode(node: Node): string {
  return node.nodeType === 1 ? `<${describeElement(node as Element)}>` : `[${node.nodeName}]`
}

function functionLabel(fn: Function): string {
  return `[Function ${fn.name || "anonymous"}]`
}

class BudgetExceeded extends Error {}

/**
 * JSON-like rendering that stops at MAX_ARG_CHARS, caps keys and items, and reads only own data
 * properties: getters, `toJSON` and other page code are never run (unlike JSON.stringify).
 */
function toBoundedJson(root: object): string {
  let out = ""
  const ancestors = new Set<object>()
  const write = (chunk: string) => {
    out += chunk
    if (out.length > MAX_ARG_CHARS) throw new BudgetExceeded()
  }

  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || typeof value === "symbol") return write("null")
    if (typeof value === "number") return write(Number.isFinite(value) ? String(value) : "null")
    if (typeof value === "boolean") return write(String(value))
    if (typeof value === "string") return write(JSON.stringify(value.slice(0, MAX_ARG_CHARS)))
    if (typeof value === "bigint") return write(JSON.stringify(value.toString()))
    if (typeof value === "function") return write(JSON.stringify(functionLabel(value)))
    if (value instanceof Error) return write(JSON.stringify(`${value.name}: ${value.message}`))
    if (value instanceof Date) return write(JSON.stringify(Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()))
    if (isDomNode(value)) return write(JSON.stringify(describeNode(value)))

    const object = value as object
    if (ancestors.has(object)) return write('"[Circular]"')
    if (depth > MAX_DEPTH) return write(Array.isArray(object) ? '"[Array]"' : '"[Object]"')
    ancestors.add(object)

    if (Array.isArray(object)) {
      write("[")
      const shown = Math.min(object.length, MAX_ARRAY_ITEMS)
      for (let index = 0; index < shown; index++) {
        if (index > 0) write(",")
        const descriptor = Object.getOwnPropertyDescriptor(object, index)
        visit(descriptor && "value" in descriptor ? descriptor.value : null, depth + 1)
      }
      if (object.length > shown) write(`,"…${object.length - shown} more"`)
      write("]")
    } else {
      write("{")
      const keys = Object.keys(object)
      let written = 0
      for (const key of keys) {
        if (written === MAX_OBJECT_KEYS) {
          write(`${written ? "," : ""}"…":"${keys.length - written} more keys"`)
          break
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        if (!descriptor) continue
        let item: unknown
        if (isSensitiveKey(key)) item = REDACTED
        else if ("value" in descriptor) item = descriptor.value
        else item = "[Getter]"
        if (item === undefined || typeof item === "symbol") continue
        write(`${written ? "," : ""}${JSON.stringify(key)}:`)
        visit(item, depth + 1)
        written += 1
      }
      write("}")
    }
    ancestors.delete(object)
  }

  try {
    visit(root, 0)
    return out
  } catch (error) {
    if (error instanceof BudgetExceeded) return out
    throw error
  }
}

function describe(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return functionLabel(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (isDomNode(value)) return describeNode(value)
  return toBoundedJson(value)
}

/** Turns one console argument into bounded, secret-free text. Never throws. */
export function stringifyArg(value: unknown): string {
  try {
    return truncate(describe(value), MAX_ARG_CHARS)
  } catch {
    return "[unserializable]"
  }
}
