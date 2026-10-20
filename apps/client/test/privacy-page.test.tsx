import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { PrivacyPolicy } from "../src/pages/PrivacyPage"
import { createAppRouter } from "../src/router"

describe("privacy policy", () => {
  test("says what the extension collects, when it leaves the browser, and what is never done with it", () => {
    render(<PrivacyPolicy />)
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "What the browser extension collects" })).toBeTruthy()
    expect(screen.getByText(/^A screenshot or a recording of the tab, screen or window you choose/)).toBeTruthy()
    expect(screen.getByText(/Passwords, card numbers, tokens/)).toBeTruthy()
    expect(screen.getByText(/only when you send a report/i)).toBeTruthy()
    expect(screen.getByText(/We do not sell/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "yuisalabs@gmail.com" }).getAttribute("href")).toBe("mailto:yuisalabs@gmail.com")
  })

  test("is public: /privacy opens without signing in", () => {
    const router = createAppRouter(new QueryClient())
    const route = (router.routesByPath as Record<string, { parentRoute?: { id: string } }>)["/privacy"]
    expect(route).toBeTruthy()
    expect(route?.parentRoute?.id).toBe("__root__")
  })
})
