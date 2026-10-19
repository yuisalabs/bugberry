import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { VideoReporter, VideoShareActions } from "../src/components/VideoOverlay"
import { startSecondsFrom } from "../src/lib/urls"

describe("VideoReporter", () => {
  test("shows who reported it, without the page (DevTools has that)", () => {
    const { container } = render(<VideoReporter reporter={{ id: "u1", name: "Ervalsa Dwi Nanda", image: null }} />)
    expect(screen.getByText("Ervalsa Dwi Nanda")).toBeTruthy()
    expect(container.querySelector(".bb-reporter-page")).toBeNull()
  })
})

describe("VideoShareActions", () => {
  test("copies a share link that starts at the current second", async () => {
    const writeText = mock(async () => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    render(<VideoShareActions shareSlug="AbC" seconds={3.4} mediaUrl="https://files.test/v.webm" />)
    fireEvent.click(screen.getByRole("button", { name: "Share at 0:03" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/s/AbC?t=3"))
  })

  test("offers the video file for download", () => {
    render(<VideoShareActions shareSlug="AbC" seconds={0} mediaUrl="https://files.test/v.webm" />)
    expect(screen.getByRole("link", { name: "Download video" }).getAttribute("href")).toBe("https://files.test/v.webm")
  })
})

describe("startSecondsFrom", () => {
  test("reads ?t= as whole seconds; anything else starts at the beginning", () => {
    expect(startSecondsFrom({ t: "3" })).toBe(3)
    expect(startSecondsFrom({ t: 12 })).toBe(12)
    expect(startSecondsFrom({ t: "-4" })).toBeUndefined()
    expect(startSecondsFrom({ t: "soon" })).toBeUndefined()
    expect(startSecondsFrom({})).toBeUndefined()
  })
})
