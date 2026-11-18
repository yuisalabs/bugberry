const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^ {0,3}#{1,6} /
// Only stripped when text follows, so a lone "- " or "> " stays as typed.
const QUOTE_OR_LIST = /^ {0,3}(?:>|[-*+]|\d{1,9}[.)]) (?=\s*\S)/
const ESCAPABLE = /[!-/:-@[-`{-~]/
// Text set aside while the marks are read: escaped characters, code spans and link targets.
const SLOT = /\uE002(\d+)\uE003/g
const LINK = /!?\[([^[\]]*)\]\(([^()\s]*)\)/g
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/g
const EMPHASIS = [
  /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g,
  /(?<![\p{L}\p{N}_])__([^\s_](?:[^_]*[^\s_])?)__(?![\p{L}\p{N}_])/gu,
  /~~([^\s~](?:[^~]*[^\s~])?)~~/g,
  /\*([^\s*](?:[^*]*[^\s*])?)\*/g,
  /(?<![\p{L}\p{N}_])_([^\s_](?:[^_]*[^\s_])?)_(?![\p{L}\p{N}_])/gu,
]

/**
 * Markdown as plain text: the marks go, the words and line breaks stay. `keepLayout` is for text read in full
 * (an email): list and quote markers stay, and a link is written "label (url)".
 */
export function stripMarkdown(text: string, options?: { keepLayout?: boolean }): string {
  const keepLayout = options?.keepLayout ?? false
  const out: string[] = []
  let fence: { char: string; length: number } | null = null
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const fenceMatch = FENCE.exec(line)
    if (fence) {
      const closes =
        fenceMatch?.[1]?.[0] === fence.char && fenceMatch[1].length >= fence.length && fenceMatch[2]?.trim() === ""
      if (closes) fence = null
      else out.push(line)
      continue
    }
    const marker = fenceMatch?.[1]
    if (marker && !(marker[0] === "`" && fenceMatch[2]?.includes("`"))) {
      fence = { char: marker[0] as string, length: marker.length }
      continue
    }
    out.push(stripLine(line, keepLayout))
  }
  return out.join("\n")
}

function stripLine(line: string, keepLayout: boolean): string {
  let text = line.replace(/[\uE002\uE003]/g, "")
  // A quote can hold a list item, so a second marker may follow the first, and a heading may follow both.
  let markers = ""
  for (let i = 0; i < 2; i++) {
    const marker = QUOTE_OR_LIST.exec(text)?.[0]
    if (marker === undefined) break
    markers += marker
    text = text.slice(marker.length)
  }
  text = (keepLayout ? markers : "") + text.replace(HEADING, "")
  const slots: string[] = []
  const resolve = (value: string) => value.replace(SLOT, (_match, index: string) => slots[Number(index)] ?? "")
  // A slot's value is resolved first, so restoring once at the end never leaves a marker from an inner slot.
  const slot = (value: string) => `\uE002${slots.push(resolve(value)) - 1}\uE003`

  text = setAsideEscapesAndCode(text, slot)
  text = text
    .replace(LINK, (_match, label: string, url: string) => {
      if (label === "") return slot(url)
      if (!keepLayout || url === "") return label
      return resolve(label) === resolve(url) ? slot(url) : `${label} (${slot(url)})`
    })
    .replace(AUTOLINK, (_match, url: string) => slot(url))
  // Two passes so a mark inside another ("**a *b* c**") goes as well.
  for (let pass = 0; pass < 2; pass++) {
    for (const pattern of EMPHASIS) text = text.replace(pattern, "$1")
  }
  return resolve(text)
}

/** Swaps backslash escapes and code spans for slots in one left-to-right scan, as Markdown reads them. */
function setAsideEscapesAndCode(text: string, slot: (value: string) => string): string {
  let result = ""
  // Run lengths known to have no closing run further on, so each length is searched to the end at most once.
  const unclosed = new Set<number>()
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      result += slot(text[i + 1] as string)
      i += 2
      continue
    }
    if (char !== "`") {
      result += char
      i++
      continue
    }
    const open = runEnd(text, i)
    const length = open - i
    const close = unclosed.has(length) ? -1 : closingRun(text, open, length)
    if (close === -1) {
      unclosed.add(length)
      result += text.slice(i, open)
      i = open
      continue
    }
    result += slot(text.slice(open, close))
    i = close + length
  }
  return result
}

function runEnd(text: string, start: number): number {
  let end = start
  while (text[end] === "`") end++
  return end
}

function closingRun(text: string, from: number, length: number): number {
  let at = text.indexOf("`", from)
  while (at !== -1) {
    const end = runEnd(text, at)
    if (end - at === length) return at
    at = text.indexOf("`", end)
  }
  return -1
}
