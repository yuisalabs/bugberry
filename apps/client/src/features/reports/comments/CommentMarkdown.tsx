import { RiPlayFill } from "@remixicon/react"
import { memo, useContext } from "react"
import { Markdown } from "@bugberry/ui/markdown"
import { ReportVideoContext } from "../detail/video-context"
import { videoTimes } from "./comment-feed"
import { mentionParts, protectMentions } from "./mentions"

/** Text with "0:52"-style times as buttons that seek the report's video (only on a video report). */
function TimedText({ text }: { text: string }) {
  const video = useContext(ReportVideoContext)
  return (
    <>
      {videoTimes(text, video?.durationMs ?? null).map((part, index) =>
        "text" in part ? (
          part.text
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={index}
            type="button"
            aria-label={`Play from ${part.time}`}
            onClick={() => video?.seek(part.ms)}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-md bg-foreground px-1.5 align-baseline font-mono text-xs leading-5 font-semibold text-background hover:bg-foreground/85"
          >
            <RiPlayFill aria-hidden className="size-3" />
            {part.time}
          </button>
        ),
      )}
    </>
  )
}

/**
 * A comment body as Markdown, with mentions as highlighted names and video times as seek buttons.
 * Memoised so the feed's re-renders (the relative time ticks every minute) do not parse it again; `names` must keep its identity.
 */
export const CommentMarkdown = memo(function CommentMarkdown({ body, names }: { body: string; names: Map<string, string> }) {
  const { text, ids } = protectMentions(body)
  const nameAt = (index: number) => names.get(ids[index] ?? "")

  const renderText = (value: string) =>
    mentionParts(value).map((part, index) => {
      if ("text" in part) {
        // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
        return <TimedText key={index} text={part.text} />
      }
      const name = nameAt(part.mention)
      return name === undefined ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
        <span key={index} className="text-muted-foreground">
          @former member
        </span>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
        <span key={index} className="rounded bg-primary-subtle px-1 font-medium text-primary-subtle-foreground">
          @{name}
        </span>
      )
    })

  const literalText = (value: string) =>
    mentionParts(value)
      .map((part) => ("text" in part ? part.text : `@${nameAt(part.mention) ?? "former member"}`))
      .join("")

  return (
    <Markdown look="comment" renderText={renderText} literalText={literalText}>
      {text}
    </Markdown>
  )
})
