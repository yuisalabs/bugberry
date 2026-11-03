import { useEffect, useImperativeHandle, useRef, useState } from "react"
import rrwebPlayer from "rrweb-player"
import type { eventWithTime } from "@rrweb/types"
import "rrweb-player/dist/style.css"
import "./theme.css"
import { formatClock, type MarkerGroup, markerLabel, placeMarkers, type TimelineMarker } from "@bugberry/player"
import { REPLAY_FRAME_TAG } from "@bugberry/shared"
import { activeFrame, frameSrc, playerSize, type ReplayPlayerProps, type RrwebPlayerLike, type RrwebPlayerProps, stripFrames } from "./index"

const FRAME_MARKER_COLOR = "#2563eb"
/** rrweb's Replayer throws on fewer: a stream needs its Meta event and at least one more. */
const MIN_EVENTS = 2

function defaultCreatePlayer(target: HTMLElement, props: RrwebPlayerProps): RrwebPlayerLike {
  // rrweb's own event type stays at this boundary; the rest of the app reads ReplayEvent.
  const player = new rrwebPlayer({ target, props: { ...props, events: props.events as unknown as eventWithTime[] } })
  return player as unknown as RrwebPlayerLike
}

/**
 * A DOM replay played with rrweb-player, with the report's markers above a strip of its screenshots. The page moves
 * it through `playerRef`; a new `events` builds a new player, a new size only rescales the one there is.
 */
export function ReplayPlayer({
  events,
  durationMs,
  frames,
  markers = [],
  onMarkerClick,
  onTime,
  startAtSeconds,
  playerRef,
  className,
  createPlayer = defaultCreatePlayer,
}: ReplayPlayerProps) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const player = useRef<RrwebPlayerLike | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [width, setWidth] = useState(0)
  // Callbacks change on every render of the page; the player is built once per recording.
  const latest = useRef({ onTime, createPlayer, startAtSeconds, width })
  latest.current = { onTime, createPlayer, startAtSeconds, width }
  const started = useRef(false)

  const moveTo = (ms: number) => {
    const at = Math.min(Math.max(ms, 0), durationMs)
    player.current?.goto(at)
    setCurrentMs(at)
    latest.current.onTime?.(at)
  }

  useImperativeHandle(
    playerRef,
    () => ({
      seek: moveTo,
      play: () => player.current?.play(),
      pause: () => player.current?.pause(),
      currentMs: () => player.current?.getReplayer().getCurrentTime() ?? 0,
    }),
    [durationMs],
  )

  useEffect(() => {
    const element = host.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const target = stage.current
    if (!target || events.length < MIN_EVENTS) return
    const created = latest.current.createPlayer(target, {
      events,
      ...playerSize({ width: latest.current.width }),
      autoPlay: false,
      showController: true,
      skipInactive: false,
      tags: { [REPLAY_FRAME_TAG]: FRAME_MARKER_COLOR },
    })
    created.addEventListener("ui-update-current-time", ({ payload }) => {
      setCurrentMs(payload)
      latest.current.onTime?.(payload)
    })
    player.current = created
    const start = latest.current.startAtSeconds
    if (!started.current && start !== undefined && start > 0) created.goto(start * 1000)
    started.current = true
    return () => {
      player.current = null
      created.$destroy()
    }
  }, [events])

  useEffect(() => {
    player.current?.$set?.(playerSize({ width }))
  }, [width])

  const strip = stripFrames(frames)
  const active = activeFrame(strip, currentMs)
  const jumpTo = (marker: TimelineMarker) => {
    moveTo(marker.atMs)
    onMarkerClick?.(marker)
  }

  return (
    <div ref={host} className={`bb-replay ${className ?? ""}`}>
      {events.length < MIN_EVENTS ? (
        <p className="bb-replay-empty">This replay is too short to play.</p>
      ) : (
        <div ref={stage} className="bb-replay-stage" />
      )}
      {markers.length > 0 && (
        <div className="bb-replay-markers">
          {placeMarkers(markers, durationMs / 1000).map((group) => (
            <MarkerDot key={group.markers[0]?.id} group={group} onJump={jumpTo} />
          ))}
        </div>
      )}
      {strip.length > 0 && (
        <div role="list" aria-label="Screenshots" className="bb-replay-strip">
          {strip.map((frame, index) => (
            <button
              key={frame.atMs}
              type="button"
              role="listitem"
              aria-label={`Screenshot at ${formatClock(frame.atMs / 1000)}`}
              aria-current={index === active ? "true" : undefined}
              className="bb-replay-frame"
              onClick={() => moveTo(frame.atMs)}
            >
              <img src={frameSrc(frame)} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One dot on the marker row; several events close together share a "×N" pill. */
function MarkerDot({ group, onJump }: { group: MarkerGroup; onJump(marker: TimelineMarker): void }) {
  const first = group.markers[0]
  if (!first) return null
  const details = group.markers.map((marker) => marker.detail).join("\n")
  return (
    <button
      type="button"
      className={`bb-replay-marker bb-replay-marker-${group.markers.length > 1 ? "group" : first.kind}`}
      style={{ left: `${group.leftPercent}%` }}
      title={details}
      aria-label={`Jump to: ${details}`}
      onClick={() => onJump(first)}
    >
      {markerLabel(group)}
    </button>
  )
}

export default ReplayPlayer
