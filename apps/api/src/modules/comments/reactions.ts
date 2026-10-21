import { asc, eq, inArray } from "drizzle-orm"
import type { Db } from "../../db/client"
import { commentReaction, user } from "../../db/schema"

/** One emoji on a comment: how many people put it there, and who, in the order they did. */
export interface ReactionView {
  emoji: string
  count: number
  people: { id: string; name: string }[]
}

/** Only emoji pieces: pictographs, flags' letters and tags, skin tones, joiners, variation selectors and keycap parts. */
const EMOJI_PIECES = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3#*0-9\u{E0020}-\u{E007F}])+$/u

/** Whether a reaction is one emoji (or a short run of them): a pictograph, a flag or a keycap, never plain text. */
export function isEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 32 || !EMOJI_PIECES.test(value)) return false
  return /\p{Extended_Pictographic}/u.test(value) || /\p{Regional_Indicator}{2}/u.test(value) || /[#*0-9]\ufe0f?\u20e3/u.test(value)
}

/** Each comment's reactions, grouped by emoji in the order each emoji was first used on it. */
export async function reactionsFor(db: Db, commentIds: string[]): Promise<Map<string, ReactionView[]>> {
  const byComment = new Map<string, ReactionView[]>()
  if (commentIds.length === 0) return byComment
  const rows = await db
    .select({ commentId: commentReaction.commentId, emoji: commentReaction.emoji, id: user.id, name: user.name })
    .from(commentReaction)
    .innerJoin(user, eq(user.id, commentReaction.userId))
    .where(inArray(commentReaction.commentId, commentIds))
    .orderBy(asc(commentReaction.createdAt), asc(commentReaction.userId))
  for (const row of rows) {
    const reactions = byComment.get(row.commentId) ?? []
    const existing = reactions.find((reaction) => reaction.emoji === row.emoji)
    if (existing) {
      existing.count += 1
      existing.people.push({ id: row.id, name: row.name })
    } else {
      reactions.push({ emoji: row.emoji, count: 1, people: [{ id: row.id, name: row.name }] })
    }
    byComment.set(row.commentId, reactions)
  }
  return byComment
}
