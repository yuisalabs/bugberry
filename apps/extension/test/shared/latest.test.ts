import { expect, test } from "bun:test"
import { latestOnly } from "../../lib/shared/latest"

test("an answer for a choice that is no longer the latest is dropped", async () => {
  const seen: string[] = []
  const take = latestOnly<string>((value) => seen.push(value))
  let answerA: (value: string) => void = () => {}
  const slowA = new Promise<string>((resolve) => (answerA = resolve))
  const first = take(slowA)
  const second = take(Promise.resolve("B"))
  await second
  answerA("A")
  await first
  expect(seen).toEqual(["B"])
})
