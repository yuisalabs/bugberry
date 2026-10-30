import { RiExpandDiagonalLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"
import { startBarDrag, startCameraResize } from "../../lib/recording/bar-drag"
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
  const [round, setRound] = useState(true)
  const surface = useRef<HTMLDivElement>(null)
  const { token, ask, getUserMedia, postToPage } = props

  useEffect(() => {
    let gone = false
    let opened: MediaStream | null = null
    const fail = () => {
      if (!gone) postToPage({ bugberry: "camera-failed" })
    }
    void (async () => {
      const choice = (await ask({ type: "bugberry:camera-ticket", token, action: "read" }).catch(() => null)) as { deviceId?: unknown; shape?: unknown } | null
      if (!choice || gone) return fail()
      setRound(choice.shape !== "rectangle")
      // `ideal`: a camera unplugged since it was chosen falls back to another one.
      const constraints = { video: typeof choice.deviceId === "string" ? { deviceId: { ideal: choice.deviceId } } : true, audio: false }
      try {
        opened = await getUserMedia(constraints)
      } catch {
        // The start waits for the first picture: tell it there won't be one.
        void ask({ type: "bugberry:camera-ticket", token, action: "failed" }).catch(() => {})
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
      ref={surface}
      data-camera-surface
      className="group relative h-screen w-screen cursor-grab overflow-hidden bg-[#1c1022] active:cursor-grabbing"
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
      {/* The white edge: drawn above the picture (the video would cover a shadow on the surface), in the bubble's shape. */}
      <span
        data-slot="camera-edge"
        aria-hidden
        className={`pointer-events-none absolute inset-0 shadow-[inset_0_0_0_3px_#fff] ${round ? "rounded-full" : "rounded-2xl"}`}
      />
      {/* Top-right, on the circle's edge for a circle: shown while the pointer is over the bubble. */}
      <button
        type="button"
        aria-label="Resize camera"
        className={`absolute grid size-6 cursor-nesw-resize place-items-center rounded-full bg-white text-[#1c1022] opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${
          round ? "top-[14.6%] right-[14.6%] translate-x-1/2 -translate-y-1/2" : "top-2 right-2"
        }`}
        onPointerDown={(event) => {
          if (surface.current) startCameraResize(event.nativeEvent, surface.current, { post: postToPage })
        }}
      >
        <RiExpandDiagonalLine size={14} aria-hidden />
      </button>
    </div>
  )
}
