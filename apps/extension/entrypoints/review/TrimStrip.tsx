import { Button } from "@bugberry/ui/button"
import { RiMore2Fill, RiPauseFill, RiPlayFill } from "@remixicon/react"
import { useState } from "react"
import { Slider, SliderThumb, SliderTrack } from "react-aria-components"
import { clampTrim, type TrimRange } from "../../lib/review-data"

const STEP_MS = 100
const THUMB_LABELS = ["Trim start", "Trim end"]

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * The frames of the recording between two handles: the part between them is what is sent, the rest is greyed
 * out. Moving a handle applies at once and shows that moment in the player. The playhead is a slider of its own
 * over the whole strip: it can go anywhere, inside the kept part or not, to look at the video. The play button
 * plays the part that is kept.
 */
export function TrimStrip(props: {
  durationMs: number
  value: TrimRange
  frames: string[]
  /** Where the player is, in ms. */
  positionMs: number
  playing: boolean
  /** A send has started: the handles and Reset no longer move. */
  disabled: boolean
  onChange(range: TrimRange): void
  onPreview(ms: number): void
  onSeek(ms: number): void
  onPlay(): void
  onReset(): void
}) {
  const { durationMs } = props
  // While a handle is dragged only the strip follows it: the page (tiles, markers, player range) updates on release.
  // Updating all of it on every move cost about 34 ms a move with a busy recording.
  const [live, setLive] = useState<TrimRange | null>(null)
  const value = live ?? props.value
  /** The slider's two values as a range, the end reaching the video's end within a step of it. */
  const rangeOf = (values: number | number[]): TrimRange => {
    const [startMs = 0, stepped = durationMs] = values as number[]
    // The slider stops at the last whole step: within a step of the end means the end, so a video that isn't a
    // whole number of steps long can still be kept whole.
    return clampTrim({ startMs, endMs: stepped > durationMs - STEP_MS ? durationMs : stepped }, durationMs)
  }
  const percent = (ms: number) => `${(Math.min(Math.max(ms, 0), durationMs) / Math.max(1, durationMs)) * 100}%`
  const keptSeconds = Math.round((value.endMs - value.startMs) / 1000)
  const PlayIcon = props.playing ? RiPauseFill : RiPlayFill
  // While the playhead is dragged it stays under the pointer; the player catches up one seek at a time.
  const [scrub, setScrub] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button intent="outline" size="sq-sm" aria-label={props.playing ? "Pause selection" : "Play selection"} onPress={props.onPlay}>
          <PlayIcon aria-hidden />
        </Button>
        {/* The handles sit outside the kept part, so the strip leaves room for them at both ends. */}
        <div className="relative mx-4 h-12 min-w-0 flex-1">
          <span className="absolute inset-0 flex overflow-hidden rounded-md bg-foreground/80">
            {props.frames.map((frame, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: frames never reorder
              <img key={index} src={frame} alt="" className="h-full min-w-0 flex-1 object-cover" />
            ))}
          </span>
          <span className="absolute inset-y-0 left-0 rounded-l-md bg-muted-foreground/85" style={{ width: percent(value.startMs) }} />
          <span className="absolute inset-y-0 right-0 rounded-r-md bg-muted-foreground/85" style={{ width: `calc(100% - ${percent(value.endMs)})` }} />
          <span
            className="pointer-events-none absolute inset-y-0 border-y-2 border-primary"
            style={{ left: percent(value.startMs), right: `calc(100% - ${percent(value.endMs)})` }}
          />

          {/* A click or drag anywhere on the frames moves the playhead. */}
          <Slider
            aria-label="Video position"
            className="absolute inset-0"
            minValue={0}
            maxValue={durationMs}
            step={STEP_MS}
            value={scrub ?? Math.min(Math.max(props.positionMs, 0), durationMs)}
            onChange={(ms) => {
              setScrub(ms as number)
              props.onSeek(ms as number)
            }}
            onChangeEnd={() => setScrub(null)}
          >
            <SliderTrack className="h-full w-full cursor-pointer">
              <SliderThumb
                aria-label="Playhead"
                className="top-1/2 flex h-14 w-3 cursor-ew-resize justify-center outline-hidden data-focus-visible:[&>span]:ring-2 data-focus-visible:[&>span]:ring-ring"
              >
                <span className="h-full w-0.5 rounded-full bg-primary" />
              </SliderThumb>
            </SliderTrack>
          </Slider>

          {/* The trim handles, above the playhead; only the handles themselves take the pointer. */}
          <Slider
            aria-label="Trim"
            className="pointer-events-none absolute inset-0"
            minValue={0}
            maxValue={durationMs}
            step={STEP_MS}
            isDisabled={props.disabled}
            value={[value.startMs, value.endMs]}
            onChange={(values) => {
              const next = rangeOf(values)
              setLive(next)
              props.onPreview(next.startMs !== value.startMs ? next.startMs : next.endMs)
            }}
            onChangeEnd={(values) => {
              setLive(null)
              props.onChange(rangeOf(values))
            }}
          >
            <SliderTrack className="h-full w-full">
              {({ state }) =>
                state.values.map((_, index) => (
                  <SliderThumb
                    key={THUMB_LABELS[index]}
                    index={index}
                    aria-label={THUMB_LABELS[index]}
                    // Each handle stands just outside its edge: the start one to its left, the end one to its right.
                    className={`pointer-events-auto top-1/2 z-10 flex h-12 w-4 cursor-ew-resize items-center justify-center bg-primary text-primary-foreground outline-hidden data-disabled:cursor-default data-disabled:opacity-60 data-dragging:brightness-110 data-focus-visible:ring-2 data-focus-visible:ring-ring ${
                      index === 0 ? "-ml-2 rounded-l-md" : "ml-2 rounded-r-md"
                    }`}
                  >
                    <RiMore2Fill data-grip aria-hidden size={14} />
                  </SliderThumb>
                ))
              }
            </SliderTrack>
          </Slider>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-muted-foreground">
          {clock(value.startMs)} – {clock(value.endMs)} · {keptSeconds} s of {Math.round(durationMs / 1000)} s
        </span>
        <Button intent="outline" size="sm" isDisabled={props.disabled} onPress={props.onReset}>
          Reset
        </Button>
      </div>
    </div>
  )
}
