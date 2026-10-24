import { Button } from "@bugberry/ui/button"
import { Slider, SliderThumb, SliderTrack } from "react-aria-components"
import { clampTrim, type TrimRange } from "../../lib/review-data"

const STEP_MS = 100
const THUMB_LABELS = ["Trim start", "Trim end"]

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * The frames of the recording with a frame around the part that is kept: its two edges are dragged (or moved
 * with the arrow keys), the rest is dimmed. Moving an edge shows that moment in the player.
 */
export function TrimStrip(props: {
  durationMs: number
  value: TrimRange
  frames: string[]
  onChange(range: TrimRange): void
  onPreview(ms: number): void
  onReset(): void
  onDone(): void
}) {
  const { durationMs, value } = props
  const percent = (ms: number) => `${(ms / Math.max(1, durationMs)) * 100}%`
  const keptSeconds = Math.round((value.endMs - value.startMs) / 1000)

  return (
    <div className="flex flex-col gap-2">
      <Slider
        aria-label="Trim"
        minValue={0}
        maxValue={durationMs}
        step={STEP_MS}
        value={[value.startMs, value.endMs]}
        onChange={(values) => {
          const [startMs = 0, endMs = durationMs] = values as number[]
          const moved = startMs !== value.startMs ? startMs : endMs
          props.onChange(clampTrim({ startMs, endMs }, durationMs))
          props.onPreview(moved)
        }}
      >
        <SliderTrack className="relative h-12 w-full">
          {({ state }) => (
            <>
              <span className="absolute inset-0 flex overflow-hidden rounded-lg bg-foreground/80">
                {props.frames.map((frame, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: frames never reorder
                  <img key={index} src={frame} alt="" className="h-full min-w-0 flex-1 object-cover" />
                ))}
              </span>
              <span className="absolute inset-y-0 left-0 rounded-l-lg bg-overlay/70" style={{ width: percent(value.startMs) }} />
              <span className="absolute inset-y-0 right-0 rounded-r-lg bg-overlay/70" style={{ width: `calc(100% - ${percent(value.endMs)})` }} />
              <span
                className="pointer-events-none absolute inset-y-0 rounded-lg border-y-[3px] border-primary"
                style={{ left: percent(value.startMs), right: `calc(100% - ${percent(value.endMs)})` }}
              />
              {state.values.map((_, index) => (
                <SliderThumb
                  key={THUMB_LABELS[index]}
                  index={index}
                  aria-label={THUMB_LABELS[index]}
                  className="top-0 h-12 w-3 rounded-md bg-primary shadow outline-hidden data-focus-visible:ring-2 data-focus-visible:ring-ring"
                />
              ))}
            </>
          )}
        </SliderTrack>
      </Slider>
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
