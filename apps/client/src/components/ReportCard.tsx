import { RiCameraLine, RiFlag2Line, RiHashtag, RiImageLine, RiLink, RiPlayFill } from "@remixicon/react"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Avatar } from "@bugberry/ui/avatar"
import type { ReportListItem } from "../lib/api"
import { formatLength, formatRelative } from "../lib/format"
import { PRIORITY_ICON_STYLES, PRIORITY_LABELS } from "../lib/labels"
import { initialsOf } from "../lib/people"
import { copiedDescription } from "../lib/share-access"
import { toast } from "../lib/toast"
import { shareUrl } from "../lib/urls"
import { StatusBadge } from "./StatusBadge"

/** One report as a Jam-style card: preview, who reported it, how long, what and when. No link, so it renders without a router. */
export function ReportCardBody({
  item,
  now,
  projectName = null,
  onPreviewError,
}: {
  item: ReportListItem
  now: number
  /** The report's project, shown under the title; null for none. */
  projectName?: string | null
  /** The preview failed to load, most likely because its signed link expired; the list can fetch fresh ones. */
  onPreviewError?: () => void
}) {
  // Remembers which link failed, not just that one did, so a fresh link from a refetch is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const preview = item.thumbnailUrl && item.thumbnailUrl !== failedUrl ? item.thumbnailUrl : null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted ring-1 ring-border">
        {preview ? (
          <img
            src={preview}
            alt={item.title}
            loading="lazy"
            decoding="async"
            onError={() => {
              setFailedUrl(preview)
              onPreviewError?.()
            }}
            className="size-full object-cover object-top transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <RiImageLine aria-hidden className="size-6 opacity-60" />
            No preview
          </div>
        )}
        {/* A dim over the whole preview, darkest at the top (behind the sender row) and fading towards the bottom.
            On hover a light layer deepens it, and the sender row makes room for Copy link. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/50 via-black/15 to-transparent" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/25 to-black/5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-2.5 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          <Avatar
            src={item.reporter.image}
            initials={initialsOf(item.reporter.name)}
            alt=""
            size="md"
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white drop-shadow">{item.reporter.name}</span>
          <StatusBadge status={item.status} className="shrink-0 ring-1 ring-background/60" />
        </div>
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-xs font-medium text-white">
          {item.captureType === "video" ? (
            <>
              <RiPlayFill aria-hidden className="size-3" />
              {formatLength(item.durationMs ?? 0)}
            </>
          ) : (
            <RiCameraLine aria-label="Screenshot" role="img" className="size-3.5" />
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="shrink-0 text-xs text-muted-foreground">{formatRelative(item.createdAt, now)}</p>
        </div>
        {(projectName || item.priority !== "none") && (
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {projectName && (
              <span className="flex min-w-0 items-center gap-1">
                <RiHashtag aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{projectName}</span>
              </span>
            )}
            {projectName && item.priority !== "none" && <span aria-hidden>·</span>}
            {item.priority !== "none" && (
              <span className="flex shrink-0 items-center gap-1 text-foreground">
                <RiFlag2Line aria-hidden className={`size-3.5 ${PRIORITY_ICON_STYLES[item.priority]}`} />
                {PRIORITY_LABELS[item.priority]}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The card's Copy link, shown at the top right of the preview on hover (or keyboard focus). It sits next to
 * the card's link, not inside it, so a click copies without opening the report.
 */
export function CardCopyLink({ item }: { item: ReportListItem }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(item.shareSlug))
      setCopied(true)
      toast({ title: "Link copied", description: copiedDescription(item.visibility, item.internalDomain) })
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" })
    }
  }

  return (
    <Button
      intent="outline"
      size="sm"
      aria-label="Copy link"
      onPress={() => void copy()}
      className="absolute top-2.5 right-2.5 bg-background/95 opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-background focus-visible:opacity-100"
    >
      <RiLink aria-hidden />
      {copied ? "Copied" : "Copy link"}
    </Button>
  )
}

export function ReportCard({
  item,
  now,
  projectName = null,
  onPreviewError,
}: {
  item: ReportListItem
  now: number
  projectName?: string | null
  onPreviewError?: () => void
}) {
  return (
    <div className="group relative">
      <Link
        to="/app/r/$reportId"
        params={{ reportId: item.id }}
        className="block rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ReportCardBody item={item} now={now} projectName={projectName} onPreviewError={onPreviewError} />
      </Link>
      <CardCopyLink item={item} />
    </div>
  )
}
