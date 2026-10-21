import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConnectionForm } from "../src/components/ConnectionForm"
import type { Connection } from "../src/lib/api"
import { ConnectionRow, ConnectionsEmpty, deleteDescription } from "../src/pages/settings/ConnectionsPage"

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
  test("the empty page offers trackers and notification channels in two groups", () => {
    const onPick = mock()
    render(<ConnectionsEmpty onPick={onPick} />)
    expect(screen.getByRole("heading", { name: "Issue trackers" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Slack/ }))
    expect(onPick).toHaveBeenCalledWith("slack")
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

  test("a row shows how many projects use it and where messages fail", () => {
    const actions = { onTest: mock(), onEdit: mock(), onDelete: mock() }
    render(
      <ul>
        <ConnectionRow connection={slack} testResult={null} testing={false} removing={false} {...actions} />
      </ul>,
    )
    expect(screen.getByText("Slack · used in 2 projects")).toBeTruthy()
    expect(screen.getByText("Last message failed in 2 projects: Slack rejected the message (HTTP 404)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete Slack #qa" }))
    expect(actions.onTest).toHaveBeenCalled()
    expect(actions.onDelete).toHaveBeenCalled()
  })

  test("deleting asks with the names of the projects that use it", () => {
    expect(deleteDescription(slack)).toBe("Used in 2 projects: Checkout Web, Admin Panel. They will stop sending to Slack #qa.")
    expect(deleteDescription({ ...slack, usedIn: 0, usedBy: [] })).toBe("Not used in any project.")
  })
})
