import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NewReportButton, NewReportGuide } from "../src/components/NewReportButton"
import type { ExtensionAnswer } from "../src/lib/extension-bridge"
import { readLayout, saveLayout } from "../src/lib/report-layout"

describe("New report", () => {
  test("New report opens the popup, or explains how", async () => {
    const opened = mock(async () => true)
    const ask = mock(async (): Promise<ExtensionAnswer> => ({ installed: true, active: true, version: "1" }))
    render(<NewReportButton open={opened} ask={ask} installUrl={null} />)
    await waitFor(() => expect(ask).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole("button", { name: "New report" }))
    await waitFor(() => expect(opened).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/Open the page you want to report/)).toBeNull()
  })

  test("without the extension the guide shows at once and links to it", async () => {
    const opened = mock(async () => false)
    const ask = mock(async (): Promise<ExtensionAnswer> => ({ installed: false }))
    render(<NewReportButton open={opened} ask={ask} installUrl="https://store.test/x" />)
    await waitFor(() => expect(ask).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: "New report" }))
    // No round trip to an extension that is not there.
    expect(screen.getByText(/^Open the page you want to report, then click the BugBerry icon or press /)).toBeTruthy()
    expect(opened).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: "Install the extension" }).getAttribute("href")).toBe("https://store.test/x")
  })

  test("the guide's three states", () => {
    const onUseServer = mock()
    const guide = (answer: ExtensionAnswer, installUrl: string | null) =>
      render(<NewReportGuide answer={answer} installUrl={installUrl} onUseServer={onUseServer} />)
    const { unmount } = guide({ installed: false }, null)
    expect(screen.getByText("Ask your admin for the BugBerry extension")).toBeTruthy()
    unmount()
    guide({ installed: true, active: false, version: "1" }, null)
    fireEvent.click(screen.getByRole("button", { name: "Use the extension with this server" }))
    expect(onUseServer).toHaveBeenCalled()
  })

  test("the layout choice is remembered and survives broken storage", () => {
    saveLayout("list")
    expect(readLayout()).toBe("list")
    saveLayout("grid")
    expect(readLayout()).toBe("grid")
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked")
      },
    })
    try {
      expect(readLayout()).toBe("grid")
      expect(() => saveLayout("list")).not.toThrow()
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original)
    }
  })
})
