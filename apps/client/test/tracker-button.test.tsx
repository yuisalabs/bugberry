import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { TrackerButtonView } from "../src/components/report/TrackerButton"
import type { TrackerItem } from "../src/lib/more-menu"

const github: TrackerItem = { integrationId: "gh", label: "Send to GitHub · kantor/web", action: "send", href: null, note: null }
const activecollab: TrackerItem = { integrationId: "ac", label: "Send to ActiveCollab · Project #12", action: "send", href: null, note: null }

function view(items: TrackerItem[]) {
  const onSend = mock((_integrationId: string) => {})
  const { container } = render(<TrackerButtonView items={items} onSend={onSend} />)
  return { onSend, container }
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Send to tracker" }))

describe("TrackerButtonView", () => {
  test("nothing to send to or open, no button", () => {
    const { container } = view([])
    expect(container.innerHTML).toBe("")
  })

  test("one tracker is still Send to tracker, in green, and chosen inside", () => {
    const { onSend } = view([github])
    expect(screen.getByRole("button", { name: "Send to tracker" }).className).toContain("--color-leaf")
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to GitHub · kantor/web" }))
    expect(onSend).toHaveBeenCalledWith("gh")
  })

  test("it looks like Copy link: the arrow in a part of its own, split off by a line", () => {
    view([github])
    const arrow = screen.getByRole("button", { name: "Send to tracker" }).querySelector("[data-slot=split-arrow]")
    expect(arrow?.className).toContain("border-l")
  })

  test("every tracker is a choice inside", () => {
    const { onSend } = view([github, activecollab])
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to ActiveCollab · Project #12" }))
    expect(onSend).toHaveBeenCalledWith("ac")
  })

  test("a sent issue opens in a new tab; a send under way can't start again", () => {
    const sent: TrackerItem = { ...github, label: "Open in GitHub #142", action: "open", href: "https://github.com/kantor/web/issues/142" }
    const sending: TrackerItem = { ...activecollab, label: "Sending to ActiveCollab…", action: "none" }
    const { onSend } = view([sent, sending])
    openMenu()
    const open = screen.getByRole("menuitem", { name: "Open in GitHub #142" })
    expect(open.getAttribute("href")).toBe("https://github.com/kantor/web/issues/142")
    expect(open.getAttribute("target")).toBe("_blank")
    expect(screen.getByRole("menuitem", { name: "Sending to ActiveCollab…" }).getAttribute("aria-disabled")).toBe("true")
    expect(onSend).not.toHaveBeenCalled()
  })
})
