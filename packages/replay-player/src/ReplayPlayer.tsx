import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import rrwebPlayer from "rrweb-player"
import type { eventWithTime } from "@rrweb/types"
import "rrweb-player/dist/style.css"
import "./theme.css"
import { formatClock, type MarkerGroup, markerLabel, placeMarkers, type TimelineMarker } from "@bugberry/player"
import { REPLAY_FRAME_TAG } from "@bugberry/shared"
import {
  activeFrame,
  frameSrc,
  playerSize,
  type ReplayPlayerProps,
  replayAspect,
  type RrwebPlayerLike,
  type RrwebPlayerProps,
  stripFrames,
} from "./index"

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
  topLeft,
  topRight,
  bounded = false,
  className,
  createPlayer = defaultCreatePlayer,
}: ReplayPlayerProps) {
  const stage = useRef<HTMLDivElement>(null)
  const player = useRef<RrwebPlayerLike | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [room, setRoom] = useState<{ width: number; height?: number }>({ width: 0 })
  const aspect = useMemo(() => replayAspect(events), [events])
  // In normal flow the stage is as tall as the player in it, so only a bounded stage's height is room to fit.
  const roomOf = (width: number, height: number) => (bounded ? { width, height } : { width })
  // Callbacks change on every render of the page; the player is built once per recording.
  const latest = useRef({ onTime, createPlayer, startAtSeconds, roomOf, aspect })
  latest.current = { onTime, createPlayer, startAtSeconds, roomOf, aspect }
  const started = useRef(false)
  const playable = events.length >= MIN_EVENTS

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
    const element = stage.current
    if (!element) return
    const measure = (width: number, height: number) => setRoom(latest.current.roomOf(width, height))
    measure(element.clientWidth, element.clientHeight)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [playable, bounded])

  useEffect(() => {
    const target = stage.current
    if (!target || !playable) return
    const created = latest.current.createPlayer(target, {
      events,
      ...playerSize(latest.current.roomOf(target.clientWidth, target.clientHeight), latest.current.aspect),
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
    // Through moveTo, so the strip and the page's panel are at the shared time before anyone presses play.
    if (!started.current && start !== undefined && start > 0) moveTo(start * 1000)
    started.current = true
    return () => {
      player.current = null
      created.$destroy()
    }
  }, [events])

  useEffect(() => {
    const current = player.current
    if (!current) return
    current.$set?.(playerSize({ width: room.width, height: room.height }, aspect))
    current.triggerResize?.()
  }, [room.width, room.height, aspect])

  const strip = stripFrames(frames)
  const active = activeFrame(strip, currentMs)
  const jumpTo = (marker: TimelineMarker) => {
    moveTo(marker.atMs)
    onMarkerClick?.(marker)
  }

  return (
    <div className={`bb-replay ${className ?? ""}`}>
      {(topLeft || topRight) && (
        <div className="bb-replay-bar">
          <div className="bb-replay-bar-side">{topLeft}</div>
          <div className="bb-replay-bar-side">{topRight?.(currentMs / 1000)}</div>
        </div>
      )}
      {!playable ? (
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
