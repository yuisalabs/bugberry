/**
 * Mentions are stored in a comment as `@[user:<id>]` so they follow renames. People type and read
 * "@Name"; these helpers convert between the two.
 */
export type Mentionable = { id: string; name: string; email: string }
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
  const matches = people.filter((person) => `${person.name}\n${person.email}`.toLowerCase().includes(needle))
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
  const handle = person.email.split("@")[0]
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

export type CommentPart = { text: string } | { mention: Named | null }

/** The body split into text and mentions; a mention of someone no longer in the workspace is null. */
export function commentParts(body: string, names: Map<string, string>): CommentPart[] {
  const parts: CommentPart[] = []
  let last = 0
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: body.slice(last, index) })
    const id = match[1] as string
    const name = names.get(id)
    parts.push({ mention: name === undefined ? null : { id, name } })
    last = index + match[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last) })
  return parts
}
