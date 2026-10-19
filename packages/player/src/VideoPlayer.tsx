import { type Ref, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import videojs from "video.js"
import type Player from "video.js/dist/types/player"
import "video.js/dist/video-js.css"
import "./theme.css"
import {
  displayDuration,
  hotkeyAction,
  type MarkerGroup,
  markerLabel,
  formatClock,
  PLAYBACK_RATES,
  placeMarkers,
  SEEK_STEP_SECONDS,
  seekTarget,
  type TimelineMarker,
  type VideoPlayerProps,
} from "./index"

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}

/** Where React draws inside the Video.js DOM: the marker row on the seek bar, the top overlay and the start hint. */
interface Slots {
  markers: HTMLElement
  overlay: HTMLElement
  start: HTMLElement
}

/**
 * The report video, played with Video.js: playback speeds, skip buttons, picture-in-picture and keyboard
 * shortcuts on top of the plain <video>, plus error markers above the timeline and an overlay along the
 * top. The underlying <video> is still handed out through `videoRef`, so the debugger tabs can follow and
 * move the position as before. Changing `src` builds a new player.
 */
export function VideoPlayer({
  src,
  durationMs,
  videoRef,
  onTime,
  onError,
  onLoadedMetadata,
  className,
  markers = [],
  onMarkerClick,
  topLeft,
  topRight,
  startAtSeconds,
}: VideoPlayerProps) {
  const host = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const [slots, setSlots] = useState<Slots | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [length, setLength] = useState<number | null>(durationMs ? durationMs / 1000 : null)
  // Handlers change on every render; the player reads the latest ones instead of being rebuilt.
  const latest = useRef({ durationMs, videoRef, onTime, onError, onLoadedMetadata, startAtSeconds })
  latest.current = { durationMs, videoRef, onTime, onError, onLoadedMetadata, startAtSeconds }

  useEffect(() => {
    const container = host.current
    if (!container) return
    const element = document.createElement("video-js")
    element.classList.add("vjs-bugberry")
    container.appendChild(element)

    const player: Player = videojs(element, {
      controls: true,
      preload: "metadata",
      fluid: true,
      playbackRates: PLAYBACK_RATES,
      controlBar: {
        skipButtons: { backward: SEEK_STEP_SECONDS, forward: SEEK_STEP_SECONDS },
        remainingTimeDisplay: false,
      },
      userActions: {
        hotkeys(this: Player, event: KeyboardEvent) {
          const action = hotkeyAction(event.key)
          if (!action) return
          event.preventDefault()
          if (action.kind === "toggle") void (this.paused() ? this.play() : this.pause())
          else if (action.kind === "mute") this.muted(!this.muted())
          else if (action.kind === "fullscreen") void (this.isFullscreen() ? this.exitFullscreen() : this.requestFullscreen())
          else {
            const total = displayDuration(this.duration() ?? Number.NaN, latest.current.durationMs)
            this.currentTime(seekTarget(this.currentTime() ?? 0, action.by, total))
          }
        },
      },
    })
    playerRef.current = player
    player.src({ src, type: "video/webm" })

    const reportTime = () => {
      const now = player.currentTime() ?? 0
      setSeconds(now)
      latest.current.onTime?.(now * 1000)
    }
    // MediaRecorder files often carry no duration; the recorded one keeps the progress bar usable.
    const fixDuration = () => {
      const own = player.duration() ?? Number.NaN
      const total = displayDuration(own, latest.current.durationMs)
      if (total !== null && !(Number.isFinite(own) && own > 0)) player.duration(total)
      setLength(total)
    }
    player.on("timeupdate", reportTime)
    player.on("seeked", reportTime)
    player.on("error", () => latest.current.onError?.())
    player.on("loadedmetadata", () => {
      fixDuration()
      const start = latest.current.startAtSeconds
      if (start && start > 0) player.currentTime(start)
      latest.current.onLoadedMetadata?.()
    })
    player.on("durationchange", fixDuration)
    player.ready(() => {
      assignRef(latest.current.videoRef, player.el()?.querySelector("video") ?? null)
      const seekBar = player.el()?.querySelector(".vjs-progress-holder")
      const markerRow = document.createElement("div")
      markerRow.className = "bb-markers"
      seekBar?.appendChild(markerRow)
      const overlay = document.createElement("div")
      overlay.className = "bb-overlay"
      player.el()?.appendChild(overlay)
      // The length under the big play button; the theme hides it once playback has started.
      const start = document.createElement("div")
      start.className = "bb-start"
      player.el()?.appendChild(start)
      setSlots({ markers: markerRow, overlay, start })
    })

    return () => {
      setSlots(null)
      playerRef.current = null
      assignRef(latest.current.videoRef, null)
      player.dispose()
    }
  }, [src])

  const jumpTo = (marker: TimelineMarker) => {
    playerRef.current?.currentTime(Math.max(0, marker.atMs / 1000))
    onMarkerClick?.(marker)
  }

  return (
    <div ref={host} className={className} data-vjs-player>
      {slots &&
        createPortal(
          placeMarkers(markers, length).map((group) => <MarkerDot key={group.markers[0]?.id} group={group} onJump={jumpTo} />),
          slots.markers,
        )}
      {slots && length !== null && createPortal(formatClock(length), slots.start)}
      {slots &&
        (topLeft || topRight) &&
        createPortal(
          <>
            <div className="bb-overlay-side">{topLeft}</div>
            <div className="bb-overlay-side">{topRight?.(seconds)}</div>
          </>,
          slots.overlay,
        )}
    </div>
  )
}

/** One dot above the timeline; several events close together share a yellow "×N" pill. */
function MarkerDot({ group, onJump }: { group: MarkerGroup; onJump(marker: TimelineMarker): void }) {
  const first = group.markers[0]
  if (!first) return null
  const details = group.markers.map((marker) => marker.detail).join("\n")
  // The seek bar seeks on pointer down; the dot must not let that through.
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation()
  return (
    <button
      type="button"
      className={`bb-marker bb-marker-${group.markers.length > 1 ? "group" : first.kind}`}
      style={{ left: `${group.leftPercent}%` }}
      title={details}
      aria-label={`Jump to: ${details}`}
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onClick={(event) => {
        event.stopPropagation()
        onJump(first)
      }}
    >
      {markerLabel(group)}
    </button>
  )
}

export default VideoPlayer
