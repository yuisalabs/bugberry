import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { PrivacyPolicy, PrivacyView } from "../src/features/landing/PrivacyPage"
import { createAppRouter } from "../src/router"

describe("privacy policy", () => {
  test("says what the extension collects, when it leaves the browser, and what is never done with it", () => {
    render(<PrivacyPolicy />)
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "What the browser extension collects" })).toBeTruthy()
    expect(screen.getByText(/^A screenshot or a recording of the tab, screen or window you choose/)).toBeTruthy()
    expect(screen.getByText(/replaced with “\[redacted\]”/)).toBeTruthy()
    // Card numbers are not masked anywhere; the policy must not say they are.
    expect(document.body.textContent).not.toContain("card numbers")
    expect(screen.getByText(/only when you send a report/i)).toBeTruthy()
    expect(screen.getByText(/We do not sell/)).toBeTruthy()
    for (const link of screen.getAllByRole("link", { name: "yuisalabs@gmail.com" })) expect(link.getAttribute("href")).toBe("mailto:yuisalabs@gmail.com")
  })

  test("says what a demo request keeps, and for how long", () => {
    render(<PrivacyPolicy />)
    const section = screen.getByRole("heading", { level: 2, name: "If you request a demo" }).parentElement!
    for (const part of ["work email", "company", "deleted"]) expect(section.textContent).toContain(part)
  })

  test("covers security and the terms of use too", () => {
    render(<PrivacyPolicy />)
    expect(screen.getByRole("heading", { level: 2, name: "Security" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Terms of use" })).toBeTruthy()
    expect(screen.getByText(/encrypted/)).toBeTruthy()
    expect(screen.getByText(/report a vulnerability/i)).toBeTruthy()
  })

  test("on a self-hosted server the page links only what that server has", () => {
    render(<PrivacyView signedIn={false} publicSite={false} />)
    const hrefs = [...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    expect(hrefs).not.toContain("/pricing")
    expect(hrefs).not.toContain("/demo")
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy()
  })

  test("on BugBerry cloud it sits in the public site, with the server's install link", () => {
    render(<PrivacyView signedIn={false} publicSite installUrl="https://chromewebstore.google.com/detail/x" />)
    expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain("https://chromewebstore.google.com/detail/x")
    expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain("/pricing")
  })

  test("is public: /privacy opens without signing in", () => {
    const router = createAppRouter(new QueryClient())
    const route = (router.routesByPath as Record<string, { parentRoute?: { id: string } }>)["/privacy"]
    expect(route).toBeTruthy()
    expect(route?.parentRoute?.id).toBe("__root__")
  })
})
