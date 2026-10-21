import { beforeEach, describe, expect, test } from "bun:test"
import { isEmoji } from "../src/modules/comments/reactions"
import { createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  const project = await createProject(ctx.db)
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })).id
})

const post = async (body: string, replyTo?: string) =>
  (await ctx.api.api.reports({ id: reportId }).comments.post(replyTo ? { body, replyTo } : { body }, { headers: ana.headers })).data
    ?.id ?? ""
const react = (who: { headers: Record<string, string> }, id: string, emoji: string) =>
  ctx.api.api.comments({ id }).reactions.post({ emoji }, { headers: who.headers })

describe("reactions", () => {
  test("toggles a reaction and counts people per emoji", async () => {
    const id = await post("Root")
    await react(ana, id, "👍")
    await react(budi, id, "👍")
    const { data } = await react(ana, id, "❤️")
    expect(data).toEqual([
      { emoji: "👍", count: 2, people: [{ id: ana.user.id, name: "Ana" }, { id: budi.user.id, name: "Budi" }] },
      { emoji: "❤️", count: 1, people: [{ id: ana.user.id, name: "Ana" }] },
    ])
    const again = await react(ana, id, "👍")
    expect(again.data?.[0]).toEqual({ emoji: "👍", count: 1, people: [{ id: budi.user.id, name: "Budi" }] })
    const listed = (await ctx.api.api.reports({ id: reportId }).comments.get({ headers: budi.headers })).data
    expect(listed?.[0]?.reactions.map((reaction) => [reaction.emoji, reaction.count])).toEqual([
      ["👍", 1],
      ["❤️", 1],
    ])
  })

  test("reactions show on replies too", async () => {
    const root = await post("Root")
    const reply = await post("Reply", root)
    await react(budi, reply, "🎉")
    const listed = (await ctx.api.api.reports({ id: reportId }).comments.get({ headers: ana.headers })).data
    expect(listed?.[0]?.replies[0]?.reactions[0]?.emoji).toBe("🎉")
  })

  test("refuses text that is not an emoji", async () => {
    const id = await post("Root")
    for (const emoji of ["lol", "", "👍".repeat(20), "a👍"]) {
      const { error } = await react(ana, id, emoji)
      expect(error?.status as number | undefined).toBe(422)
      if (emoji !== "") expect(error?.value).toMatchObject({ code: "invalid_emoji" })
    }
  })

  test("accepts flags, skin tones, keycaps and ZWJ sequences", () => {
    const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"
    for (const emoji of ["🇮🇩", "👍🏽", "👩‍💻", "❤️", "1️⃣", england]) expect(isEmoji(emoji)).toBe(true)
    for (const text of ["1", "#", "🇮", "ok", " "]) expect(isEmoji(text)).toBe(false)
  })

  test("reactions on a deleted placeholder are refused", async () => {
    const root = await post("Root")
    await post("Reply", root)
    await ctx.api.api.comments({ id: root }).delete(undefined, { headers: ana.headers })
    const { error } = await react(budi, root, "👍")
    expect(error?.status as number | undefined).toBe(404)
  })

  test("outsiders cannot react", async () => {
    const id = await post("Root")
    const elsewhere = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUserWithToken(ctx.db, { name: "Out", workspaceId: elsewhere.id })
    const { error } = await react(outsider, id, "👍")
    expect(error?.status as number | undefined).toBe(404)
  })

  test("reacting does not mark a comment edited", async () => {
    const id = await post("Root")
    await Bun.sleep(1100)
    await react(budi, id, "👍")
    const listed = (await ctx.api.api.reports({ id: reportId }).comments.get({ headers: ana.headers })).data
    expect(listed?.[0]?.edited).toBe(false)
  })
})
