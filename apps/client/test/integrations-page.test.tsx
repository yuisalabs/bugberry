import { describe, expect, test } from "bun:test"
import { render, screen, within } from "@testing-library/react"
import { IntegrationsView } from "../src/pages/landing/IntegrationsView"
import { INTEGRATION_DOCS, WEBHOOK_DOCS } from "../src/pages/landing/site-links"

const card = (name: string) => screen.getByRole("article", { name })
const NAMES = ["GitHub", "GitLab", "Jira", "Linear", "ActiveCollab", "Plane", "Slack", "Discord", "Telegram", "Webhook"]

describe("IntegrationsView", () => {
  test("sends every bug where the team works, with the docs one click away", () => {
    render(<IntegrationsView signedIn={false} installUrl={null} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Send every bug where your team already works")
    expect(screen.getByRole("link", { name: "Read the docs" }).getAttribute("href")).toBe(INTEGRATION_DOCS)
    expect(screen.getByRole("link", { name: /See the webhook docs/ }).getAttribute("href")).toBe(WEBHOOK_DOCS)
    for (const id of ["trackers", "notifications", "webhook"]) expect(document.getElementById(id)).toBeTruthy()
  })

  test("shows exactly BugBerry's ten integrations", () => {
    render(<IntegrationsView signedIn={false} installUrl={null} />)
    const cards = screen.getAllByRole("article").map((element) => element.getAttribute("aria-label"))
    expect(cards).toEqual(NAMES)
  })

  test("what trackers can't do yet says Coming soon", () => {
    render(<IntegrationsView signedIn={false} installUrl={null} />)
    expect(card("GitLab").textContent).toContain("merge request")
    expect(card("GitLab").textContent).toContain("Coming soon")
    expect(card("Linear").textContent).toContain("priority")
    expect(card("Linear").textContent).toContain("Coming soon")
    for (const name of ["GitHub", "Jira", "ActiveCollab", "Plane", "Slack"]) expect(card(name).textContent).not.toContain("Coming soon")
  })

  test("Connect leads to sign-up, or to the workspace's integrations for someone signed in", () => {
    const { unmount } = render(<IntegrationsView signedIn={false} installUrl={null} />)
    expect(within(card("Jira")).getByRole("link", { name: /Connect Jira/ }).getAttribute("href")).toBe("/login")
    unmount()
    render(<IntegrationsView signedIn installUrl={null} />)
    expect(within(card("Slack")).getByRole("link", { name: /Connect/ }).getAttribute("href")).toBe("/app/settings/integrations")
  })

  test("never claims a replay field or repro steps the issue doesn't carry", () => {
    render(<IntegrationsView signedIn={false} installUrl={null} />)
    const text = document.body.textContent ?? ""
    for (const overclaim of ['"replay"', '"failed_requests"', "with a preview", "15-min", "up to 5 reporters"]) expect(text).not.toContain(overclaim)
    expect(screen.getByTestId("webhook-sample")).toBeTruthy()
  })
})
