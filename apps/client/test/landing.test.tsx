import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { HomeView } from "../src/pages/landing/HomeView"

const STORE = "https://chromewebstore.google.com/detail/x"
const text = () => document.body.textContent ?? ""
/** The smallest element whose text contains `needle`. */
const holder = (needle: string) =>
  Array.from(document.querySelectorAll("li, p, div, article"))
    .filter((element) => element.textContent?.includes(needle))
    .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0]

describe("HomeView", () => {
  test("says what BugBerry is and offers the extension and a person to talk to", () => {
    render(<HomeView signedIn={false} installUrl={STORE} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bug reporting for teams, and the agents that fix them")
    const install = screen.getAllByRole("link", { name: /Add to Chrome, it’s free/ })
    for (const link of install) expect(link.getAttribute("href")).toBe(STORE)
    expect(screen.getByRole("link", { name: /Talk to a human/ }).getAttribute("href")).toBe("/demo")
    expect(screen.getByRole("link", { name: /Connect your AI agent in 2 minutes/ }).getAttribute("href")).toBe("/ai-agents")
  })

  test("without an install link, Add to Chrome goes to sign-in", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const link of screen.getAllByRole("link", { name: /Add to Chrome/ })) expect(link.getAttribute("href")).toBe("/login")
  })

  test("has the sections the Product menu and the footer point at", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const id of ["capture", "debug", "collaborate", "ai-agents", "integrations"]) expect(document.getElementById(id)).toBeTruthy()
  })

  test("features BugBerry doesn't have yet say Coming soon", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const claim of ["clients and QA vendors as guests", "SSO, roles and audit logs", "open a PR", "from Slack"]) {
      expect(holder(claim)?.textContent).toContain("Coming soon")
    }
  })

  test("never promises what BugBerry doesn't do", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const overclaim of [
      "Unlimited members",
      "Free for every member",
      "up to 5 reporters",
      "15-min",
      "SOC 2",
      "Trusted by",
      "card numbers",
      "scoped by project",
      "app.bugberry.dev",
    ]) {
      expect(text()).not.toContain(overclaim)
    }
  })

  test("the webhook sample uses the fields BugBerry really sends", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    const sample = screen.getByTestId("webhook-sample").textContent ?? ""
    const sent = readFileSync(join(import.meta.dir, "..", "..", "api", "src", "lib", "notifiers", "channels.ts"), "utf8")
    const body = sent.slice(sent.indexOf("function webhookClient"), sent.indexOf("x-bugberry-event"))
    const keys = [...sample.matchAll(/"(\w+)":/g)].map((match) => match[1]!)
    expect(keys.length).toBeGreaterThan(5)
    for (const key of keys) expect(body).toContain(`${key}:`)
  })
})
