import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConnectionForm } from "../src/components/ConnectionForm"
import { GITHUB_TOKEN_URL, IssuePreview } from "../src/components/IntegrationForm"
import type { Connection } from "../src/lib/api"
import { AllIntegrations, catalogueOrder, ConnectionRow, deleteDescription, EmptyGroup, usageText } from "../src/pages/settings/ConnectionsPage"

const slack: Connection = {
  id: "c1",
  provider: "slack",
  kind: "notifier",
  name: "Slack #qa",
  usedIn: 2,
  status: { failing: 2, lastError: "Slack rejected the message (HTTP 404)", lastDeliveredAt: null },
  settings: {},
  usedBy: [
    { projectId: "p1", projectName: "Checkout Web" },
    { projectId: "p2", projectName: "Admin Panel" },
  ],
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save connection" }))

describe("the workspace Integrations page", () => {
  test("every provider has a card; the ones in use say how many and offer another", () => {
    const onPick = mock()
    render(<AllIntegrations providers={["github", "slack", "webhook"]} connected={{ github: 2 }} onPick={onPick} />)
    expect(screen.getByRole("heading", { name: /All integrations/ }).textContent).toContain("3")
    expect(screen.getByText("Custom endpoint")).toBeTruthy()
    expect(screen.getByText("2 connected")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }))
    expect(onPick).toHaveBeenCalledWith("slack")
    fireEvent.click(screen.getByRole("button", { name: "Add another GitHub connection" }))
    expect(onPick).toHaveBeenCalledWith("github")
  })

  test("providers not connected yet come first, each group keeping its order", () => {
    expect(catalogueOrder(["github", "gitlab", "slack", "webhook"], { github: 1, slack: 3 })).toEqual(["gitlab", "webhook", "github", "slack"])
  })

  test("a group with nothing connected says what it is for", () => {
    const onPick = mock()
    render(<EmptyGroup providers={["slack"]} title="No chat channels yet" text="Post new reports." action="Connect a channel" onPick={onPick} />)
    fireEvent.click(screen.getByRole("button", { name: "Connect a channel" }))
    expect(onPick).toHaveBeenCalled()
  })

  test("a Jira connection takes the site, the account email and the token", () => {
    const onSubmit = mock()
    render(<ConnectionForm initialProvider="jira" busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Jira")
    type("Jira site", "https://kantor.atlassian.net")
    type("Atlassian account email", "dana@kantor.test")
    type("API token", "atl_x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "jira",
      name: "Jira",
      settings: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" },
      secret: "atl_x",
    })
  })

  test("a Plane connection starts at Plane Cloud and takes the workspace slug and an API key", () => {
    const onSubmit = mock()
    render(<ConnectionForm initialProvider="plane" busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect((screen.getByLabelText("Plane address") as HTMLInputElement).value).toBe("https://api.plane.so")
    type("Workspace slug", "kantor")
    type("API key", "plane_api_x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "plane",
      name: "Plane",
      settings: { baseUrl: "https://api.plane.so", workspaceSlug: "kantor" },
      secret: "plane_api_x",
    })
  })

  test("a Slack connection takes only its webhook URL, and only Slack's", () => {
    const onSubmit = mock()
    render(<ConnectionForm initialProvider="slack" busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    type("Name", "Slack #qa")
    type("Incoming Webhook URL", "https://kantor.test/not-slack")
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/Slack/)
    type("Incoming Webhook URL", "https://hooks.slack.com/services/T0/B0/x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "slack", name: "Slack #qa", settings: {}, secret: "https://hooks.slack.com/services/T0/B0/x" })
  })

  test("editing keeps the provider and may leave the secret empty", () => {
    const onSubmit = mock()
    render(<ConnectionForm connection={slack} busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect((screen.getByRole("radio", { name: "Slack" }) as HTMLInputElement).disabled).toBe(true)
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "slack", name: "Slack #qa", settings: {}, secret: "" })
  })

  test("the token can be shown, and GitHub's token page is one click away", () => {
    render(<ConnectionForm busy={false} onSubmit={mock()} onCancel={() => {}} />)
    const token = screen.getByLabelText("Personal access token") as HTMLInputElement
    expect(token.type).toBe("password")
    fireEvent.click(screen.getByRole("button", { name: "Show token" }))
    expect(token.type).toBe("text")
    expect(screen.getByRole("link", { name: /Create one on GitHub/ }).getAttribute("href")).toBe(GITHUB_TOKEN_URL)
  })

  test("the preview shows a GitHub issue's labels and only what the issue really holds", () => {
    const { container } = render(<IssuePreview provider="github" labels={["bug", "bugberry"]} />)
    expect(screen.getByText("How a report shows up in GitHub")).toBeTruthy()
    expect(container.textContent).toContain("bugberry")
    expect(container.textContent).toContain("Open the report in BugBerry")
  })

  test("a row shows how many projects use it and where messages fail", () => {
    const actions = { onTest: mock(), onEdit: mock(), onDelete: mock() }
    render(
      <ul>
        <ConnectionRow connection={slack} testResult={null} testing={false} removing={false} {...actions} />
      </ul>,
    )
    expect(screen.getByText("Slack #qa · used in 2 projects (Checkout Web, Admin Panel)")).toBeTruthy()
    expect(screen.getByText("Failing")).toBeTruthy()
    expect(screen.getByText("Last message failed in 2 projects: Slack rejected the message (HTTP 404)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete Slack #qa" }))
    expect(actions.onTest).toHaveBeenCalled()
    expect(actions.onDelete).toHaveBeenCalled()
  })

  test("usage names the projects", () => {
    expect(usageText({ ...slack, usedIn: 0, usedBy: [] })).toBe("not used yet")
    expect(usageText({ ...slack, usedIn: 1, usedBy: [{ projectId: "p1", projectName: "Quinella AI" }] })).toBe("used in 1 project (Quinella AI)")
  })

  test("deleting asks with the names of the projects that use it", () => {
    expect(deleteDescription(slack)).toBe("Used in 2 projects: Checkout Web, Admin Panel. They will stop sending to Slack #qa.")
    expect(deleteDescription({ ...slack, usedIn: 0, usedBy: [] })).toBe("Not used in any project.")
  })
})
