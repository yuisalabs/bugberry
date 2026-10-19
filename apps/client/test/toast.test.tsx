import { beforeEach, describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { toast as sonner } from "sonner"
import { Toast } from "@bugberry/ui/toast"
import { TOAST_MS, toast } from "../src/lib/toast"

// Sonner keeps its toasts in one module-wide queue; clear what other tests left there.
beforeEach(() => {
  sonner.dismiss()
})

describe("toast", () => {
  test("shows the title and description in Intent's Toast", async () => {
    render(<Toast visibleToasts={20} />)
    toast({ title: "Toast test: saved", description: "Only workspace members can open it" })
    expect(await screen.findByText("Toast test: saved")).toBeTruthy()
    expect(screen.getByText("Only workspace members can open it")).toBeTruthy()
    expect(TOAST_MS).toBe(4000)
  })

  test("an error toast says so", async () => {
    render(<Toast visibleToasts={20} />)
    toast({ title: "Toast test: failed", tone: "error" })
    const title = await screen.findByText("Toast test: failed")
    expect(title.closest("[data-sonner-toast]")?.getAttribute("data-type")).toBe("error")
  })
})
