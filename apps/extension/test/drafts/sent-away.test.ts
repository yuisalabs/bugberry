import { expect, test } from "bun:test"
import { createSentAwayStorage, MAX_SENT_AWAY, type SentAway } from "../../lib/drafts/sent-away"

function memoryArea(initial: unknown = null) {
  let value: unknown = initial
  return {
    get: async () => value as SentAway[] | null,
    set: async (next: SentAway[]) => void (value = next),
  }
}

const sent = (n: number): SentAway => ({ draftId: `d${n}`, title: `Report ${n}`, reportUrl: `https://bb.test/app/r/r${n}`, sentAt: n })

test("newest first, capped at MAX_SENT_AWAY", async () => {
  const storage = createSentAwayStorage(memoryArea())
  for (let n = 1; n <= MAX_SENT_AWAY + 2; n++) await storage.add(sent(n))
  const listed = await storage.list()
  expect(listed).toHaveLength(20)
  expect(listed[0]?.draftId).toBe("d22")
  expect(listed.at(-1)?.draftId).toBe("d3")
})

test("remove takes out one draft's row", async () => {
  const storage = createSentAwayStorage(memoryArea())
  await storage.add(sent(1))
  await storage.add(sent(2))
  await storage.remove("d1")
  expect((await storage.list()).map((row) => row.draftId)).toEqual(["d2"])
})

test("a corrupt stored value reads as an empty list", async () => {
  expect(await createSentAwayStorage(memoryArea("nonsense")).list()).toEqual([])
  expect(await createSentAwayStorage(memoryArea([{ draftId: 3 }])).list()).toEqual([])
  expect(await createSentAwayStorage(memoryArea(null)).list()).toEqual([])
})
