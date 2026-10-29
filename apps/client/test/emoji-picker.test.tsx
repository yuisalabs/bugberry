import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { EmojiPicker } from "../src/features/reports/comments/EmojiPicker"
import { readRecentEmoji, saveRecentEmoji } from "../src/features/reports/comments/recent-emoji"

const realFetch = globalThis.fetch

beforeEach(() => {
  // The full emoji list comes from the network; the recent row needs none of it.
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  localStorage.clear()
})

describe("EmojiPicker", () => {
  test("opens from its trigger and picks a recent emoji, remembering it", () => {
    saveRecentEmoji(["🎉", "👍"])
    const onPick = mock()
    render(<EmojiPicker label="Add reaction" onPick={onPick} trigger={<span>☺</span>} />)
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    fireEvent.click(screen.getByRole("button", { name: "👍" }))
    expect(onPick).toHaveBeenCalledWith("👍")
    expect(readRecentEmoji()).toEqual(["👍", "🎉"])
  })

  test("offers a search box once open", () => {
    render(<EmojiPicker label="Insert emoji" onPick={mock()} trigger={<span>☺</span>} />)
    fireEvent.click(screen.getByRole("button", { name: "Insert emoji" }))
    expect(screen.getByRole("searchbox")).toBeTruthy()
  })
})
