import { describe, expect, test } from "bun:test"
import { activitySentence, commentCount, mergeFeed, videoTimes } from "../src/lib/comment-feed"
import { activityFixture, commentFixture, threadFixture } from "./fixtures"

const at = (time: string) => new Date(`2026-10-16T${time}:00Z`)

describe("mergeFeed", () => {
  const older = threadFixture({ id: "t1", createdAt: at("08:00") })
  const newer = threadFixture({ id: "t2", createdAt: at("10:00") })
  const between = activityFixture({ id: "a1", at: at("09:00") })

  test("puts threads and activity newest first, by time", () => {
    const feed = mergeFeed([newer, older], [between])
    expect(feed.map((entry) => (entry.kind === "thread" ? entry.thread.id : entry.item.id))).toEqual(["t2", "a1", "t1"])
  })

  test("without activity it is just the threads", () => {
    expect(mergeFeed([newer, older], null).map((entry) => entry.kind)).toEqual(["thread", "thread"])
  })
})

describe("commentCount", () => {
  test("counts first comments and replies, leaving out deleted placeholders", () => {
    const threads = [
      threadFixture({ id: "t1", replies: [commentFixture({ id: "r1" }), commentFixture({ id: "r2" })] }),
      threadFixture({ id: "t2", deleted: true, replies: [commentFixture({ id: "r3" })] }),
    ]
    expect(commentCount(threads)).toBe(4)
  })
})

describe("videoTimes", () => {
  test("a time inside the video becomes a seek target", () => {
    expect(videoTimes("starts at 0:52 here", 116_000)).toEqual([{ text: "starts at " }, { time: "0:52", ms: 52_000 }, { text: " here" }])
  })

  test("hours work too", () => {
    expect(videoTimes("1:02:03", 4_000_000)).toEqual([{ time: "1:02:03", ms: 3_723_000 }])
  })

  test("clock-like text stays text past the video's length, or without a video", () => {
    expect(videoTimes("call at 10:30", 60_000)).toEqual([{ text: "call at 10:30" }])
    expect(videoTimes("0:52", null)).toEqual([{ text: "0:52" }])
    expect(videoTimes("at 0:75 or 12:3", 900_000)).toEqual([{ text: "at 0:75 or 12:3" }])
  })

  test("a time glued to letters or dots is not a time", () => {
    expect(videoTimes("call at 10:30am", 4_000_000)).toEqual([{ text: "call at 10:30am" }])
    expect(videoTimes("host 10.0.0.5:22", 4_000_000)).toEqual([{ text: "host 10.0.0.5:22" }])
    expect(videoTimes("v0:52", 116_000)).toEqual([{ text: "v0:52" }])
    expect(videoTimes("(0:52).", 116_000)).toEqual([{ text: "(" }, { time: "0:52", ms: 52_000 }, { text: ")." }])
  })

  test("a time glued to other digits or colons is not a time", () => {
    expect(videoTimes("v1:02:03:04 and 10:301", 4_000_000)).toEqual([{ text: "v1:02:03:04 and 10:301" }])
  })
})

describe("activitySentence", () => {
  test("field changes", () => {
    expect(activitySentence(activityFixture({ kind: "status", detail: { from: "open", to: "in_progress" } }))).toBe(
      "changed status from Open to In progress",
    )
    expect(activitySentence(activityFixture({ kind: "priority", detail: { from: "none", to: "high" } }))).toBe(
      "changed priority from None to High",
    )
    expect(activitySentence(activityFixture({ kind: "title", detail: { from: "Old", to: "New" } }))).toBe('renamed this from "Old" to "New"')
  })

  test("assignee changes", () => {
    const budi = { id: "u2", name: "Budi", image: null }
    expect(activitySentence(activityFixture({ kind: "assignee", detail: { from: null, to: budi } }))).toBe("assigned this to Budi")
    expect(activitySentence(activityFixture({ kind: "assignee", detail: { from: budi, to: null } }))).toBe("unassigned Budi")
  })

  test("tracker sends, by someone or automatically", () => {
    const detail = { provider: "github", externalId: "142", externalUrl: "https://github.com/a/b/issues/142" }
    expect(activitySentence(activityFixture({ kind: "tracker", detail }))).toBe("sent this to GitHub as #142")
    expect(activitySentence(activityFixture({ kind: "tracker", actor: null, detail: { ...detail, automatic: true } }))).toBe(
      "sent automatically to GitHub as #142",
    )
    // An older send: who sent it was never stored, but it was not automatic either.
    expect(activitySentence(activityFixture({ kind: "tracker", actor: null, detail }))).toBe("sent this to GitHub as #142")
  })

  test("a Jira send names the issue by its key", () => {
    const detail = { provider: "jira", externalId: "BUG-12", externalUrl: "https://kantor.atlassian.net/browse/BUG-12" }
    expect(activitySentence(activityFixture({ kind: "tracker", detail }))).toBe("sent this to Jira as BUG-12")
  })

  test("agent reads list what was read", () => {
    expect(activitySentence(activityFixture({ kind: "agent_read", detail: { parts: ["report"] } }))).toBe("read this report")
    expect(activitySentence(activityFixture({ kind: "agent_read", detail: { parts: ["report", "network"] } }))).toBe(
      "read this report and the network log",
    )
    expect(activitySentence(activityFixture({ kind: "agent_read", detail: { parts: ["report", "network", "console"] } }))).toBe(
      "read this report, the network log and the console",
    )
  })

  test("the report's creation names the browser extension", () => {
    expect(activitySentence(activityFixture({ kind: "created", detail: { browser: "Firefox 131" } }))).toBe(
      "reported this via Firefox extension",
    )
  })
})
