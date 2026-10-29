import { describe, expect, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { PricingView } from "../src/features/landing/PricingView"

const text = () => document.body.textContent ?? ""
const plan = (name: string) => screen.getByRole("region", { name: `${name} plan` })
const row = (feature: string) => screen.getByRole("row", { name: new RegExp(`^${feature}`) })

describe("PricingView", () => {
  test("says BugBerry is free in early access, with the real limits", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("BugBerry is free while we’re in early access.")
    const free = plan("Free")
    for (const line of ["1 workspace", "5 screenshots", "5 video recordings", "Recordings up to 2 minutes", "Unlimited projects"]) {
      expect(within(free).getByText(line)).toBeTruthy()
    }
    expect(within(free).getByRole("link", { name: "Start for free" }).getAttribute("href")).toBe("/login")
  })

  test("limits are counted in reports and minutes, never in MB", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    for (const button of screen.getAllByRole("button", { name: /\?$/ })) {
      if (button.getAttribute("aria-expanded") === "false") fireEvent.click(button)
    }
    expect(text()).not.toMatch(/MB/)
    expect(text()).toContain("5 screenshots and 5 video recordings per workspace, each recording up to 2 minutes")
    const cells = within(row("Longest recording")).getAllByRole("cell")
    expect(cells.map((cell) => cell.textContent)).toEqual(["2 minutes", "Unlimited", "Unlimited"])
  })

  test("Free stands in the middle and larger than the plans beside it", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    const [free, team, business] = ["Free", "Team", "Business"].map(plan)
    expect(free!.className).toContain("lg:order-2")
    expect(team!.className).toContain("lg:order-1")
    expect(business!.className).toContain("lg:order-3")
    expect(free!.className).toContain("lg:flex-[1.12]")
    expect(free!.className).toContain("lg:-my-5")
  })

  test("Free is for one person: no promise of members", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    for (const claim of ["Unlimited members", "Free for every member", "up to 5 reporters", "15-min", "whole team"]) expect(text()).not.toContain(claim)
  })

  test("Team and Business keep their price and Notify me; only their feature list says Coming soon", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    for (const name of ["Team", "Business"]) {
      const card = plan(name)
      expect(within(card).getByText("Soon")).toBeTruthy()
      expect(within(card).getByText("Pricing announced before early access ends")).toBeTruthy()
      expect(within(card).getByRole("link", { name: "Notify me" }).getAttribute("href")).toBe("/demo")
      expect(card.textContent).not.toContain("Everything in")
      expect(within(card).queryAllByRole("listitem")).toHaveLength(0)
      expect(card.querySelector("[data-plan-lead]")?.textContent).toBe("Coming soon")
    }
  })

  test("the three plans' rows line up: badge, description, price, button, and the line under it", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    for (const name of ["Free", "Team", "Business"]) {
      const card = plan(name)
      expect(card.querySelector("[data-plan-badge]")?.className).toContain("h-6")
      expect(card.querySelector("[data-plan-blurb]")?.className).toContain("min-h-[44px]")
      expect(card.querySelector("[data-plan-lead]")).toBeTruthy()
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

  test("the limit counts reports kept, so deleting one makes room", () => {
    render(<PricingView signedIn={false} installUrl={null} />)
    const answer = (question: string) => {
      const button = screen.getByRole("button", { name: question })
      if (button.getAttribute("aria-expanded") === "false") fireEvent.click(button)
      return document.getElementById(button.getAttribute("aria-controls") ?? "")?.textContent ?? ""
    }
    expect(answer("What counts toward the 5 + 5 limit?")).toContain("Delete one and its place is free again")
    expect(answer("What happens when I hit the limit?")).toContain("delete one")
    expect(answer("What happens when I hit the limit?")).toContain("stops by itself at 2 minutes")
    expect(answer("Do I need a credit card?")).toContain("before you sign in")
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
