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

test("an add and a remove at once both land", async () => {
  // A slow storage: each read waits, so unserialized writes would overwrite each other.
  let value: SentAway[] | null = [sent(1)]
  const slow = {
    get: async () => {
      const read = value
      await new Promise((resolve) => setTimeout(resolve, 5))
      return read
    },
    set: async (next: SentAway[]) => void (value = next),
  }
  const storage = createSentAwayStorage(slow)
  await Promise.all([storage.add(sent(2)), storage.remove("d1")])
  expect((await storage.list()).map((row) => row.draftId)).toEqual(["d2"])
})

test("with a lock, writes run inside it under one name", async () => {
  const names: string[] = []
  const storage = createSentAwayStorage(memoryArea(), async (name, work) => {
    names.push(name)
    return work()
  })
  await storage.add(sent(1))
  await storage.remove("d1")
  expect(names).toEqual(["bugberry-sent-away", "bugberry-sent-away"])
})
