import { afterEach, describe, expect, test } from "bun:test"
import { readRecentEmoji, rememberEmoji, saveRecentEmoji } from "../src/lib/recent-emoji"

afterEach(() => localStorage.clear())

describe("recent emoji", () => {
  test("a picked emoji moves to the front, once", () => {
    expect(rememberEmoji(["👍", "❤️"], "❤️")).toEqual(["❤️", "👍"])
    expect(rememberEmoji(["👍"], "🎉")).toEqual(["🎉", "👍"])
  })

  test("keeps at most the given number", () => {
    expect(rememberEmoji(["1️⃣", "2️⃣", "3️⃣"], "🎉", 3)).toEqual(["🎉", "1️⃣", "2️⃣"])
  })

  test("saved emoji read back; broken storage reads as none", () => {
    saveRecentEmoji(["👍", "🎉"])
    expect(readRecentEmoji()).toEqual(["👍", "🎉"])
    localStorage.setItem("bugberry.recentEmoji", "{not json")
    expect(readRecentEmoji()).toEqual([])
    localStorage.setItem("bugberry.recentEmoji", JSON.stringify([1, "👍", null]))
    expect(readRecentEmoji()).toEqual(["👍"])
  })
})
