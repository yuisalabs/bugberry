import { Button } from "@bugberry/ui/button"
import { RiMore2Fill, RiPauseFill, RiPlayFill } from "@remixicon/react"
import { Slider, SliderThumb, SliderTrack } from "react-aria-components"
import { clampTrim, type TrimRange } from "../../lib/review-data"

const STEP_MS = 100
const THUMB_LABELS = ["Trim start", "Trim end"]

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * The frames of the recording between two handles: the part between them is kept, the rest is greyed out. The
 * handles are dragged (or moved with the arrow keys); moving one shows that moment in the player. The play button
 * plays the part that is kept, and a line follows where the player is.
 */
export function TrimStrip(props: {
  durationMs: number
  value: TrimRange
  frames: string[]
  /** Where the player is, in ms. */
  positionMs: number
  playing: boolean
  onChange(range: TrimRange): void
  onPreview(ms: number): void
  onPlay(): void
  onReset(): void
  onDone(): void
}) {
  const { durationMs, value } = props
  const percent = (ms: number) => `${(Math.min(Math.max(ms, 0), durationMs) / Math.max(1, durationMs)) * 100}%`
  const keptSeconds = Math.round((value.endMs - value.startMs) / 1000)
  const PlayIcon = props.playing ? RiPauseFill : RiPlayFill

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button intent="outline" size="sq-sm" aria-label={props.playing ? "Pause selection" : "Play selection"} onPress={props.onPlay}>
          <PlayIcon aria-hidden />
        </Button>
        <Slider
          aria-label="Trim"
          className="min-w-0 flex-1"
          minValue={0}
          maxValue={durationMs}
          step={STEP_MS}
          value={[value.startMs, value.endMs]}
          onChange={(values) => {
            const [startMs = 0, stepped = durationMs] = values as number[]
            // The slider stops at the last whole step: within a step of the end means the end, so a video that isn't
            // a whole number of steps long can still be kept whole.
            const endMs = stepped > durationMs - STEP_MS ? durationMs : stepped
            const moved = startMs !== value.startMs ? startMs : endMs
            props.onChange(clampTrim({ startMs, endMs }, durationMs))
            props.onPreview(moved)
          }}
        >
          {/* The handles sit outside the kept part, so the track leaves room for them at both ends. */}
          <SliderTrack className="relative mx-4 h-12">
            {({ state }) => (
              <>
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
                <span
                  data-playhead
                  aria-hidden
                  className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary"
                  style={{ left: percent(props.positionMs) }}
                />
                {state.values.map((_, index) => (
                  <SliderThumb
                    key={THUMB_LABELS[index]}
                    index={index}
                    aria-label={THUMB_LABELS[index]}
                    // Each handle stands just outside its edge: the start one to its left, the end one to its right.
                    className={`top-1/2 flex h-12 w-4 cursor-ew-resize items-center justify-center bg-primary text-primary-foreground outline-hidden data-dragging:brightness-110 data-focus-visible:ring-2 data-focus-visible:ring-ring ${
                      index === 0 ? "-ml-2 rounded-l-md" : "ml-2 rounded-r-md"
                    }`}
                  >
                    <RiMore2Fill data-grip aria-hidden size={14} />
                  </SliderThumb>
                ))}
              </>
            )}
          </SliderTrack>
        </Slider>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-muted-foreground">
          {clock(value.startMs)} – {clock(value.endMs)} · {keptSeconds} s of {Math.round(durationMs / 1000)} s
        </span>
        <span className="flex gap-2">
          <Button intent="outline" size="sm" onPress={props.onReset}>
            Reset
          </Button>
          <Button size="sm" onPress={props.onDone}>
            Done
          </Button>
        </span>
      </div>
    </div>
  )
}
