import type { Db } from "../../db/client"
import { insertMentionNotifications, membersAmong } from "./repository"

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

/** Plain text for the bell and email: names in place of tokens, whitespace collapsed, cut with "…". */
export function snippetOf(body: string, names: Map<string, string>): string {
  const text = renderMentions(body, names).replace(/\s+/g, " ").trim()
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 1)}…` : text
}

/** Names of the mentioned people who are members of the workspace; everyone else is left out. */
export async function memberNames(db: Db, workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await membersAmong(db, workspaceId, ids)
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
 */
export async function notifyMentions(
  db: Db,
  input: { commentId: string; reportId: string; workspaceId: string; actorId: string; body: string },
): Promise<string[]> {
  const ids = mentionedIds(input.body).filter((id) => id !== input.actorId)
  const members = [...(await memberNames(db, input.workspaceId, ids)).keys()]
  if (members.length === 0) return []
  const target = { commentId: input.commentId, reportId: input.reportId, actorId: input.actorId }
  return insertMentionNotifications(db, target, members)
}
