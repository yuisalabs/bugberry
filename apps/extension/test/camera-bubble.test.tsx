import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render } from "@testing-library/react"
import { CameraBubble } from "../entrypoints/camera-bubble/App"
import type { CameraTicketRequest } from "../lib/messages"

function fakeStream() {
  const track = { stop: mock(() => {}) }
  // happy-dom's own MediaStream, so the video takes it; its tracks are this fake one.
  const stream = new MediaStream()
  stream.getTracks = () => [track as unknown as MediaStreamTrack]
  return { stream, track }
}

async function setup(choice: unknown, getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const asked: CameraTicketRequest[] = []
  const ask = mock(async (request: CameraTicketRequest) => {
    asked.push(request)
    return request.action === "read" ? choice : { ok: true }
  })
  const { stream, track } = fakeStream()
  const media = mock(getUserMedia ?? (async () => stream))
  const posted: unknown[] = []
  let view: ReturnType<typeof render> | undefined
  await act(async () => {
    view = render(<CameraBubble token="t1" ask={ask} getUserMedia={media} postToPage={(message) => posted.push(message)} />)
  })
  return { asked, media, posted, track, view: view as ReturnType<typeof render> }
}

describe("the camera bubble", () => {
  test("asks for the chosen camera as ideal, without sound", async () => {
    const { asked, media } = await setup({ deviceId: "cam1", shape: "circle" })
    expect(asked[0]).toEqual({ type: "bugberry:camera-ticket", token: "t1", action: "read" })
    expect(media).toHaveBeenCalledWith({ video: { deviceId: { ideal: "cam1" } }, audio: false })
  })

  test("the default camera when none was chosen", async () => {
    const { media } = await setup({ deviceId: null, shape: "rectangle" })
    expect(media).toHaveBeenCalledWith({ video: true, audio: false })
  })

  test("no grant, no camera", async () => {
    const { media, posted } = await setup(null)
    expect(media).not.toHaveBeenCalled()
    expect(posted).toEqual([{ bugberry: "camera-failed" }])
  })

  test("a camera that fails takes the bubble away", async () => {
    const { posted } = await setup({ deviceId: null, shape: "circle" }, async () => {
      throw new DOMException("busy", "NotReadableError")
    })
    expect(posted).toEqual([{ bugberry: "camera-failed" }])
  })

  test("a camera that fails tells the background, so the start doesn't wait for it", async () => {
    const { asked } = await setup({ deviceId: null, shape: "circle" }, async () => {
      throw new DOMException("blocked", "NotAllowedError")
    })
    expect(asked.at(-1)).toEqual({ type: "bugberry:camera-ticket", token: "t1", action: "failed" })
  })

  test("the picture is mirrored and silent", async () => {
    const { view } = await setup({ deviceId: null, shape: "circle" })
    const video = view.container.querySelector("video") as HTMLVideoElement
    expect(video.style.transform).toBe("scaleX(-1)")
    expect(video.muted).toBe(true)
    expect(video.autoplay).toBe(true)
  })

  test("its first picture says ready", async () => {
    const { asked, view } = await setup({ deviceId: null, shape: "circle" })
    const video = view.container.querySelector("video") as HTMLVideoElement
    await act(async () => {
      fireEvent(video, new Event("playing"))
    })
    expect(asked.at(-1)).toEqual({ type: "bugberry:camera-ticket", token: "t1", action: "ready" })
  })

  test("the camera turns off when the bubble goes", async () => {
    const { track, view } = await setup({ deviceId: null, shape: "circle" })
    view.unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  test("a press on the bubble starts a drag", async () => {
    const { posted, view } = await setup({ deviceId: null, shape: "circle" })
    const surface = view.container.querySelector("[data-camera-surface]") as HTMLElement
    fireEvent.pointerDown(surface, { button: 0, screenX: 10, screenY: 10 })
    expect(posted).toContainEqual({ bugberry: "bar-drag", phase: "start" })
  })

  test("Esc while the bubble has focus goes to the page, for the countdown", async () => {
    const { posted } = await setup({ deviceId: null, shape: "circle" })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(posted).toContainEqual({ bugberry: "escape" })
  })

  test("its corner handle resizes, and doesn't drag", async () => {
    const { posted, view } = await setup({ deviceId: null, shape: "circle" })
    const handle = view.getByRole("button", { name: "Resize camera" })
    fireEvent.pointerDown(handle, { button: 0, screenX: 10, screenY: 10 })
    expect(posted).toContainEqual({ bugberry: "camera-resize", phase: "start" })
    expect(posted).not.toContainEqual({ bugberry: "bar-drag", phase: "start" })
  })
})
