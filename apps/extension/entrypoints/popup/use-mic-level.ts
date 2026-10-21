import { useEffect, useState } from "react"
import type { LevelSource } from "./PopupView"

const READ_MS = 100
const BARS = 4

/** A level the bars subscribe to; it only tells them when the number of lit bars changes. */
function createLevelSource(): LevelSource & { set(level: number): void } {
  let value = 0
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set(level) {
      const stepped = Math.ceil(Math.min(1, Math.max(0, level)) * BARS) / BARS
      if (stepped === value) return
      value = stepped
      for (const listener of listeners) listener()
    },
  }
}

/**
 * How loud one microphone is right now, read ten times a second while `on`. The microphone is released
 * (and the level drops to 0) as soon as `on` turns false or the popup closes. Reading it never re-renders
 * the popup: only the level bars subscribe.
 */
export function useMicLevel(deviceId: string | null, on: boolean): LevelSource {
  const [source] = useState(createLevelSource)
  useEffect(() => {
    source.set(0)
    if (!on || !navigator.mediaDevices) return
    let stopped = false
    let release = () => {}
    navigator.mediaDevices
      .getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((stream) => {
        const stopTracks = () => {
          for (const track of stream.getTracks()) track.stop()
        }
        if (stopped) return stopTracks()
        const context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        const timer = setInterval(() => {
          analyser.getByteTimeDomainData(samples)
          let peak = 0
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128))
          // Speech rarely peaks past 40% of full scale; scaled up so a normal voice lights most bars.
          source.set((peak / 128) * 2.5)
        }, READ_MS)
        release = () => {
          clearInterval(timer)
          stopTracks()
          void context.close().catch(() => {})
          source.set(0)
        }
      })
      .catch(() => source.set(0))
    return () => {
      stopped = true
      release()
    }
  }, [deviceId, on, source])
  return source
}
