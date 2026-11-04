import { type KeyboardEvent, type PointerEvent, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import rrwebPlayer from "rrweb-player"
import type { eventWithTime } from "@rrweb/types"
import "rrweb-player/dist/style.css"
import "./theme.css"
import { formatClock, hotkeyAction, type MarkerGroup, markerLabel, placeMarkers, seekTarget, type TimelineMarker } from "@bugberry/player"
import {
  activeFrame,
  frameSrc,
  nextSpeed,
  playerSize,
  type ReplayPlayerProps,
  replayAspect,
  type RrwebPlayerLike,
  type RrwebPlayerProps,
  stripFrames,
} from "./index"

/** rrweb's Replayer throws on fewer: a stream needs its Meta event and at least one more. */
const MIN_EVENTS = 2

function defaultCreatePlayer(target: HTMLElement, props: RrwebPlayerProps): RrwebPlayerLike {
  // rrweb's own event type stays at this boundary; the rest of the app reads ReplayEvent.
  const player = new rrwebPlayer({ target, props: { ...props, events: props.events as unknown as eventWithTime[] } })
  return player as unknown as RrwebPlayerLike
}

/**
 * A DOM replay played with rrweb-player under controls drawn like the video player's, with the report's markers on
 * its progress line and, below it, a marker row and a strip of its screenshots. The page moves it through
 * `playerRef`; a new `events` builds a new player, a new size only rescales the one there is.
 */
export function ReplayPlayer({
  events,
  durationMs,
  frames,
  markers = [],
  onMarkerClick,
  onTime,
  onPlayingChange,
  startAtSeconds,
  playerRef,
  topLeft,
  topRight,
  bounded = false,
  strip = true,
  className,
  createPlayer = defaultCreatePlayer,
}: ReplayPlayerProps) {
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<RrwebPlayerLike | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Like Video.js: the big play button until the first play, the control bar after it.
  const [started, setStarted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [room, setRoom] = useState<{ width: number; height?: number }>({ width: 0 })
  const aspect = useMemo(() => replayAspect(events), [events])
  // In normal flow the stage is as tall as the player in it, so only a bounded stage's height is room to fit.
  const roomOf = (width: number, height: number) => (bounded || fullscreen ? { width, height } : { width })
  // Callbacks change on every render of the page; the player is built once per recording.
  const latest = useRef({ onTime, onPlayingChange, createPlayer, startAtSeconds, roomOf, aspect })
  latest.current = { onTime, onPlayingChange, createPlayer, startAtSeconds, roomOf, aspect }
  const startApplied = useRef(false)
  const playable = events.length >= MIN_EVENTS
  const box = playerSize(room, aspect)

  const moveTo = (ms: number) => {
    const at = Math.min(Math.max(ms, 0), durationMs)
    player.current?.goto(at)
    setCurrentMs(at)
    latest.current.onTime?.(at)
  }
  const play = () => {
    setStarted(true)
    player.current?.play()
  }
  const pause = () => player.current?.pause()
  const toggle = () => (playing ? pause() : play())
  const changeSpeed = () => {
    const next = nextSpeed(speed)
    player.current?.getReplayer().setConfig({ speed: next })
    setSpeed(next)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }

  useImperativeHandle(
    playerRef,
    () => ({
      seek: moveTo,
      play,
      pause,
      currentMs: () => player.current?.getReplayer().getCurrentTime() ?? 0,
    }),
    [durationMs],
  )

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stage.current)
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])

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
  }, [playable, bounded, fullscreen])

  useEffect(() => {
    const target = host.current
    const outer = stage.current
    if (!target || !outer || !playable) return
    const created = latest.current.createPlayer(target, {
      events,
      ...playerSize(latest.current.roomOf(outer.clientWidth, outer.clientHeight), latest.current.aspect),
      autoPlay: false,
      showController: false,
      skipInactive: false,
    })
    created.addEventListener("ui-update-current-time", ({ payload }) => {
      if (typeof payload !== "number") return
      setCurrentMs(payload)
      latest.current.onTime?.(payload)
    })
    created.addEventListener("ui-update-player-state", ({ payload }) => {
      const now = payload === "playing"
      if (now) setStarted(true)
      setPlaying(now)
      latest.current.onPlayingChange?.(now)
    })
    player.current = created
    setSpeed(1)
    const start = latest.current.startAtSeconds
    // Through moveTo, so the strip and the page's panel are at the shared time before anyone presses play.
    if (!startApplied.current && start !== undefined && start > 0) moveTo(start * 1000)
    startApplied.current = true
    return () => {
      player.current = null
      created.$destroy()
    }
  }, [events])

  useEffect(() => {
    const current = player.current
    if (!current) return
    current.$set?.(box)
    current.triggerResize?.()
  }, [box.width, box.height])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A focused button answers Space and Enter itself.
    if ((event.target as HTMLElement).tagName === "BUTTON") return
    const action = hotkeyAction(event.key)
    if (!action || action.kind === "mute") return
    event.preventDefault()
    if (action.kind === "toggle") toggle()
    else if (action.kind === "fullscreen") toggleFullscreen()
    else moveTo(seekTarget(currentMs / 1000, action.by, durationMs / 1000) * 1000)
  }

  // A drag seeks once a frame at most: each goto rebuilds the page from its last full snapshot.
  const dragging = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const pointerMs = (event: PointerEvent<HTMLDivElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return null
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * durationMs
  }
  const onSeekDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // No active pointer to capture (a synthetic event): the drag ends with the button anyway.
    }
    const ms = pointerMs(event)
    if (ms !== null) moveTo(ms)
  }
  const onSeekMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const ms = pointerMs(event)
    if (ms === null) return
    const waiting = pendingSeek.current !== null
    pendingSeek.current = ms
    if (waiting) return
    requestAnimationFrame(() => {
      if (pendingSeek.current !== null) moveTo(pendingSeek.current)
      pendingSeek.current = null
    })
  }
  const onSeekEnd = () => {
    dragging.current = false
  }

  const shown = stripFrames(frames)
  const active = activeFrame(shown, currentMs)
  const groups = placeMarkers(markers, durationMs / 1000)
  const jumpTo = (marker: TimelineMarker) => {
    moveTo(marker.atMs)
    onMarkerClick?.(marker)
  }
  const percent = `${(Math.min(currentMs, durationMs) / Math.max(1, durationMs)) * 100}%`
  const clock = `${formatClock(currentMs / 1000)} / ${formatClock(durationMs / 1000)}`

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
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the player takes the video's hotkeys while focused
        <div ref={stage} className="bb-replay-stage" tabIndex={0} onKeyDown={onKeyDown} data-playing={playing}>
          <div className="bb-replay-screen" style={{ width: box.width, height: box.height }}>
            <div ref={host} className="bb-replay-host" />
            {/* A click on the picture plays or pauses, as on the video. */}
            <div className="bb-replay-hit" aria-hidden onClick={toggle} />
            {!started && (
              <>
                <button type="button" className="bb-replay-big-play" aria-label="Play" onClick={play}>
                  <PlayIcon />
                </button>
                <span className="bb-replay-start">{formatClock(durationMs / 1000)}</span>
              </>
            )}
            {started && (
              <div className="bb-replay-controls">
                <div className="bb-replay-progress">
                  <div
                    role="slider"
                    aria-label="Progress"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(durationMs / 1000)}
                    aria-valuenow={Math.round(currentMs / 1000)}
                    aria-valuetext={`${formatClock(currentMs / 1000)} of ${formatClock(durationMs / 1000)}`}
                    tabIndex={0}
                    className="bb-replay-seek"
                    onPointerDown={onSeekDown}
                    onPointerMove={onSeekMove}
                    onPointerUp={onSeekEnd}
                    onPointerCancel={onSeekEnd}
                  >
                    <div className="bb-replay-line">
                      <div className="bb-replay-played" style={{ width: percent }} />
                    </div>
                  </div>
                  <div className="bb-replay-dots">
                    {groups.map((group) => (
                      <MarkerDot key={group.markers[0]?.id} group={group} onJump={jumpTo} />
                    ))}
                  </div>
                </div>
                <button type="button" className="bb-replay-button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <span className="bb-replay-time">{clock}</span>
                <span className="bb-replay-spacer" />
                <button type="button" className="bb-replay-button bb-replay-speed" aria-label={`Speed ${speed}x`} onClick={changeSpeed}>
                  {`${speed}x`}
                </button>
                <button type="button" className="bb-replay-button" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
                  <FullscreenIcon />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {strip && groups.length > 0 && (
        <div className="bb-replay-markers">
          {groups.map((group) => (
            <MarkerDot key={group.markers[0]?.id} group={group} onJump={jumpTo} />
          ))}
        </div>
      )}
      {strip && shown.length > 0 && (
        <div role="list" aria-label="Screenshots" className="bb-replay-strip">
          {shown.map((frame, index) => (
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

/** One dot on the progress line or the marker row; several events close together share a "×N" pill. */
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
      // The progress line seeks on pointer down; a dot must not let that through.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onJump(first)}
    >
      {markerLabel(group)}
    </button>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.376 12.416L8.777 19.482A.5.5 0 0 1 8 19.066V4.934a.5.5 0 0 1 .777-.416l10.599 7.066a.5.5 0 0 1 0 .832z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5h3v14H6V5zm9 0h3v14h-3V5z" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 3h2v6h-2V5h-4V3h4zM4 3h4v2H4v4H2V3h2zm16 16v-4h2v6h-4v-2h2zM4 19h4v2H2v-6h2v4z" />
    </svg>
  )
}

export default ReplayPlayer
