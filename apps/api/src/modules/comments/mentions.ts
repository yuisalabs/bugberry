import type { Db } from "../../db/client"
import { stripMarkdown } from "../../lib/markdown-text"
import { activeAmong } from "../account/repository"
import { type CommentPlace, insertMentionNotifications, readersAmong } from "./repository"

/** How a comment stores a mention: `@[user:<id>]`. The client shows it as "@Name". */
export const MENTION_TOKEN = /@\[user:([A-Za-z0-9_-]{1,64})\]/g

/** The ids a comment mentions, each once, in the order they first appear. */
export function mentionedIds(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(MENTION_TOKEN), (match) => match[1] as string))]
}

/** The comment as plain text: each mention becomes "@Name", or "@former member" for a non-member. */
export function renderMentions(body: string, names: Map<string, string>): string {
  return body.replace(MENTION_TOKEN, (_token, id: string) => `@${names.get(id) ?? "former member"}`)
}

const SNIPPET_LENGTH = 140

/** Plain text for the bell and email: Markdown marks dropped, names in place of tokens, whitespace collapsed, cut with "…". */
export function snippetOf(body: string, names: Map<string, string>): string {
  // Tokens wait in placeholders while the marks go, so a name like "_ana_" is not read as Markdown. Placeholder
  // characters already in the body are dropped first, or they would come back as a mention nobody wrote.
  const ids: string[] = []
  const held = body
    .replace(/[\uE000\uE001]/g, "")
    .replace(MENTION_TOKEN, (_token, id: string) => `\uE000${ids.push(id) - 1}\uE001`)
  const text = stripMarkdown(held)
    .replace(/\uE000(\d+)\uE001/g, (_held, index: string) => `@${names.get(ids[Number(index)] ?? "") ?? "former member"}`)
    .replace(/\s+/g, " ")
    .trim()
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 1)}…` : text
}

/** Names of the mentioned people who can read a report here (members, and the project's guests); everyone else is left out. */
export async function readerNames(db: Db, place: CommentPlace, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await readersAmong(db, place, ids)
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** The members a comment mentions, in order, for showing names that follow renames. */
export function mentionsOf(body: string, names: Map<string, string>): Array<{ id: string; name: string }> {
  return mentionedIds(body).flatMap((id) => {
    const name = names.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

/**
 * Notifies the members a comment mentions, except its author, and returns who was notified now. Someone already
 * mentioned in it is skipped, so edits never notify twice; one with only a reply notification gets the mention.
 * `skip` leaves out people already told about this comment another way.
 */
export async function notifyMentions(
  db: Db,
  input: { commentId: string; reportId: string; place: CommentPlace; actorId: string; body: string; skip?: string[] },
): Promise<string[]> {
  const ids = mentionedIds(input.body).filter((id) => id !== input.actorId && !input.skip?.includes(id))
  // A deactivated person keeps their name in the comment, but gets nothing in the bell.
  const members = await activeAmong(db, [...(await readerNames(db, input.place, ids)).keys()])
  if (members.length === 0) return []
  const target = { commentId: input.commentId, reportId: input.reportId, actorId: input.actorId }
  return insertMentionNotifications(db, target, members)
}
