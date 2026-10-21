import { useEffect, useState } from "react"

const READ_MS = 100

/**
 * How loud one microphone is right now, 0..1, read ten times a second while `on`. The microphone is
 * released (and the level drops to 0) as soon as `on` turns false or the popup closes.
 */
export function useMicLevel(deviceId: string | null, on: boolean): number {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    setLevel(0)
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
          setLevel(Math.min(1, (peak / 128) * 2.5))
        }, READ_MS)
        release = () => {
          clearInterval(timer)
          stopTracks()
          void context.close().catch(() => {})
        }
      })
      .catch(() => setLevel(0))
    return () => {
      stopped = true
      release()
    }
  }, [deviceId, on])
  return level
}
