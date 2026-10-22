import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen, within } from "@testing-library/react"
import { HomeView } from "../src/pages/landing/HomeView"
import { CHROME_WEB_STORE_URL } from "../src/pages/landing/site-links"

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

  test("the New pill draws the eye: a light circles its outline and a shine crosses its badge, only for people who allow motion", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    const pill = screen.getByRole("link", { name: /Connect your AI agent in 2 minutes/ })
    expect(pill.className).toContain("glow-ring")
    expect(within(pill).getByText("New").className).toContain("shine")
    const css = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")
    const still = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"))
    const moving = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"))
    for (const motion of ["glow-spin", "shine-sweep"]) {
      expect(moving).toContain(`@keyframes ${motion}`)
      expect(still).not.toContain(motion)
    }
  })

  test("the three ideas' heading stays in view while their rows scroll past, on wide screens", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    const heading = screen.getByRole("heading", { name: "Three ideas behind every report" }).parentElement!
    for (const name of ["lg:sticky", "lg:top-24", "lg:self-start"]) expect(heading.className).toContain(name)
  })

  test("without an install link from the server, Add to Chrome goes to the Chrome Web Store page", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const link of screen.getAllByRole("link", { name: /Add to Chrome/ })) expect(link.getAttribute("href")).toBe(CHROME_WEB_STORE_URL)
  })

  test("has its named sections, for links into the page", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    for (const id of ["capture", "debug", "collaborate", "ai-agents", "integrations"]) expect(document.getElementById(id)).toBeTruthy()
  })

  test("the home page names only what BugBerry does today", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    const text = document.body.textContent ?? ""
    for (const gone of ["Coming soon", "guests", "SSO", "audit log"]) expect(text).not.toContain(gone)
    expect(holder("Invite your team by email")?.textContent).toContain("share any report through a link")
  })

  test("the AI cards describe only what agents do today", () => {
    render(<HomeView signedIn={false} installUrl={null} />)
    const cards = document.getElementById("ai-agents")!.querySelector(".grid")!
    const text = cards.textContent ?? ""
    expect(text).not.toContain("Coming soon")
    for (const gone of ["open a PR", "Slack"]) expect(text).not.toContain(gone)
    // What the MCP server really does: read the evidence and the failing code lines, comment, change the status.
    for (const real of ["code lines that failed", "comment", "Resolved", "Claude.ai", "ChatGPT"]) expect(text).toContain(real)
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
      // Tracker issues carry the errors and a link to the report, nothing attached.
      "logs, video and repro steps",
      "with the replay attached",
      "full repro attached",
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
