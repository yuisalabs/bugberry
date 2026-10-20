import { describe, expect, mock, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ExtensionCardView } from "../src/components/ExtensionCard"
import { NewReportGuide } from "../src/components/NewReportButton"
import { ReportSearchBox } from "../src/components/ReportSearchBox"
import { isFirefox, isMacPlatform, openShortcut, searchShortcut } from "../src/lib/shortcuts"

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

  test("Firefox opens BugBerry with Alt+Shift+B (its Ctrl+Shift+K is the Web Console)", () => {
    expect(openShortcut(false, true)).toBe("Alt+Shift+B")
    expect(openShortcut(true, true)).toBe("⌥⇧B")
    expect(openShortcut(true)).toBe("⌘⇧K")
  })

  test("Firefox is told apart from Chrome and Opera", () => {
    expect(isFirefox("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(true)
    expect(isFirefox("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(false)
    expect(
      isFirefox("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/124.0.0.0"),
    ).toBe(false)
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
