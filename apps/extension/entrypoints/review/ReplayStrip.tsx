import type { ReplayFrame } from "@bugberry/shared"
import { useMemo } from "react"
import { replayStripFrames } from "../../lib/review/replay-strip-frames"
import { clock, Playhead, StripFrames, StripPlayButton } from "./strip-parts"

/** As many slots as the video's Trim strip has frames. */
const SLOTS = 10

/** Under a replay, as the Trim strip is under a video: its screenshots, a playhead and the play button. Nothing is cut. */
export function ReplayStrip(props: {
  durationMs: number
  frames: ReplayFrame[]
  /** Where the player is, in ms. */
  positionMs: number
  playing: boolean
  onSeek(ms: number): void
  onPlay(): void
}) {
  const { durationMs } = props
  const frames = useMemo(() => replayStripFrames(props.frames, durationMs, SLOTS), [props.frames, durationMs])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <StripPlayButton label={props.playing ? "Pause" : "Play"} playing={props.playing} onPlay={props.onPlay} />
        <div className="relative h-12 min-w-0 flex-1">
          <StripFrames frames={frames} />
          <Playhead label="Replay position" durationMs={durationMs} positionMs={props.positionMs} onSeek={props.onSeek} />
        </div>
      </div>
      <span className="text-sm tabular-nums text-muted-foreground">
        {clock(0)} – {clock(durationMs)} · {Math.round(durationMs / 1000)} s
      </span>
    </div>
  )
}
