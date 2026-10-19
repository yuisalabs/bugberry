import type { VideoPlayerProps } from "@bugberry/player"
import { type ComponentType, lazy, type Ref, Suspense, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import type { ReportDetail } from "../lib/api"
import { ImageViewer } from "./ImageViewer"

type MediaReport = Pick<ReportDetail, "id" | "captureType" | "mediaUrl"> & { durationMs?: number | null }

/** Video.js is only downloaded when a video report is opened. */
const VideoJsPlayer = lazy(() => import("@bugberry/player/video-player"))

/**
 * The screenshot (click to open it in the image viewer) or the video. Read URLs expire, so the first load error asks for
 * a fresh URL. A second error in a row stops and offers a manual retry, so a broken file cannot loop.
 *
 * Every detail fetch returns newly signed URLs; the viewer keeps the one it is showing and only takes
 * a new one when it asked for it (or the report changed), so a status edit does not restart a video.
 */
export function MediaViewer({
  report,
  onExpired,
  videoRef,
  onTime,
  player: Player = VideoJsPlayer,
  markers,
  topLeft,
  topRight,
  startAtSeconds,
}: Pick<VideoPlayerProps, "markers" | "topLeft" | "topRight" | "startAtSeconds"> & {
  report: MediaReport
  onExpired: () => void
  videoRef?: Ref<HTMLVideoElement>
  /** Player position in ms, on every time update and seek. */
  onTime?: (ms: number) => void
  /** The video player; tests pass a plain one instead of Video.js. */
  player?: ComponentType<VideoPlayerProps>
}) {
  const [shown, setShown] = useState({ id: report.id, url: report.mediaUrl })
  const [awaitingUrl, setAwaitingUrl] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [failed, setFailed] = useState(false)
  // Forces a fresh image or player on manual retry, even when the URL did not change.
  const [attempt, setAttempt] = useState(0)

  if (shown.id !== report.id) {
    setShown({ id: report.id, url: report.mediaUrl })
    setAwaitingUrl(false)
    setViewing(false)
    setRefreshed(false)
    setFailed(false)
  } else if (awaitingUrl && report.mediaUrl !== shown.url) {
    setShown({ id: report.id, url: report.mediaUrl })
    setAwaitingUrl(false)
    setFailed(false)
  }

  const requestFreshUrl = () => {
    setAwaitingUrl(true)
    onExpired()
  }
  const handleError = () => {
    if (!refreshed) {
      setRefreshed(true)
      requestFreshUrl()
      return
    }
    setFailed(true)
  }
  const handleLoad = () => {
    setRefreshed(false)
    setFailed(false)
  }
  const retry = () => {
    setFailed(false)
    setRefreshed(true)
    setAttempt((value) => value + 1)
    requestFreshUrl()
  }

  if (!shown.url) {
    return <p className="rounded-lg border border-border bg-background p-10 text-center text-sm text-muted-foreground">No media available.</p>
  }
  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10 text-sm">
        <p className="text-danger-subtle-foreground">Couldn't load the media.</p>
        <Button size="sm" intent="outline" onPress={retry}>
          Try again
        </Button>
      </div>
    )
  }
  if (report.captureType === "video") {
    return (
      <Suspense fallback={<div className="aspect-video w-full rounded-xl bg-[#1C1022]" />}>
        <Player
          key={`${shown.url}-${attempt}`}
          src={shown.url}
          durationMs={report.durationMs ?? null}
          videoRef={videoRef}
          onError={handleError}
          onLoadedMetadata={handleLoad}
          onTime={onTime}
          markers={markers}
          topLeft={topLeft}
          topRight={topRight}
          startAtSeconds={startAtSeconds}
          className="w-full"
        />
      </Suspense>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-background">
      <AriaButton
        onPress={() => setViewing(true)}
        aria-label="Open screenshot"
        className="block w-full cursor-zoom-in rounded-lg outline-hidden focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <img
          key={`${shown.url}-${attempt}`}
          src={shown.url}
          alt="Report screenshot"
          onError={handleError}
          onLoad={handleLoad}
          className="max-h-[70vh] w-full object-contain"
        />
      </AriaButton>
      <ImageViewer src={shown.url} alt="Report screenshot" isOpen={viewing} onOpenChange={setViewing} />
    </div>
  )
}
