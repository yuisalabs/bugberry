import { useEffect, useRef, useState } from "react"
import { startBarDrag } from "../../lib/bar-drag"
import type { CameraTicketRequest } from "../../lib/messages"

/**
 * The reporter's camera, in its bubble on the recorded tab. It opens the camera only with the recording's
 * grant (`token`, from the frame's URL): the page can embed this page, but its token gets no answer outside
 * the recorded tab. Whatever goes wrong, the bubble takes itself away and the recording goes on without it.
 */
export function CameraBubble(props: {
  token: string
  ask(request: CameraTicketRequest): Promise<unknown>
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  /** To the page layer: drags, and "camera-failed". */
  postToPage(message: unknown): void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const { token, ask, getUserMedia, postToPage } = props

  useEffect(() => {
    let gone = false
    let opened: MediaStream | null = null
    const fail = () => {
      if (!gone) postToPage({ bugberry: "camera-failed" })
    }
    void (async () => {
      const choice = (await ask({ type: "bugberry:camera-ticket", token, action: "read" }).catch(() => null)) as { deviceId?: unknown } | null
      if (!choice || gone) return fail()
      // `ideal`: a camera unplugged since it was chosen falls back to another one.
      const constraints = { video: typeof choice.deviceId === "string" ? { deviceId: { ideal: choice.deviceId } } : true, audio: false }
      try {
        opened = await getUserMedia(constraints)
      } catch {
        return fail()
      }
      if (gone) {
        for (const track of opened.getTracks()) track.stop()
        return
      }
      setStream(opened)
    })()
    return () => {
      gone = true
      for (const track of opened?.getTracks() ?? []) track.stop()
    }
  }, [token, ask, getUserMedia, postToPage])

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  // A press on the bubble gives it the focus: Esc must still cancel the countdown on the page.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") postToPage({ bugberry: "escape" })
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [postToPage])

  return (
    <div
      data-camera-surface
      className="h-screen w-screen cursor-grab overflow-hidden bg-[#1c1022] active:cursor-grabbing"
      // A white edge, drawn inside so the frame's own size stays the bubble's.
      style={{ boxShadow: "inset 0 0 0 3px #fff" }}
      onPointerDown={(event) => startBarDrag(event.nativeEvent, event.currentTarget, { post: postToPage })}
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        // Mirrored, the way people expect to see themselves.
        style={{ transform: "scaleX(-1)" }}
        className="pointer-events-none size-full object-cover"
        onPlaying={() => void ask({ type: "bugberry:camera-ticket", token, action: "ready" }).catch(() => {})}
      />
    </div>
  )
}
