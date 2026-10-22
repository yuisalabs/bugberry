import { describe, expect, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { PricingView } from "../src/pages/landing/PricingView"

const text = () => document.body.textContent ?? ""
const plan = (name: string) => screen.getByRole("region", { name: `${name} plan` })
const row = (feature: string) => screen.getByRole("row", { name: new RegExp(`^${feature}`) })

describe("PricingView", () => {
  test("says BugBerry is free in early access, with the real limits", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("BugBerry is free while we’re in early access.")
    const free = plan("Free")
    for (const line of ["1 workspace", "5 screenshots", "5 video recordings", "Unlimited projects"]) expect(within(free).getByText(line)).toBeTruthy()
    expect(within(free).getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/login")
  })

  test("Free is for one person: no promise of members", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    for (const claim of ["Unlimited members", "Free for every member", "up to 5 reporters", "15-min", "whole team"]) expect(text()).not.toContain(claim)
  })

  test("Team and Business are coming; inviting your team is Team's first line", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    const team = plan("Team")
    expect(within(team).getAllByRole("listitem")[0]?.textContent).toContain("Invite your team")
    for (const name of ["Team", "Business"]) {
      expect(within(plan(name)).getByText("Coming soon")).toBeTruthy()
      expect(within(plan(name)).getByRole("link", { name: "Notify me" }).getAttribute("href")).toBe("/demo")
    }
  })

  test("the comparison says guests are not in Free and are coming to the paid plans", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    const cells = within(row("Reporters & guests")).getAllByRole("cell")
    expect(cells[0]?.textContent).toBe("Not included")
    expect(cells[1]?.textContent).toContain("Coming soon")
    expect(cells[2]?.textContent).toContain("Coming soon")
  })

  test("the comparison never calls Free's reports unlimited", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    expect([...document.querySelectorAll("th[scope=row]")].map((cell) => cell.textContent)).not.toContain("History")
  })

  test("self-hosting has no limits and a person to talk to", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    expect(screen.getByRole("link", { name: "Talk to us about self-hosting" }).getAttribute("href")).toBe("/demo")
    expect(text()).toContain("No usage limits")
  })

  test("every question has an answer", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    const questions = screen.getAllByRole("button", { name: /\?$/ })
    expect(questions.length).toBe(6)
    for (const question of questions) {
      if (question.getAttribute("aria-expanded") === "false") fireEvent.click(question)
      const answer = document.getElementById(question.getAttribute("aria-controls") ?? "")
      expect(answer?.textContent?.trim().length ?? 0).toBeGreaterThan(20)
    }
    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe("mailto:yuisalabs@gmail.com")
  })
})
