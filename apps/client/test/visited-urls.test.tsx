import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { VisitedUrls } from "../src/components/debugger/VisitedUrls"
import type { VisitedUrl } from "@bugberry/debugger-view"

const page = (atMs: number, url: string, extra: Partial<VisitedUrl> = {}): VisitedUrl => ({
  atMs,
  url,
  reported: false,
  errors: 0,
  failedRequests: 0,
  from: null,
  to: null,
  ...extra,
})

const entries: VisitedUrl[] = [
  page(0, "https://shop.test/cart", { reported: true }),
  page(7000, "https://shop.test/checkout", { errors: 2, failedRequests: 1 }),
  page(59_000, "https://shop.test/thanks"),
]

const links = () => screen.queryAllByRole("link").map((link) => link.textContent)

describe("VisitedUrls", () => {
  test("starts closed, showing the first page where something went wrong, with what went wrong", () => {
    render(<VisitedUrls entries={entries} />)
    expect(screen.getByRole("button", { name: /Visited URLs/ }).getAttribute("aria-expanded")).toBe("false")
    expect(links()).toEqual(["https://shop.test/checkout"])
    expect(screen.getByText("2 errors")).toBeTruthy()
    expect(screen.getByText("1 failed request")).toBeTruthy()
    expect(screen.queryByText("Bug here")).toBeNull()
  })

  test("with nothing wrong anywhere, closed shows the page the report was made on, with no counts", () => {
    render(<VisitedUrls entries={[page(0, "https://shop.test/cart"), page(4000, "https://shop.test/checkout", { reported: true })]} />)
    expect(links()).toEqual(["https://shop.test/checkout"])
    expect(screen.queryByText(/error|request/)).toBeNull()
  })

  test("a count opens that page's events in Console or Network", () => {
    const onShow = mock((_tab: "console" | "network", _page: VisitedUrl) => {})
    render(<VisitedUrls entries={entries} onShow={onShow} />)
    fireEvent.click(screen.getByRole("button", { name: "2 errors" }))
    expect(onShow).toHaveBeenCalledWith("console", entries[1])
    fireEvent.click(screen.getByRole("button", { name: "1 failed request" }))
    expect(onShow).toHaveBeenCalledWith("network", entries[1])
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
    render(<VisitedUrls entries={[page(0, "https://shop.test/cart", { reported: true })]} />)
    expect(screen.queryByRole("button", { name: /Visited URLs/ })).toBeNull()
    expect(links()).toEqual(["https://shop.test/cart"])
  })
})
