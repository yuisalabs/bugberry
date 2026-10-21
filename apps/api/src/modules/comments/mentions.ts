import { and, eq, inArray, ne } from "drizzle-orm"
import type { Db } from "../../db/client"
import { notification, user, workspaceMember } from "../../db/schema"
import { newId } from "../../lib/ids"

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
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), inArray(workspaceMember.userId, ids)))
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
 * Notifies the workspace members a comment mentions, except its author. A person already mentioned in
 * this comment is skipped, so editing never notifies anyone twice; one who only had a reply notification for
 * it gets the mention instead. Returns the ids notified just now.
 */
export async function notifyMentions(
  db: Db,
  input: { commentId: string; reportId: string; workspaceId: string; actorId: string; body: string },
): Promise<string[]> {
  const ids = mentionedIds(input.body).filter((id) => id !== input.actorId)
  const members = [...(await memberNames(db, input.workspaceId, ids)).keys()]
  if (members.length === 0) return []
  const rows = await db
    .insert(notification)
    .values(
      members.map((userId) => ({
        id: newId(),
        userId,
        commentId: input.commentId,
        reportId: input.reportId,
        actorId: input.actorId,
      })),
    )
    // Someone who only had a reply notification for this comment gets the mention instead (and its email).
    .onConflictDoUpdate({
      target: [notification.userId, notification.commentId],
      set: { kind: "mention", readAt: null },
      setWhere: ne(notification.kind, "mention"),
    })
    .returning({ userId: notification.userId })
  return rows.map((row) => row.userId)
}
