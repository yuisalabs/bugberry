import { describe, expect, mock, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ExtensionCardView } from "../src/components/ExtensionCard"
import { NewReportGuide } from "../src/components/NewReportButton"
import { ReportSearchBox } from "../src/components/ReportSearchBox"
import { isMacPlatform, openShortcut, searchShortcut } from "../src/lib/shortcuts"

describe("shortcuts are written for the reader's system", () => {
  test("a Mac is told apart from Windows and Linux", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true)
    expect(isMacPlatform({ platform: "iPad" })).toBe(true)
    expect(isMacPlatform({ platform: "", userAgentData: { platform: "macOS" } })).toBe(true)
    expect(isMacPlatform({ platform: "Win32" })).toBe(false)
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false)
    expect(isMacPlatform({ platform: "", userAgentData: { platform: "Windows" } })).toBe(false)
  })

  test("the extension's shortcut, as its manifest sets it, and the search box's", () => {
    expect(openShortcut(true)).toBe("⌘⇧K")
    expect(openShortcut(false)).toBe("Ctrl+Shift+K")
    expect(searchShortcut(true)).toBe("⌘K")
    expect(searchShortcut(false)).toBe("Ctrl K")
  })

  test("the sidebar card says the shortcut opens BugBerry", () => {
    const { rerender } = render(<ExtensionCardView answer={{ installed: false }} installUrl={null} onUseServer={mock()} mac={false} />)
    expect(screen.getByText("Press Ctrl+Shift+K on any page to open BugBerry")).toBeTruthy()
    rerender(<ExtensionCardView answer={{ installed: false }} installUrl={null} onUseServer={mock()} mac />)
    expect(screen.getByText("Press ⌘⇧K on any page to open BugBerry")).toBeTruthy()
  })

  test("the New report guide names the same shortcut", () => {
    const { rerender } = render(<NewReportGuide answer={{ installed: false }} installUrl={null} onUseServer={mock()} mac={false} />)
    expect(screen.getByText("Open the page you want to report, then click the BugBerry icon or press Ctrl+Shift+K")).toBeTruthy()
    rerender(<NewReportGuide answer={{ installed: false }} installUrl={null} onUseServer={mock()} mac />)
    expect(screen.getByText("Open the page you want to report, then click the BugBerry icon or press ⌘⇧K")).toBeTruthy()
  })

  test("the search box shows its own shortcut", () => {
    const { rerender } = render(<ReportSearchBox value={undefined} onSearch={mock()} mac={false} />)
    expect(screen.getByText("Ctrl K")).toBeTruthy()
    rerender(<ReportSearchBox value={undefined} onSearch={mock()} mac />)
    expect(screen.getByText("⌘K")).toBeTruthy()
  })
})
