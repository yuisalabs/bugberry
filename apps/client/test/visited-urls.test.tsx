import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { VisitedUrls } from "../src/components/debugger/VisitedUrls"
import type { VisitedUrl } from "@bugberry/debugger-view"

const entries: VisitedUrl[] = [
  { atMs: 0, url: "https://shop.test/cart", bugHere: false },
  { atMs: 7000, url: "https://shop.test/checkout", bugHere: true },
  { atMs: 59_000, url: "https://shop.test/thanks", bugHere: false },
]

const links = () => screen.queryAllByRole("link").map((link) => link.textContent)

describe("VisitedUrls", () => {
  test("starts closed, showing only the page the bug was reported on", () => {
    render(<VisitedUrls entries={entries} />)
    expect(screen.getByRole("button", { name: /Visited URLs/ }).getAttribute("aria-expanded")).toBe("false")
    expect(links()).toEqual(["https://shop.test/checkout"])
    expect(screen.getByText("Bug here")).toBeTruthy()
  })

  test("opens to every page and closes again", () => {
    render(<VisitedUrls entries={entries} />)
    const toggle = screen.getByRole("button", { name: /Visited URLs/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(links()).toEqual(["https://shop.test/cart", "https://shop.test/checkout", "https://shop.test/thanks"])
    fireEvent.click(toggle)
    expect(links()).toEqual(["https://shop.test/checkout"])
  })

  test("while the video plays, closed shows the page the player is on, and open marks it", () => {
    render(<VisitedUrls entries={entries} playback={{ currentMs: 60_000, seek: () => {} }} />)
    expect(links()).toEqual(["https://shop.test/thanks"])
    fireEvent.click(screen.getByRole("button", { name: /Visited URLs/ }))
    const current = screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "true")
    expect(current.map((item) => item.textContent)).toEqual([expect.stringContaining("https://shop.test/thanks")])
  })

  test("a time moves the player to that page", () => {
    const seek = mock(() => {})
    render(<VisitedUrls entries={entries} playback={{ currentMs: 0, seek }} />)
    fireEvent.click(screen.getByRole("button", { name: /Visited URLs/ }))
    fireEvent.click(screen.getByRole("button", { name: "0:07" }))
    expect(seek).toHaveBeenCalledWith(7000)
  })

  test("a single page has nothing to open", () => {
    render(<VisitedUrls entries={[{ atMs: 0, url: "https://shop.test/cart", bugHere: true }]} />)
    expect(screen.queryByRole("button", { name: /Visited URLs/ })).toBeNull()
    expect(links()).toEqual(["https://shop.test/cart"])
  })
})
