import { describe, expect, test } from "bun:test"
import type { ReportTrackers, TrackerLink } from "../src/lib/api"
import { linkState, trackersRefetchInterval } from "../src/lib/tracker-links"

const NOW = new Date("2026-10-16T08:10:00Z").getTime()
const link = (overrides: Partial<TrackerLink>): TrackerLink => ({
  integrationId: "gh",
  externalId: null,
  externalUrl: null,
  error: null,
  updatedAt: new Date(NOW - 10_000),
  ...overrides,
})

describe("linkState", () => {
  test("tells sent, failed, sending and stalled links apart", () => {
    expect(linkState(undefined, NOW)).toBe("none")
    expect(linkState(link({ externalId: "42" }), NOW)).toBe("sent")
    expect(linkState(link({ error: "Invalid token" }), NOW)).toBe("failed")
    expect(linkState(link({}), NOW)).toBe("sending")
    // The server lets another send take over after two minutes.
    expect(linkState(link({ updatedAt: new Date(NOW - 3 * 60_000) }), NOW)).toBe("stalled")
  })
})

describe("trackersRefetchInterval", () => {
  test("polls only while a send is running", () => {
    const data = (links: TrackerLink[]): ReportTrackers => ({ integrations: [], links, needsProject: false })
    expect(trackersRefetchInterval(undefined, NOW)).toBe(false)
    expect(trackersRefetchInterval(data([link({ externalId: "1" })]), NOW)).toBe(false)
    expect(trackersRefetchInterval(data([link({ externalId: "1" }), link({})]), NOW)).toBe(3000)
    expect(trackersRefetchInterval(data([link({ updatedAt: new Date(NOW - 3 * 60_000) })]), NOW)).toBe(false)
  })
})
