import { afterEach, describe, expect, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { NetworkTab } from "../src/components/debugger/NetworkTab"
import { clampColumnWidth, DEFAULT_COLUMN_WIDTHS, readColumnWidths, saveColumnWidths } from "../src/lib/network-columns"
import { normalizePayload } from "@bugberry/debugger-view"

afterEach(() => window.localStorage.clear())

const { events } = normalizePayload({
  events: [
    { kind: "network", t: 1000, method: "GET", url: "https://app.kantor.test/api/user", status: 200, durationMs: 40 },
    { kind: "network", t: 1100, method: "POST", url: "https://app.kantor.test/api/pay", status: 500, durationMs: 90 },
  ],
})

const widthOf = (column: string) => (document.querySelector(`col[data-column="${column}"]`) as HTMLElement | null)?.style.width

describe("the Network table's column widths this browser remembers", () => {
  test("the defaults when nothing is stored, or the stored value is damaged", () => {
    expect(readColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
    window.localStorage.setItem("bugberry:network-columns", "{nope")
    expect(readColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
  })

  test("a chosen width comes back; unknown or broken entries keep their default", () => {
    saveColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, Name: 320 })
    expect(readColumnWidths()).toEqual({ ...DEFAULT_COLUMN_WIDTHS, Name: 320 })
    window.localStorage.setItem(
      "bugberry:network-columns",
      JSON.stringify({ Name: 320, Status: "wide", Bogus: 10 }),
    )
    expect(readColumnWidths()).toEqual({ ...DEFAULT_COLUMN_WIDTHS, Name: 320 })
  })

  test("a column never gets narrower than 40 px", () => {
    expect(clampColumnWidth(10)).toBe(40)
    expect(clampColumnWidth(123.6)).toBe(124)
  })
})

describe("NetworkTab layout", () => {
  test("the filters and the column headers stay put; only the rows scroll", () => {
    render(<NetworkTab events={events} base={1000} />)
    const firstRow = screen.getAllByRole("row")[1] as HTMLElement
    const scroller = firstRow.closest("[data-follow-scroll]") as HTMLElement
    expect(scroller.className).toContain("overflow-auto")
    expect(scroller.contains(screen.getByRole("searchbox", { name: "Filter requests" }))).toBe(false)
    expect(scroller.contains(screen.getByRole("radiogroup", { name: "Request type" }))).toBe(false)
    const header = screen.getByRole("columnheader", { name: /Name/ }).closest("thead") as HTMLElement
    expect(header.className).toContain("sticky")
    expect(header.className).toContain("top-0")
  })

  test("dragging a column's right edge widens it, and the width is remembered", () => {
    const { unmount } = render(<NetworkTab events={events} base={1000} />)
    expect(widthOf("Name")).toBe(`${DEFAULT_COLUMN_WIDTHS.Name}px`)
    const edge = screen.getByRole("separator", { name: "Resize Name column" })
    fireEvent.pointerDown(edge, { clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 380 })
    fireEvent.pointerUp(window)
    expect(widthOf("Name")).toBe(`${DEFAULT_COLUMN_WIDTHS.Name + 80}px`)
    unmount()
    render(<NetworkTab events={events} base={1000} />)
    expect(widthOf("Name")).toBe(`${DEFAULT_COLUMN_WIDTHS.Name + 80}px`)
  })

  test("arrow keys resize a column in steps, and a double click restores its default", () => {
    render(<NetworkTab events={events} base={1000} />)
    const edge = screen.getByRole("separator", { name: "Resize Domain column" })
    fireEvent.keyDown(edge, { key: "ArrowRight" })
    expect(widthOf("Domain")).toBe(`${DEFAULT_COLUMN_WIDTHS.Domain + 16}px`)
    fireEvent.keyDown(edge, { key: "ArrowLeft" })
    fireEvent.keyDown(edge, { key: "ArrowLeft" })
    expect(widthOf("Domain")).toBe(`${DEFAULT_COLUMN_WIDTHS.Domain - 16}px`)
    fireEvent.doubleClick(edge)
    expect(widthOf("Domain")).toBe(`${DEFAULT_COLUMN_WIDTHS.Domain}px`)
  })

  test("a click anywhere on a row opens that request", () => {
    render(<NetworkTab events={events} base={1000} />)
    fireEvent.click(screen.getByRole("cell", { name: "POST" }))
    expect(screen.getByText("POST /api/pay")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "All requests" }))
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy()
  })

  test("the name shows the same pointer as the rest of the row", () => {
    render(<NetworkTab events={events} base={1000} />)
    expect(screen.getByRole("button", { name: "user" }).className).toContain("cursor-pointer")
  })

  test("ordinary rows alternate their background; failed ones keep their colour", () => {
    render(<NetworkTab events={events} base={1000} />)
    const [ok, failed] = screen.getAllByRole("row").slice(1)
    expect(ok?.className).toContain("even:bg-muted-foreground/6")
    expect(failed?.className).not.toContain("even:")
    expect(failed?.className).toContain("bg-danger-subtle")
  })

  test("every column but the last is ruled off from the next, in the header and the rows", () => {
    render(<NetworkTab events={events} base={1000} />)
    const headers = screen.getAllByRole("columnheader")
    const cells = screen.getAllByRole("row")[1]?.querySelectorAll("td") ?? []
    for (const line of [headers, [...cells]]) {
      expect(line.slice(0, -1).every((cell) => cell.className.includes("border-r"))).toBe(true)
      expect(line.at(-1)?.className).not.toContain("border-r")
    }
  })

  test("the waterfall takes whatever room is left, so it has no edge of its own", () => {
    render(<NetworkTab events={events} base={1000} />)
    expect(screen.queryByRole("separator", { name: "Resize Waterfall column" })).toBeNull()
    expect(widthOf("Waterfall")).toBe("")
  })
})
