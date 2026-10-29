import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { NetworkTab } from "../src/features/reports/debugger/NetworkTab"
import {
  clampDetailHeight,
  DEFAULT_DETAIL_HEIGHT,
  readDetailHeight,
  saveDetailHeight,
} from "../src/features/reports/debugger/network-detail"
import { normalizePayload } from "@bugberry/debugger-view"

afterEach(() => window.localStorage.clear())

const { events } = normalizePayload({
  events: [
    { kind: "network", t: 1000, method: "GET", url: "https://app.kantor.test/api/user", status: 200, durationMs: 40 },
    { kind: "network", t: 1100, method: "POST", url: "https://app.kantor.test/api/pay", status: 500, durationMs: 90 },
  ],
})

describe("the request detail's height this browser remembers", () => {
  test("the default when nothing is stored, or the stored value is damaged", () => {
    expect(readDetailHeight()).toBe(DEFAULT_DETAIL_HEIGHT)
    window.localStorage.setItem("bugberry:network-detail-height", "{nope")
    expect(readDetailHeight()).toBe(DEFAULT_DETAIL_HEIGHT)
  })

  test("a chosen height comes back", () => {
    saveDetailHeight(240)
    expect(readDetailHeight()).toBe(240)
  })

  test("never shorter than 120 px, and the table above keeps 96 px", () => {
    expect(clampDetailHeight(40, 800)).toBe(120)
    expect(clampDetailHeight(500.4, 800)).toBe(500)
    expect(clampDetailHeight(790, 800)).toBe(704)
    expect(clampDetailHeight(300, 150)).toBe(120)
  })
})

describe("the edge between the table and the request", () => {
  // The panel the table and the detail share is 800 px tall.
  const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 }))
  afterAll(() => {
    if (real) Object.defineProperty(HTMLElement.prototype, "clientHeight", real)
  })

  const edge = () => screen.getByRole("separator", { name: "Resize request details" })

  test("only shows once a request is open", () => {
    render(<NetworkTab events={events} base={1000} />)
    expect(screen.queryByRole("separator", { name: "Resize request details" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    expect(edge().getAttribute("aria-valuenow")).toBe(String(DEFAULT_DETAIL_HEIGHT))
  })

  test("dragging up makes the detail taller, down shorter, and the height is remembered", () => {
    render(<NetworkTab events={events} base={1000} />)
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    const box = () => edge().nextElementSibling as HTMLElement
    fireEvent.pointerDown(edge(), { clientY: 500 })
    fireEvent.pointerMove(window, { clientY: 400 })
    expect(box().style.flexBasis).toBe("420px")
    fireEvent.pointerMove(window, { clientY: 600 })
    expect(box().style.flexBasis).toBe("220px")
    // Only the box moves while dragging; the panel settles, and remembers, once the pointer is let go.
    expect(edge().getAttribute("aria-valuenow")).toBe(String(DEFAULT_DETAIL_HEIGHT))
    expect(readDetailHeight()).toBe(DEFAULT_DETAIL_HEIGHT)
    fireEvent.pointerUp(window)
    expect(edge().getAttribute("aria-valuenow")).toBe("220")
    expect(box().style.flexBasis).toBe("220px")
    expect(readDetailHeight()).toBe(220)
  })

  test("a drag keeps the table in view, however far it goes", () => {
    render(<NetworkTab events={events} base={1000} />)
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    fireEvent.pointerDown(edge(), { clientY: 500 })
    fireEvent.pointerMove(window, { clientY: -2000 })
    expect((edge().nextElementSibling as HTMLElement).style.flexBasis).toBe("704px")
    fireEvent.pointerUp(window)
    expect(edge().getAttribute("aria-valuenow")).toBe("704")
  })

  test("arrow keys move it in steps, and a double click goes back to the default", () => {
    render(<NetworkTab events={events} base={1000} />)
    fireEvent.click(screen.getByRole("button", { name: /^pay/ }))
    fireEvent.keyDown(edge(), { key: "ArrowUp" })
    expect(edge().getAttribute("aria-valuenow")).toBe(String(DEFAULT_DETAIL_HEIGHT + 16))
    fireEvent.keyDown(edge(), { key: "ArrowDown" })
    fireEvent.keyDown(edge(), { key: "ArrowDown" })
    expect(edge().getAttribute("aria-valuenow")).toBe(String(DEFAULT_DETAIL_HEIGHT - 16))
    fireEvent.doubleClick(edge())
    expect(edge().getAttribute("aria-valuenow")).toBe(String(DEFAULT_DETAIL_HEIGHT))
  })
})
