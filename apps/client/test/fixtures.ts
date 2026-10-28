import type { Activity, Comment, CommentThread, ReportDetail, ReportListItem } from "../src/lib/api"

export function reportFixture(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: "r1",
    workspaceId: "w1",
    number: 7,
    internalDomain: "kantor.test",
    projectId: "p1",
    title: "Pay button fails",
    description: "",
    status: "open",
    priority: "high",
    visibility: "internal",
    shareSlug: "AbCdEf123456",
    captureType: "screenshot",
    pageUrl: "https://app.kantor.test/checkout",
    pageTitle: "Checkout",
    device: { browser: "Chrome 140", os: "Windows 11", viewport: "1440x900" },
    durationMs: null,
    mediaType: "image/png",
    debuggerSummary: { logs: 2, errors: 1, requests: 3, failedRequests: 1, actions: 4, incomplete: [] },
    uploadStatus: "ready",
    viaAgent: null,
    createdAt: new Date("2026-10-16T08:00:00Z"),
    updatedAt: new Date("2026-10-16T08:00:00Z"),
    reporter: { id: "u1", name: "Ana", image: null },
    reporterEmail: "ana@kantor.test",
    location: null,
    assignee: null,
    mediaUrl: "https://files.test/media-1.png",
    debuggerUrl: "https://files.test/debugger-1.gz",
    ...overrides,
  }
}

/** Fixed "now" for list fixtures: 17 hours after the default item was created. */
export const NOW = new Date("2026-10-17T12:00:00Z").getTime()

export function listItemFixture(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: "r1",
    projectId: "p1",
    number: 7,
    title: "Pay button does not respond",
    status: "open",
    priority: "high",
    visibility: "internal",
    shareSlug: "s3cret-slug",
    internalDomain: "kantor.test",
    captureType: "screenshot",
    pageUrl: "https://app.kantor.test/checkout",
    assigneeId: null,
    debuggerSummary: { logs: 2, errors: 1, requests: 3, failedRequests: 1, actions: 4, incomplete: [] },
    durationMs: null,
    thumbnailUrl: "https://files.test/t.jpg",
    createdAt: new Date(NOW - 17 * 3_600_000),
    updatedAt: new Date(NOW - 17 * 3_600_000),
    reporter: { id: "u1", name: "Ervalsa Dwi Nanda", image: null },
    ...overrides,
  }
}

export function commentFixture(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    reportId: "r1",
    parentId: null,
    author: { id: "u1", name: "Ana", image: null },
    body: "Looks broken",
    viaAgent: null,
    createdAt: new Date("2026-10-16T08:00:00Z"),
    edited: false,
    deleted: false,
    mentions: [],
    reactions: [],
    ...overrides,
  }
}

export function threadFixture(overrides: Partial<CommentThread> = {}): CommentThread {
  return { ...commentFixture(), replies: [], ...overrides }
}

export function activityFixture(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    kind: "status",
    at: new Date("2026-10-16T08:30:00Z"),
    actor: { id: "u1", name: "Ana", image: null },
    viaAgent: null,
    detail: { from: "open", to: "in_progress" },
    ...overrides,
  }
}
