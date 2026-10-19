import { RiDownload2Line, RiLink } from "@remixicon/react"
import { formatClock } from "@bugberry/player"
import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Avatar } from "@bugberry/ui/avatar"
import { Link } from "@bugberry/ui/link"
import type { ReportDetail } from "../lib/api"
import { initialsOf } from "../lib/people"
import { shareUrlAt } from "../lib/urls"

/** Styled by the player's theme (`bb-pill`): Video.js resets buttons inside the player. */
const glass = "bb-pill"

/** Top-left of the video: who recorded it. The page it was recorded on is in DevTools (Info). */
export function VideoReporter({ reporter }: { reporter: ReportDetail["reporter"] }) {
  return (
    <span className="bb-reporter">
      <Avatar src={reporter.image} initials={initialsOf(reporter.name)} size="sm" className="bg-secondary text-secondary-foreground" />
      <span className="bb-reporter-name">{reporter.name}</span>
    </span>
  )
}

/** Top-right of the video: a share link that starts where the viewer is, and the file itself. */
export function VideoShareActions({ shareSlug, seconds, mediaUrl }: { shareSlug: string; seconds: number; mediaUrl: string | null }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrlAt(shareSlug, seconds))
      setState("copied")
    } catch {
      setState("failed")
    }
    setTimeout(() => setState("idle"), 2000)
  }
  return (
    <>
      <AriaButton className={glass} onPress={() => void copy()}>
        <RiLink aria-hidden />
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : `Share at ${formatClock(seconds)}`}
      </AriaButton>
      {mediaUrl && (
        <Link href={mediaUrl} download target="_blank" rel="noreferrer" aria-label="Download video" className={glass}>
          <span title="Download video" className="contents">
            <RiDownload2Line aria-hidden />
          </span>
        </Link>
      )}
    </>
  )
}
