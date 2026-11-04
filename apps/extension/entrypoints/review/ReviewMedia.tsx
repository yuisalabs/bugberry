import type { TimelineMarker } from "@bugberry/player"
import { VideoPlayer } from "@bugberry/player/video-player"
import type { ReplayEvent, ReplayFrame } from "@bugberry/shared"
import { lazy, type Ref, Suspense } from "react"
import type { TrimRange } from "../../lib/review/review-data"
import type { ReportDraft } from "../../lib/shared/types"
import { AnnotationCanvas, type AnnotationCanvasHandle } from "./AnnotationCanvas"

/** rrweb loads only when a replay is reviewed. */
const ReplayPlayer = lazy(() => import("@bugberry/replay-player/replay-player"))

/** The review's left side: the video player, the replay player or the annotation canvas. */
export function ReviewMedia(props: {
  draft: ReportDraft
  videoUrl: string | null
  image: ImageBitmap | null
  replay: { events: ReplayEvent[]; frames: ReplayFrame[] } | null
  markers: TimelineMarker[]
  videoRef: Ref<HTMLVideoElement>
  canvasRef: Ref<AnnotationCanvasHandle>
  range: TrimRange | null
  onVideoTime(ms: number): void
}) {
  const { draft } = props
  if (draft.captureType === "video" && props.videoUrl) {
    return (
      <VideoPlayer
        src={props.videoUrl}
        durationMs={draft.durationMs}
        markers={props.markers}
        videoRef={props.videoRef}
        range={props.range}
        onTime={props.onVideoTime}
        className="w-full"
      />
    )
  }
  if (draft.captureType === "replay" && props.replay) {
    return (
      <Suspense fallback={<div className="aspect-video w-full rounded-xl bg-[#1C1022]" />}>
        <ReplayPlayer
          events={props.replay.events}
          frames={props.replay.frames}
          durationMs={draft.durationMs}
          markers={props.markers}
          bounded
          className="w-full"
        />
      </Suspense>
    )
  }
  if (!props.image) return null
  return <AnnotationCanvas ref={props.canvasRef} image={props.image} initialShapes={draft.captureType === "screenshot" ? draft.annotations : []} />
}
