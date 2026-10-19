import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConsentView } from "../src/pages/OAuthConsentPage"

const props = {
  appName: "Claude Code",
  appUri: "https://claude.ai",
  email: "ana@kantor.test",
  scope: "openid offline_access bugberry:read bugberry:write",
  busy: false,
  error: null,
  onAllow: mock(),
  onDeny: mock(),
}

describe("ConsentView", () => {
  test("shows the app, the account and what it may do", () => {
    render(<ConsentView {...props} />)
    expect(screen.getByRole("heading", { name: "Claude Code wants to use BugBerry" })).toBeTruthy()
    expect(screen.getByText("Signed in as ana@kantor.test")).toBeTruthy()
    expect(screen.getByText("Read reports, comments and debugger data in your workspaces")).toBeTruthy()
    expect(screen.getByText("Comment, change status, priority and assignee, and send reports to trackers")).toBeTruthy()
  })

  test("Allow and Deny answer the request", () => {
    const onAllow = mock()
    const onDeny = mock()
    render(<ConsentView {...props} onAllow={onAllow} onDeny={onDeny} />)
    fireEvent.click(screen.getByRole("button", { name: "Allow" }))
    fireEvent.click(screen.getByRole("button", { name: "Deny" }))
    expect(onAllow).toHaveBeenCalled()
    expect(onDeny).toHaveBeenCalled()
  })

  test("a read-only request lists only reading", () => {
    render(<ConsentView {...props} scope="openid bugberry:read" />)
    expect(screen.queryByText("Comment, change status, priority and assignee, and send reports to trackers")).toBeNull()
  })

  test("shows errors", () => {
    render(<ConsentView {...props} error="This request has expired. Start again from your AI app." />)
    expect(screen.getByRole("alert").textContent).toBe("This request has expired. Start again from your AI app.")
  })
})
