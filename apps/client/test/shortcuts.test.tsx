import { describe, expect, mock, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ExtensionCardView } from "../src/components/ExtensionCard"
import { NewReportGuide } from "../src/components/NewReportButton"
import { ReportSearchBox } from "../src/components/ReportSearchBox"
import { isMacPlatform, searchShortcut } from "../src/lib/shortcuts"

describe("shortcuts are written for the reader's system", () => {
  test("a Mac is told apart from Windows and Linux", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true)
    expect(isMacPlatform({ platform: "iPad" })).toBe(true)
    expect(isMacPlatform({ platform: "", userAgentData: { platform: "macOS" } })).toBe(true)
    expect(isMacPlatform({ platform: "Win32" })).toBe(false)
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false)
    expect(isMacPlatform({ platform: "", userAgentData: { platform: "Windows" } })).toBe(false)
  })

  test("the search box's shortcut", () => {
    expect(searchShortcut(true)).toBe("⌘K")
    expect(searchShortcut(false)).toBe("Ctrl K")
  })

  // Chrome may leave the extension without its suggested shortcut (it is assigned only on a first install with
  // no conflict), so the dashboard never promises one.
  test("neither the sidebar card nor the New report guide names the extension's shortcut", () => {
    const card = render(<ExtensionCardView answer={{ installed: false }} installUrl={null} onUseServer={mock()} />)
    expect(card.container.textContent).not.toMatch(/Shift|⇧/)
    card.unmount()
    const guide = render(<NewReportGuide answer={{ installed: false }} installUrl={null} onUseServer={mock()} />)
    expect(screen.getByText("Open the page you want to report, then click the BugBerry icon in the toolbar.")).toBeTruthy()
    expect(guide.container.textContent).not.toMatch(/Shift|⇧/)
  })

  test("the search box shows its own shortcut", () => {
    const { rerender } = render(<ReportSearchBox value={undefined} onSearch={mock()} mac={false} />)
    expect(screen.getByText("Ctrl K")).toBeTruthy()
    rerender(<ReportSearchBox value={undefined} onSearch={mock()} mac />)
    expect(screen.getByText("⌘K")).toBeTruthy()
  })
})
