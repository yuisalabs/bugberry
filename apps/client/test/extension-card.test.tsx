import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ExtensionCardView } from "../src/components/ExtensionCard"

describe("ExtensionCardView", () => {
  test("the extension card in each state", () => {
    const { rerender } = render(
      <ExtensionCardView answer={{ installed: false }} installUrl="https://store.test/bugberry" onUseServer={mock()} mac />,
    )
    expect(screen.getByText("Browser extension")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Browser extension" })).toBeTruthy()
    expect(screen.getByText("Press ⌘⇧K on any page to open BugBerry")).toBeTruthy()
    expect(screen.getByText("Not installed")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Install" }).getAttribute("href")).toBe("https://store.test/bugberry")

    rerender(<ExtensionCardView answer={{ installed: false }} installUrl={null} onUseServer={mock()} />)
    expect(screen.queryByRole("link", { name: "Install" })).toBeNull()

    rerender(<ExtensionCardView answer={{ installed: true, active: true, version: "3.8.1" }} installUrl={null} onUseServer={mock()} />)
    expect(screen.getByText("Installed, v3.8.1")).toBeTruthy()

    const onUseServer = mock()
    rerender(<ExtensionCardView answer={{ installed: true, active: false, version: "3.8.1" }} installUrl={null} onUseServer={onUseServer} />)
    fireEvent.click(screen.getByRole("button", { name: "Use the extension with this server" }))
    expect(onUseServer).toHaveBeenCalled()
  })
})

test("in Firefox the card shows Firefox's shortcut", () => {
  render(<ExtensionCardView answer={{ installed: false }} installUrl={null} onUseServer={mock()} mac={false} firefox />)
  expect(screen.getByText("Press Alt+Shift+B on any page to open BugBerry")).toBeTruthy()
})
