import type { ReplayPlayerHandle } from "@bugberry/replay-player"
import { useRef, useState } from "react"

/** Where a replay is and whether it plays, for the strip under it; the strip moves the player through `player`. */
export function useReplayPosition() {
  const player = useRef<ReplayPlayerHandle>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  // A dragged playhead seeks once a frame at most: each seek rebuilds the page from its last full snapshot.
  const pending = useRef<number | null>(null)
  const seek = (ms: number) => {
    const waiting = pending.current !== null
    pending.current = ms
    if (waiting) return
    requestAnimationFrame(() => {
      if (pending.current !== null) player.current?.seek(pending.current)
      pending.current = null
    })
  }
  const toggle = () => (playing ? player.current?.pause() : player.current?.play())
  return { player, position, setPosition, playing, setPlaying, seek, toggle }
}

export type ReplayPosition = ReturnType<typeof useReplayPosition>
