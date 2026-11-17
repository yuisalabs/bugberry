import { describe, expect, test } from "bun:test"
import { escapeHtml, previewDescription, previewTags, type SharePreview } from "../src/modules/share/preview"

const video: SharePreview = {
  number: 12,
  title: "Checkout button does nothing",
  captureType: "video",
  pageUrl: "https://app.example.com/cart?x=1",
  errors: 3,
  failedRequests: 2,
  hasThumbnail: true,
}

describe("share preview tags", () => {
  test("a report's card names it and counts what went wrong", () => {
    const tags = previewTags("https://bb.test", "abc123", video)
    expect(tags).toContain('<meta property="og:title" content="BB-12 · Checkout button does nothing" />')
    expect(tags).toContain('<meta property="og:description" content="Video of app.example.com · 3 errors · 2 failed requests" />')
    expect(tags).toContain('<meta property="og:image" content="https://bb.test/api/share/abc123/preview.jpg" />')
    expect(tags).toContain('<meta property="og:url" content="https://bb.test/s/abc123" />')
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(tags).toContain('<meta name="robots" content="noindex" />')
  })

  test("a title is text, never markup", () => {
    const tags = previewTags("https://bb.test", "abc123", { ...video, title: '"><script>alert(1)</script>' })
    expect(tags).not.toContain("<script>")
    expect(tags).toContain("&quot;&gt;&lt;script&gt;")
  })

  test("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })

  test("zero counts and singulars", () => {
    expect(previewDescription({ ...video, errors: 1, failedRequests: 0 })).toBe("Video of app.example.com · 1 error")
    expect(previewDescription({ ...video, errors: 0, failedRequests: 1 })).toBe("Video of app.example.com · 1 failed request")
    expect(previewDescription({ ...video, errors: 0, failedRequests: 0 })).toBe("Video of app.example.com")
  })

  test("a page URL that isn't one leaves the host out", () => {
    expect(previewDescription({ ...video, captureType: "screenshot", pageUrl: "about:blank", errors: 0, failedRequests: 0 })).toBe("Screenshot")
    expect(previewDescription({ ...video, captureType: "replay", pageUrl: "not a url", errors: 2, failedRequests: 0 })).toBe("Replay · 2 errors")
  })

  test("no thumbnail: the site image", () => {
    expect(previewTags("https://bb.test", "abc123", { ...video, hasThumbnail: false })).toContain("https://bb.test/assets/og-image.png")
  })

  test("the generic card names nothing", () => {
    const tags = previewTags("https://bb.test", "abc123", null)
    expect(tags).toContain('content="A report on BugBerry"')
    expect(tags).toContain('content="Sign in to BugBerry to view this report."')
    expect(tags).toContain('<meta name="robots" content="noindex" />')
    expect(tags).not.toContain("abc123")
    expect(previewTags("https://bb.test", "other", null)).toBe(tags)
  })
})
