import type { TimelineMarker } from "@bugberry/player"
import type { ReplayPlayerHandle, ReplayPlayerProps } from "@bugberry/replay-player"
import { type ComponentType, lazy, type Ref, Suspense } from "react"
import { Button } from "@bugberry/ui/button"
import { useReplay } from "../debugger/replay"

/** rrweb is only downloaded when a replay report is opened. */
const RrwebReplayPlayer = lazy(() => import("@bugberry/replay-player/replay-player"))

const placeholder = <div className="aspect-video w-full rounded-xl bg-[#1C1022]" />

/** A replay report's recording: its media decoded in the browser, then played with rrweb. */
export function ReplayViewer({
  report,
  refreshUrl,
  playerRef,
  onTime,
  markers,
  onMarkerClick,
  startAtSeconds,
  player: Player = RrwebReplayPlayer,
  fetcher = fetch,
}: {
  report: { id: string; mediaUrl: string | null }
  /** A newly signed media URL, for when the one the report came with has expired. */
  refreshUrl: () => Promise<string | null>
  playerRef?: Ref<ReplayPlayerHandle>
  onTime?: (ms: number) => void
  markers?: TimelineMarker[]
  onMarkerClick?: (marker: TimelineMarker) => void
  startAtSeconds?: number
  /** The replay player; tests pass a plain one instead of rrweb. */
  player?: ComponentType<ReplayPlayerProps>
  fetcher?: typeof fetch
}) {
  const replay = useReplay(report, refreshUrl, fetcher)
  if (replay.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10 text-sm">
        <p className="text-danger-subtle-foreground">Couldn't load the replay.</p>
        <Button size="sm" intent="outline" onPress={() => void replay.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!replay.data) return placeholder
  return (
    <Suspense fallback={placeholder}>
      <Player
        events={replay.data.events}
        frames={replay.data.frames}
        durationMs={replay.data.durationMs}
        playerRef={playerRef}
        onTime={onTime}
        markers={markers}
        onMarkerClick={onMarkerClick}
        startAtSeconds={startAtSeconds}
        className="w-full"
      />
    </Suspense>
  )
}
