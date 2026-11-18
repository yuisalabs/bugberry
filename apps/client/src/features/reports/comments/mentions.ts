/**
 * Mentions are stored in a comment as `@[user:<id>]` so they follow renames. People type and read
 * "@Name"; these helpers convert between the two.
 */
/** `email` only for members (a guest's isn't shown); `guest` marks a project's guest. */
export type Mentionable = { id: string; name: string; email?: string; guest?: boolean }
type Named = Pick<Mentionable, "id" | "name">
/** Someone picked in the box; `label` is what follows "@" when it is not just the name. */
export type Picked = Named & { label?: string }

const TOKEN = /@\[user:([A-Za-z0-9_-]{1,64})\]/g
/** "@word" right before the caret, at the start or after whitespace. */
const TYPING = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u

/** The "@word" being typed at the caret, or null when the caret is not in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = TYPING.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? ""
  return { start: caret - query.length - 1, query }
}

/** People whose name or email contains the query; names that start with it come first. */
export function suggestions(people: Mentionable[], query: string, limit = 6): Mentionable[] {
  const needle = query.toLowerCase()
  const matches = people.filter((person) => `${person.name}\n${person.email ?? ""}`.toLowerCase().includes(needle))
  const starts = (person: Mentionable) => (person.name.toLowerCase().startsWith(needle) ? 0 : 1)
  return matches.sort((left, right) => starts(left) - starts(right)).slice(0, limit)
}

/**
 * What "@" writes for a person: the name, or "Name (email name)" when someone else in the workspace has
 * the same name, so each mention still points at the person who was picked.
 */
export function mentionLabel(person: Mentionable, people: Mentionable[]): string {
  const name = person.name.toLowerCase()
  const shared = people.some((other) => other.id !== person.id && other.name.toLowerCase() === name)
  const handle = person.email?.split("@")[0]
  return shared && handle ? `${person.name} (${handle})` : person.name
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Turns "@Label" of each picked person into their token. Longer labels go first, so "@Ana Maria" beats "@Ana". */
export function toStored(text: string, picked: Picked[]): string {
  const labelOf = (person: Picked) => person.label ?? person.name
  const byLength = [...picked].sort((left, right) => labelOf(right).length - labelOf(left).length)
  return byLength.reduce(
    (result, person) =>
      result.replace(new RegExp(`@${escapeRegExp(labelOf(person))}(?![\\p{L}\\p{N}_])`, "gu"), `@[user:${person.id}]`),
    text,
  )
}

/** The stored body as people type it, with the mentioned people already picked. */
export function toEditable(
  body: string,
  names: Map<string, string>,
  people: Mentionable[] = [],
): { text: string; picked: Array<Mentionable & { label: string }> } {
  const picked = new Map<string, Mentionable & { label: string }>()
  const text = body.replace(TOKEN, (_token, id: string) => {
    const name = names.get(id)
    if (name === undefined) return "@former member"
    const person = { ...(people.find((known) => known.id === id) ?? { id, email: "" }), name }
    const label = mentionLabel(person, people)
    picked.set(id, { ...person, label })
    return `@${label}`
  })
  return { text, picked: [...picked.values()] }
}

const OPEN = "\uE000"
const CLOSE = "\uE001"
const PLACEHOLDER = /\uE000(\d+)\uE001/g
const PLACEHOLDER_CHAR = /[\uE000\uE001]/g
// Markdown decodes "&#57344;" and "&#xE000;" into the placeholder characters after this step runs, so they go too.
const PLACEHOLDER_REFERENCE = /&#(?:[xX]0*[eE]00[01]|0*5734[45]);/g

/**
 * The body with each mention token swapped for a placeholder Markdown cannot read as syntax:
 * U+E000, the token's index in `ids`, U+E001. Any U+E000 or U+E001 already in the body is dropped first.
 */
export function protectMentions(body: string): { text: string; ids: string[] } {
  const ids: string[] = []
  const text = body
    .replace(PLACEHOLDER_CHAR, "")
    .replace(PLACEHOLDER_REFERENCE, "")
    .replace(TOKEN, (_token, id: string) => {
      ids.push(id)
      return `${OPEN}${ids.length - 1}${CLOSE}`
    })
  return { text, ids }
}

/** Text split around placeholders; `mention` is an index into `ids`. A placeholder character outside a placeholder is dropped. */
export function mentionParts(text: string): Array<{ text: string } | { mention: number }> {
  const parts: Array<{ text: string } | { mention: number }> = []
  const pushText = (value: string) => {
    const clean = value.replace(PLACEHOLDER_CHAR, "")
    if (clean) parts.push({ text: clean })
  }
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0
    pushText(text.slice(last, index))
    parts.push({ mention: Number(match[1]) })
    last = index + match[0].length
  }
  pushText(text.slice(last))
  if (parts.length === 0) parts.push({ text: "" })
  return parts
}
