import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { NotificationBadge, NotificationBellView } from "../src/components/NotificationBell"
import type { Notifications } from "../src/lib/api"

const NOW = new Date("2026-10-18T10:00:00Z").getTime()

const item = (index: number, overrides: Partial<Notifications["items"][number]> = {}): Notifications["items"][number] => ({
  id: `n${index}`,
  read: false,
  createdAt: new Date(NOW - 5 * 60_000),
  actor: { id: "u1", name: "Ana", image: null },
  report: { id: `r${index}`, number: index, title: "Pay button fails" },
  commentId: `c${index}`,
  snippet: "@Budi tolong cek",
  viaAgent: null,
  ...overrides,
})

const view = (data: Notifications) => {
  const props = { onOpen: mock(), onReadAll: mock() }
  render(<NotificationBellView data={data} now={NOW} {...props} />)
  return props
}

describe("NotificationBell", () => {
  test("shows the unread count, capped at 9+", () => {
    const { container, rerender } = render(<NotificationBadge count={0} />)
    expect(container.textContent).toBe("")
    rerender(<NotificationBadge count={3} />)
    expect(container.textContent).toBe("3")
    rerender(<NotificationBadge count={12} />)
    expect(container.textContent).toBe("9+")
  })

  test("lists mentions and opens one", () => {
    const first = item(7)
    const { onOpen } = view({ items: [first, item(8, { read: true, actor: null })], unreadCount: 1 })
    const rows = screen.getAllByRole("button", { name: /mentioned you/ })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain("Ana mentioned you in BB-7 · Pay button fails")
    expect(rows[0]?.textContent).toContain("@Budi tolong cek")
    expect(rows[0]?.textContent).toContain("5 minutes ago")
    expect(rows[0]?.textContent).toContain("Unread")
    expect(rows[1]?.textContent).toContain("Someone mentioned you in BB-8")
    expect(rows[1]?.textContent).not.toContain("Unread")
    fireEvent.click(rows[0] as HTMLElement)
    expect(onOpen).toHaveBeenCalledWith(first)
  })

  test("Mark all as read", () => {
    const { onReadAll } = view({ items: [item(1)], unreadCount: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }))
    expect(onReadAll).toHaveBeenCalled()
    const { unmount } = render(<NotificationBellView data={{ items: [item(2, { read: true })], unreadCount: 0 }} now={NOW} onOpen={mock()} onReadAll={mock()} />)
    expect(screen.getAllByRole("button", { name: "Mark all as read" })).toHaveLength(1)
    unmount()
  })

  test("No mentions yet", () => {
    view({ items: [], unreadCount: 0 })
    expect(screen.getByText("No mentions yet")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull()
  })

  test("bell rows are plain text", () => {
    view({ items: [item(1, { snippet: "<img src=x>", report: { id: "r1", number: 1, title: "<b>t</b>" } })], unreadCount: 1 })
    expect(screen.getByText("<img src=x>")).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
    expect(document.querySelector("b")).toBeNull()
  })
})

describe("NotificationBell via AI", () => {
  test("says which app wrote the mention", () => {
    view({ items: [item(9, { viaAgent: "Claude Code" })], unreadCount: 1 })
    expect(screen.getByRole("button", { name: /mentioned you/ }).textContent).toContain("Ana mentioned you (via Claude Code) in BB-9")
  })
})
