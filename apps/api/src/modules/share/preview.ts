import type { CaptureType } from "@bugberry/shared"

/** What a public report's link preview shows. */
export interface SharePreview {
  number: number
  title: string
  captureType: CaptureType
  pageUrl: string
  errors: number
  failedRequests: number
  hasThumbnail: boolean
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

const CAPTURE_NAMES: Record<CaptureType, string> = { screenshot: "Screenshot", video: "Video", replay: "Replay" }

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

function hostOf(pageUrl: string): string | null {
  try {
    const { protocol, host } = new URL(pageUrl)
    return (protocol === "http:" || protocol === "https:") && host ? host : null
  } catch {
    return null
  }
}

/** "Video of app.example.com · 3 errors · 2 failed requests"; zero counts and an unreadable host are left out. */
export function previewDescription(preview: SharePreview): string {
  const host = hostOf(preview.pageUrl)
  const parts = [host ? `${CAPTURE_NAMES[preview.captureType]} of ${host}` : CAPTURE_NAMES[preview.captureType]]
  if (preview.errors > 0) parts.push(count(preview.errors, "error"))
  if (preview.failedRequests > 0) parts.push(count(preview.failedRequests, "failed request"))
  return parts.join(" · ")
}

const property = (name: string, content: string) => `<meta property="${name}" content="${escapeHtml(content)}" />`
const named = (name: string, content: string) => `<meta name="${name}" content="${escapeHtml(content)}" />`

/** The tags for a share page's head. `preview` null: the generic card, the same for every slug. */
export function previewTags(appUrl: string, slug: string, preview: SharePreview | null): string {
  const siteImage = `${appUrl}/assets/og-image.png`
  const card = preview
    ? {
        title: `BB-${preview.number} · ${preview.title}`,
        description: previewDescription(preview),
        image: preview.hasThumbnail ? `${appUrl}/api/share/${encodeURIComponent(slug)}/preview.jpg` : siteImage,
        url: `${appUrl}/s/${encodeURIComponent(slug)}`,
      }
    : { title: "A report on BugBerry", description: "Sign in to BugBerry to view this report.", image: siteImage, url: null }
  return [
    property("og:type", "website"),
    property("og:site_name", "BugBerry"),
    property("og:title", card.title),
    property("og:description", card.description),
    property("og:image", card.image),
    ...(card.url ? [property("og:url", card.url)] : []),
    named("twitter:card", "summary_large_image"),
    named("robots", "noindex"),
  ].join("\n")
}
