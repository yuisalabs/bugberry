import { Button } from "@bugberry/ui/button"
import { RiPauseFill, RiPlayFill } from "@remixicon/react"
import { useState } from "react"
import { Slider, SliderThumb, SliderTrack } from "react-aria-components"

// The pieces the Trim strip of a video and the strip of a replay share.

export const STRIP_STEP_MS = 100

/** "0:42" for the line under a strip. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function StripPlayButton(props: { label: string; playing: boolean; onPlay(): void }) {
  const PlayIcon = props.playing ? RiPauseFill : RiPlayFill
  return (
    <Button intent="outline" size="sq-sm" aria-label={props.label} onPress={props.onPlay}>
      <PlayIcon aria-hidden />
    </Button>
  )
}

/** The row of frames, filling the strip's 48 px height. */
export function StripFrames({ frames }: { frames: string[] }) {
  return (
    <span className="absolute inset-0 flex overflow-hidden rounded-md bg-foreground/80">
      {frames.map((frame, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: frames never reorder
        <img key={index} src={frame} alt="" className="h-full min-w-0 flex-1 object-cover" />
      ))}
    </span>
  )
}

/** The playhead over the whole strip: a click or drag anywhere on the frames moves it, and the player with it. */
export function Playhead(props: { label: string; durationMs: number; positionMs: number; onSeek(ms: number): void }) {
  const { durationMs } = props
  // While the playhead is dragged it stays under the pointer; the player catches up one seek at a time.
  const [scrub, setScrub] = useState<number | null>(null)
  return (
    <Slider
      aria-label={props.label}
      className="absolute inset-0"
      minValue={0}
      maxValue={durationMs}
      step={STRIP_STEP_MS}
      value={scrub ?? Math.min(Math.max(props.positionMs, 0), durationMs)}
      onChange={(ms) => {
        setScrub(ms as number)
        props.onSeek(ms as number)
      }}
      onChangeEnd={() => setScrub(null)}
    >
      <SliderTrack data-track className="h-full w-full cursor-pointer">
        <SliderThumb
          aria-label="Playhead"
          className="top-1/2 flex h-14 w-3 cursor-ew-resize justify-center outline-hidden data-focus-visible:[&>span]:ring-2 data-focus-visible:[&>span]:ring-ring"
        >
          <span className="h-full w-0.5 rounded-full bg-primary" />
        </SliderThumb>
      </SliderTrack>
    </Slider>
  )
}
