import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { WorkspaceAccessView } from "../src/pages/settings/WorkspaceSettingsPage"

type Access = Parameters<typeof WorkspaceAccessView>[0]["access"]
const base: Access = { shareCode: null, joinDomain: null, joinMode: null, ownDomain: "javan.co.id" }

function view(access: Partial<Access> = {}) {
  const props = { access: { ...base, ...access }, origin: "https://bugberry.kantor.com", busy: false, onShareLink: mock(), onDomain: mock() }
  render(<WorkspaceAccessView {...props} />)
  return props
}

describe("WorkspaceAccessView", () => {
  test("the invite link can be turned on, copied and reset", () => {
    const off = view()
    expect(screen.getByRole("heading", { name: "Invite link" })).toBeTruthy()
    const toggle = screen.getByRole("switch", { name: "Invite link" })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    expect(off.onShareLink).toHaveBeenCalledWith("on")
  })

  test("with the link on, it shows the link and the code", () => {
    const on = view({ shareCode: "7KX-29QF" })
    expect(screen.getByText("bugberry.kantor.com/join/7KX-29QF")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(on.onShareLink).toHaveBeenCalledWith("reset")
    fireEvent.click(screen.getByRole("switch", { name: "Invite link" }))
    expect(on.onShareLink).toHaveBeenCalledWith("off")
  })

  test("join by email domain uses only my domain", () => {
    const props = view()
    expect(screen.getByRole("heading", { name: "Join by email domain" })).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Let people with @javan.co.id join" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinDomain: "javan.co.id", joinMode: "approval" })
  })

  test("choosing a mode, and turning it off", () => {
    const props = view({ joinDomain: "javan.co.id", joinMode: "approval" })
    fireEvent.click(screen.getByRole("radio", { name: "Join directly" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinMode: "direct" })
    fireEvent.click(screen.getByRole("switch", { name: "Let people with @javan.co.id join" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinDomain: null })
  })

  test("a co-admin from another domain sees the real domain, changes the mode and can turn it off", () => {
    const props = view({ joinDomain: "kantor.com", joinMode: "approval", ownDomain: "other.com" })
    const toggle = screen.getByRole("switch", { name: "Let people with @kantor.com join" })
    expect((toggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: "Join directly" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinMode: "direct" })
    fireEvent.click(toggle)
    expect(props.onDomain).toHaveBeenCalledWith({ joinDomain: null })
  })

  test("an admin with a free mail address can still turn an existing domain off", () => {
    const props = view({ joinDomain: "kantor.com", joinMode: "direct", ownDomain: null })
    fireEvent.click(screen.getByRole("switch", { name: "Let people with @kantor.com join" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinDomain: null })
  })

  test("a free mail domain can't be used", () => {
    view({ ownDomain: null })
    expect(screen.getByText("Your email domain can't be used for this")).toBeTruthy()
    expect(screen.queryByRole("switch", { name: /Let people with/ })).toBeNull()
  })
})

describe("WorkspaceAccessView on a limited account", () => {
  const limited = (access: Partial<Access> = {}) => {
    const props = { access: { ...base, ...access }, origin: "https://bugberry.kantor.com", busy: false, onShareLink: mock(), onDomain: mock() }
    render(<WorkspaceAccessView {...props} membersAllowed={false} />)
    return props
  }

  test("shows why, with nothing to turn on", () => {
    limited()
    expect(screen.getByText("Inviting teammates isn't available on this account.")).toBeTruthy()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  test("a way in that is already open can still be closed", () => {
    const props = limited({ shareCode: "7KX-29QF", joinDomain: "javan.co.id", joinMode: "direct" })
    fireEvent.click(screen.getByRole("button", { name: "Turn off invite link" }))
    expect(props.onShareLink).toHaveBeenCalledWith("off")
    fireEvent.click(screen.getByRole("button", { name: "Turn off joining by email domain" }))
    expect(props.onDomain).toHaveBeenCalledWith({ joinDomain: null })
  })
})
