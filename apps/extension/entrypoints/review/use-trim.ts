import { type RefObject, useRef, useState } from "react"
import type { createDraftWriter } from "../../lib/drafts/draft-writer"
import { draftWithTrim } from "../../lib/review/review-draft"
import type { TrimRange } from "../../lib/review/review-data"
import { createSeeker } from "../../lib/review/seeker"

/** A recording's trim, the strip's frames, and the player as the strip drives it. */
export function useTrim(draftId: string, video: RefObject<HTMLVideoElement | null>, writeDraft: ReturnType<typeof createDraftWriter>) {
  const [trim, setTrim] = useState<TrimRange | null>(null)
  /** The trim waiting to be saved: a handle moves many times a second, and each save writes the whole video. */
  const trimSave = useRef<{ timer: ReturnType<typeof setTimeout>; range: TrimRange | null } | null>(null)
  // Where the player is and whether it plays, for the strip's playhead and play button.
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [frames, setFrames] = useState<string[] | null>(null)

  /** Saves the trim waiting to be saved, now. */
  const saveTrim = async () => {
    const waiting = trimSave.current
    if (!waiting) return
    clearTimeout(waiting.timer)
    trimSave.current = null
    await writeDraft(draftId, (current) => draftWithTrim(current, waiting.range))
  }

  /** A moved handle applies at once (player, tiles, markers); the draft keeps it a moment later. */
  const changeTrim = (range: TrimRange | null) => {
    setTrim(range)
    if (trimSave.current) clearTimeout(trimSave.current.timer)
    trimSave.current = { range, timer: setTimeout(() => void saveTrim(), 400) }
  }

  /** Seeks for the strip one at a time, so a dragged handle or playhead doesn't pile them up (see createSeeker). */
  const seeker = useRef<{ element: HTMLVideoElement; seek(seconds: number): void } | null>(null)
  const seekTo = (ms: number) => {
    const element = video.current
    if (!element) return
    if (seeker.current?.element !== element) seeker.current = { element, ...createSeeker(element) }
    seeker.current.seek(ms / 1000)
  }

  /** The strip's play button: plays the part being kept (the player keeps inside it), or pauses. */
  const playTrim = () => {
    const player = video.current
    if (!player) return
    if (player.paused) {
      void player.play().then(() => setPlaying(true))
    } else {
      player.pause()
      setPlaying(false)
    }
  }

  return { trim, setTrim, position, setPosition, playing, setPlaying, frames, setFrames, saveTrim, changeTrim, seekTo, playTrim }
}
