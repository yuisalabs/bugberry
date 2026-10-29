import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { VideoPlayerProps } from "@bugberry/player"
import { createRef } from "react"
import { MediaViewer } from "../src/features/reports/detail/MediaViewer"

/** Stands in for the Video.js player: a plain <video> wired the way the real one reports events. */
const players: VideoPlayerProps[] = []
function StubPlayer(props: VideoPlayerProps) {
  players.push(props)
  return (
    <video
      ref={props.videoRef}
      src={props.src}
      onError={props.onError}
      onLoadedMetadata={props.onLoadedMetadata}
      onTimeUpdate={(event) => props.onTime?.(event.currentTarget.currentTime * 1000)}
      onSeeked={(event) => props.onTime?.(event.currentTarget.currentTime * 1000)}
    />
  )
}

const screenshot = (mediaUrl: string, id = "r1") => ({ id, captureType: "screenshot" as const, mediaUrl })
const image = () => screen.getByRole("img", { name: "Report screenshot" })

describe("MediaViewer", () => {
  test("reports the playback position and can be driven through its ref", () => {
    const onTime = mock()
    const ref = createRef<HTMLVideoElement>()
    const { container } = render(
      <MediaViewer
        report={{ id: "r1", captureType: "video", mediaUrl: "https://files.test/1.webm" }}
        onExpired={() => {}}
        onTime={onTime}
        videoRef={ref}
        player={StubPlayer}
      />,
    )
    const video = container.querySelector("video") as HTMLVideoElement
    expect(ref.current).toBe(video)
    Object.defineProperty(video, "currentTime", { value: 2.5, configurable: true })
    fireEvent.timeUpdate(video)
    expect(onTime).toHaveBeenLastCalledWith(2500)
    fireEvent.seeked(video)
    expect(onTime).toHaveBeenCalledTimes(2)
  })

  test("a video that loaded its metadata re-arms the automatic refresh", () => {
    const onExpired = mock()
    const video = (url: string) => ({ id: "r1", captureType: "video" as const, mediaUrl: url })
    const { container, rerender } = render(<MediaViewer report={video("https://files.test/1.webm")} onExpired={onExpired} player={StubPlayer} />)
    fireEvent.error(container.querySelector("video") as HTMLVideoElement)
    rerender(<MediaViewer report={video("https://files.test/2.webm")} onExpired={onExpired} player={StubPlayer} />)
    fireEvent.loadedMetadata(container.querySelector("video") as HTMLVideoElement)
    fireEvent.error(container.querySelector("video") as HTMLVideoElement)
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  test("asks for a fresh URL once, then offers a manual retry", () => {
    const onExpired = mock()
    const { rerender } = render(<MediaViewer report={screenshot("https://files.test/1.png")} onExpired={onExpired} />)
    fireEvent.error(image())
    expect(onExpired).toHaveBeenCalledTimes(1)

    rerender(<MediaViewer report={screenshot("https://files.test/2.png")} onExpired={onExpired} />)
    expect(image().getAttribute("src")).toBe("https://files.test/2.png")
    fireEvent.error(image())
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Couldn't load the media.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  test("a successful load re-arms the automatic refresh", () => {
    const onExpired = mock()
    const { rerender } = render(<MediaViewer report={screenshot("https://files.test/1.png")} onExpired={onExpired} />)
    fireEvent.error(image())
    rerender(<MediaViewer report={screenshot("https://files.test/2.png")} onExpired={onExpired} />)
    fireEvent.load(image())
    fireEvent.error(image())
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  test("a freshly signed URL from an unrelated refetch does not reload the media", () => {
    const onExpired = mock()
    const { rerender } = render(<MediaViewer report={screenshot("https://files.test/1.png")} onExpired={onExpired} />)
    fireEvent.load(image())
    rerender(<MediaViewer report={screenshot("https://files.test/1-resigned.png")} onExpired={onExpired} />)
    expect(image().getAttribute("src")).toBe("https://files.test/1.png")

    const video = { id: "r2", captureType: "video" as const }
    const { container, rerender: rerenderVideo } = render(
      <MediaViewer report={{ ...video, mediaUrl: "https://files.test/v.webm" }} onExpired={onExpired} player={StubPlayer} />,
    )
    const player = container.querySelector("video")
    rerenderVideo(<MediaViewer report={{ ...video, mediaUrl: "https://files.test/v-resigned.webm" }} onExpired={onExpired} player={StubPlayer} />)
    expect(container.querySelector("video")).toBe(player)
    expect(player?.getAttribute("src")).toBe("https://files.test/v.webm")
    expect(onExpired).not.toHaveBeenCalled()
  })

  test("another report starts fresh", () => {
    const { rerender } = render(<MediaViewer report={screenshot("https://files.test/1.png")} onExpired={() => {}} />)
    fireEvent.error(image())
    rerender(<MediaViewer report={screenshot("https://files.test/1b.png")} onExpired={() => {}} />)
    fireEvent.error(image())
    expect(screen.getByText("Couldn't load the media.")).toBeTruthy()
    rerender(<MediaViewer report={screenshot("https://files.test/2.png", "r2")} onExpired={() => {}} />)
    expect(image().getAttribute("src")).toBe("https://files.test/2.png")
  })

  test("a click opens the screenshot in the image viewer, which closes again", () => {
    render(<MediaViewer report={screenshot("https://files.test/1.png")} onExpired={() => {}} />)
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot" }))
    const viewer = within(screen.getByRole("dialog", { name: "Screenshot viewer" }))
    expect(viewer.getByRole("img", { name: "Report screenshot" }).getAttribute("src")).toBe("https://files.test/1.png")
    expect(viewer.getByRole("link", { name: "Download screenshot" }).getAttribute("href")).toBe("https://files.test/1.png")
    fireEvent.click(viewer.getByRole("button", { name: "Actual size" }))
    expect(viewer.getByRole("button", { name: "Fit to screen" })).toBeTruthy()
    fireEvent.click(viewer.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("markers, the overlay and the start time reach the player", () => {
    players.length = 0
    const marker = { id: "1", atMs: 2000, kind: "error" as const, label: "×", detail: "boom" }
    const topRight = () => null
    render(
      <MediaViewer
        report={{ id: "r1", captureType: "video", mediaUrl: "https://files.test/1.webm" }}
        onExpired={() => {}}
        player={StubPlayer}
        markers={[marker]}
        topLeft="Ervalsa"
        topRight={topRight}
        startAtSeconds={3}
      />,
    )
    expect(players.at(-1)).toMatchObject({ markers: [marker], topLeft: "Ervalsa", topRight, startAtSeconds: 3 })
  })

  test("videos play in the shared player, with the recorded duration", () => {
    players.length = 0
    render(
      <MediaViewer
        report={{ id: "r1", captureType: "video", mediaUrl: "https://files.test/1.webm", durationMs: 42_000 }}
        onExpired={() => {}}
        player={StubPlayer}
      />,
    )
    expect(players.at(-1)).toMatchObject({ src: "https://files.test/1.webm", durationMs: 42_000 })
  })
})
