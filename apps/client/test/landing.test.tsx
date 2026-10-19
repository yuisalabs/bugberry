import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { LandingView } from "../src/pages/landing/LandingView"
import { HeroMockup } from "../src/pages/landing/HeroMockup"

describe("LandingView", () => {
  test("pitches BugBerry and sends visitors to sign up", () => {
    render(<LandingView signedIn={false} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stop describing bugs. Show them.")
    const getStarted = screen.getAllByRole("link", { name: "Get started free" })
    expect(getStarted.length).toBeGreaterThan(0)
    for (const link of getStarted) expect(link.getAttribute("href")).toBe("/login")
    for (const link of screen.getAllByRole("link", { name: "Sign in" })) expect(link.getAttribute("href")).toBe("/login")
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("#how-it-works")
    expect(document.getElementById("how-it-works")).toBeTruthy()
    expect(document.getElementById("features")).toBeTruthy()
  })

  test("a signed-in visitor gets a way back to the dashboard instead of sign-up", () => {
    render(<LandingView signedIn />)
    expect(screen.getAllByRole("link", { name: "Open dashboard" })[0]?.getAttribute("href")).toBe("/app")
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull()
  })

  test("never mentions features BugBerry does not have", () => {
    render(<LandingView signedIn={false} />)
    const text = document.body.textContent ?? ""
    for (const claim of ["SOC 2", "Pricing", "Instant replay", "Linear", "Jira", "Slack", "widget", "Trusted by", "Kanban", "writes the repro"]) {
      expect(text).not.toContain(claim)
    }
  })

  test("describes privacy and captured details only as far as BugBerry really goes", () => {
    render(<LandingView signedIn={false} />)
    const text = document.body.textContent ?? ""
    for (const overclaim of ["masked before anything leaves the browser", "4242 •••• 4242", "131.0.6778", "15.2 Sequoia", "Every request"]) {
      expect(text).not.toContain(overclaim)
    }
    expect(text).toContain("Blur anything sensitive in a screenshot before you send it.")
  })

  test("the header fits a phone: nav links never wrap and Sign in steps aside on narrow screens", () => {
    render(<LandingView signedIn={false} />)
    const nav = screen.getByRole("navigation", { name: "Main" })
    for (const link of Array.from(nav.querySelectorAll("a"))) expect(link.className).toContain("whitespace-nowrap")
    const signIn = Array.from(nav.querySelectorAll("a")).find((link) => link.textContent === "Sign in")
    expect(signIn?.className).toContain("hidden")
    expect(signIn?.className).toContain("sm:inline")
  })
})

describe("HeroMockup", () => {
  test("its shadow rises up and out, never below the flat bottom edge where the next section starts", () => {
    const { container } = render(<HeroMockup />)
    const shadow = /shadow-\[0_(-?\d+)px_(\d+)px_(-?\d+)px_/.exec((container.firstElementChild as HTMLElement).className)
    expect(shadow).toBeTruthy()
    const [, y, blur, spread] = shadow!.map(Number)
    // How far the shadow reaches past the bottom edge: offset plus blur, less what the spread pulls in.
    expect((y ?? 0) + (blur ?? 0) + (spread ?? 0)).toBeLessThanOrEqual(8)
  })
})

describe("the sign-up buttons", () => {
  test("the header's and the hero's are leaf green, like the 'bug' of the logo; the banner's stays white on pink", () => {
    for (const signedIn of [false, true]) {
      const { unmount } = render(<LandingView signedIn={signedIn} />)
      const [header, hero, banner] = screen.getAllByRole("link", { name: signedIn ? "Open dashboard" : "Get started free" })
      for (const link of [header, hero]) {
        expect(link?.className).toContain("bg-leaf")
        expect(link?.className).not.toContain("bg-primary")
      }
      expect(banner?.className).toContain("bg-background")
      unmount()
    }
  })

  test("the green is a theme token taken from the wordmark", () => {
    // The theme is shared with the extension, in packages/ui.
    const css = readFileSync(join(import.meta.dir, "..", "..", "..", "packages", "ui", "src", "theme.css"), "utf8")
    expect(css).toContain("--color-leaf: var(--leaf);")
    expect(css).toContain("--leaf: #4FA024;")
  })
})
