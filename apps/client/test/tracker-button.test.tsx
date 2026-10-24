import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { TrackerButtonView } from "../src/components/report/TrackerButton"
import type { TrackerItem } from "../src/lib/more-menu"

const github: TrackerItem = { integrationId: "gh", label: "Send to GitHub · kantor/web", action: "send", href: null, note: null }
const activecollab: TrackerItem = { integrationId: "ac", label: "Send to ActiveCollab · Project #12", action: "send", href: null, note: null }

function view(primary: { item: TrackerItem; label: string } | null, items: TrackerItem[]) {
  const onSend = mock((_integrationId: string) => {})
  const { container } = render(<TrackerButtonView primary={primary} items={items} onSend={onSend} />)
  return { onSend, container }
}

describe("TrackerButtonView", () => {
  test("nothing to send to or open, no button", () => {
    const { container } = view(null, [])
    expect(container.innerHTML).toBe("")
  })

  test("one tracker: a green button that sends, without an arrow", () => {
    const { onSend } = view({ item: github, label: "Send to GitHub" }, [github])
    const send = screen.getByRole("button", { name: "Send to GitHub" })
    expect(send.className).toContain("--color-leaf")
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledWith("gh")
    expect(screen.queryByRole("button", { name: "Other trackers" })).toBeNull()
  })

  test("more trackers: the arrow lists them all, and each sends", () => {
    const { onSend } = view({ item: github, label: "Send to GitHub" }, [github, activecollab])
    fireEvent.click(screen.getByRole("button", { name: "Other trackers" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to ActiveCollab · Project #12" }))
    expect(onSend).toHaveBeenCalledWith("ac")
  })

  test("a sent issue opens in a new tab", () => {
    const sent: TrackerItem = { ...github, label: "Open in GitHub #142", action: "open", href: "https://github.com/kantor/web/issues/142" }
    view({ item: sent, label: "Open in GitHub #142" }, [sent])
    const open = screen.getByRole("link", { name: "Open in GitHub #142" })
    expect(open.getAttribute("href")).toBe("https://github.com/kantor/web/issues/142")
    expect(open.getAttribute("target")).toBe("_blank")
  })

  test("while it sends the button waits", () => {
    const sending: TrackerItem = { ...github, label: "Sending to GitHub…", action: "none" }
    const { onSend } = view({ item: sending, label: "Sending to GitHub…" }, [sending])
    const button = screen.getByRole("button", { name: "Sending to GitHub…" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSend).not.toHaveBeenCalled()
  })
})
