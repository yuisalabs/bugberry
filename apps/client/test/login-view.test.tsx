import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { LoginView } from "../src/components/LoginView"
import { DOCS_URL } from "../src/lib/docs-url"

const all = { github: true, gitlab: true, google: true, emailOtp: true }
const handlers = () => ({ onProvider: mock(), onSendCode: mock(async () => {}), onVerifyCode: mock(async () => {}) })

describe("LoginView", () => {
  test("welcomes the person and shows only the methods the server enables", () => {
    const { rerender } = render(<LoginView methods={all} message={null} {...handlers()} />)
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeTruthy()
    expect(screen.getByText("Log in or sign up with your work account.")).toBeTruthy()
    expect(screen.getByText("Your bugs are waiting")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: /^Continue with/ }).map((button) => button.textContent)).toEqual([
      "Continue with GitHub",
      "Continue with GitLab",
      "Continue with Google",
    ])
    rerender(<LoginView methods={{ github: false, gitlab: false, google: false, emailOtp: true }} message={null} {...handlers()} />)
    expect(screen.queryByRole("button", { name: /^Continue with/ })).toBeNull()
    expect(screen.queryByText("or")).toBeNull()
    expect(screen.getByLabelText("Work email")).toBeTruthy()
    rerender(<LoginView methods={{ github: true, gitlab: false, google: false, emailOtp: false }} message={null} {...handlers()} />)
    expect(screen.queryByLabelText("Work email")).toBeNull()
  })

  test("the email field suggests the shape of a work address", () => {
    render(<LoginView methods={all} message={null} {...handlers()} />)
    expect(screen.getByLabelText("Work email").getAttribute("placeholder")).toBe("you@company.com")
  })

  test("an emailed code is asked for after Continue, and can be resent after 30 seconds", async () => {
    const h = handlers()
    render(<LoginView methods={all} message={null} {...h} />)
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: " ana@kantor.com " } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await screen.findByLabelText("Verification code")
    expect(h.onSendCode).toHaveBeenCalledWith("ana@kantor.com")
    expect(screen.getByText("If this address can sign in, we sent it a code.")).toBeTruthy()
    expect(screen.getByText("Didn't receive the code?")).toBeTruthy()
    expect((screen.getByRole("button", { name: /Resend code/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(h.onVerifyCode).toHaveBeenCalledWith("ana@kantor.com", "123456")
  })

  test("provider buttons keep their filled look and the providers' own coloured logos", () => {
    render(<LoginView methods={all} message={null} {...handlers()} />)
    const google = screen.getByRole("button", { name: "Continue with Google" })
    // Intent's secondary button, with its border hidden.
    expect(google.className).toContain("[--btn-bg:var(--color-secondary)]")
    expect(google.className).toContain("border-transparent")
    expect(google.innerHTML).toContain('fill="#4285F4"')
    expect(screen.getByRole("button", { name: "Continue with GitLab" }).innerHTML).toContain('fill="#FC6D26"')
  })

  test("a provider button starts that provider", () => {
    const h = handlers()
    render(<LoginView methods={all} message={null} {...h} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitLab" }))
    expect(h.onProvider).toHaveBeenCalledWith("gitlab")
  })

  test("shows a sign-in error", () => {
    render(<LoginView methods={all} message="Sign-in was cancelled." {...handlers()} />)
    expect(screen.getByRole("alert").textContent).toBe("Sign-in was cancelled.")
  })

  test("the name in the corner is the typeface alone, as in the design; then the terms line and this year's footer", () => {
    render(<LoginView methods={all} message={null} {...handlers()} />)
    expect(screen.getByRole("img", { name: "BugBerry" }).getAttribute("src")).toBe("/assets/bugberry_typeface_small.webp")
    expect(screen.getByText(/^By continuing, you agree to BugBerry's Terms of Service and/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy")
    expect(screen.getByText(`© ${new Date().getFullYear()} BugBerry`)).toBeTruthy()
  })

  test("the footer links the docs by their full address", () => {
    render(<LoginView methods={all} message={null} {...handlers()} />)
    expect(screen.getByRole("link", { name: "Documentation" }).getAttribute("href")).toBe(DOCS_URL)
  })

  test("the showcase: its headline is read out, its decoration is not", () => {
    render(<LoginView methods={all} message={null} {...handlers()} />)
    expect(screen.getByRole("heading", { level: 2, name: "Every bug, picked fresh." })).toBeTruthy()
    expect(screen.getByText(/One click turns a weird glitch into a full report\./)).toBeTruthy()
    const art = screen.getByText("TypeError: cart is undefined").closest("[aria-hidden]")
    expect(art?.getAttribute("aria-hidden")).toBe("true")
    expect(art?.contains(screen.getByText("all captured, no repro needed"))).toBe(true)
    expect(art?.querySelector('img[src="/assets/bugberry_icon_medium.webp"]')).toBeTruthy()
    expect(screen.getByText("POST /api/checkout")).toBeTruthy()
    expect(screen.getByText("Recording")).toBeTruthy()
  })
})
