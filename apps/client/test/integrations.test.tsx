import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { GITHUB_TOKEN_URL, IntegrationForm, IssuePreview } from "../src/components/IntegrationForm"
import type { Integration } from "../src/lib/api"
import { EMPTY_FIELDS, validateIntegration } from "../src/lib/integrations"
import { IntegrationRow, IntegrationsEmpty } from "../src/pages/settings/IntegrationsPage"

const empty = EMPTY_FIELDS
const existing: Integration = {
  id: "i1",
  projectId: "p1",
  provider: "github",
  kind: "tracker",
  config: { owner: "kantor", repo: "web", labels: ["bug"] },
  autoSend: false,
  label: "kantor/web",
  lastError: null,
  lastDeliveredAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe("validateIntegration", () => {
  test("builds a GitHub config with clean, unique labels", () => {
    expect(validateIntegration("github", { ...empty, owner: " kantor ", repo: "web", labels: "bug, bugberry, bug," })).toEqual({
      ok: true,
      config: { owner: "kantor", repo: "web", labels: ["bug", "bugberry"] },
    })
    expect(validateIntegration("github", { ...empty, owner: "kan tor", repo: "web" })).toMatchObject({ ok: false })
  })

  test("requires https and whole numbers for ActiveCollab", () => {
    const fields = { ...empty, baseUrl: "https://ac.kantor.test/", projectId: "12", taskListId: "3" }
    expect(validateIntegration("activecollab", fields)).toEqual({
      ok: true,
      config: { baseUrl: "https://ac.kantor.test", projectId: 12, taskListId: 3 },
    })
    expect(validateIntegration("activecollab", { ...fields, baseUrl: "http://ac.kantor.test" })).toMatchObject({ ok: false })
    expect(validateIntegration("activecollab", { ...fields, projectId: "1.5" })).toMatchObject({ ok: false })
  })
})

describe("IntegrationForm", () => {
  test("creates a GitHub integration with labels, its token and auto-send", () => {
    const onSubmit = mock()
    render(<IntegrationForm projectName="Quinella AI" busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByText("Send reports from Quinella AI to your tracker as new issues.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "kantor" } })
    fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "web" } })
    // A comma finishes a label.
    fireEvent.change(screen.getByLabelText("Add label"), { target: { value: "bug, bugberry," } })
    fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "ghp_x" } })
    fireEvent.click(screen.getByRole("switch", { name: /Send every new report automatically/ }))
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "github",
      config: { owner: "kantor", repo: "web", labels: ["bug", "bugberry"] },
      secret: "ghp_x",
      autoSend: true,
    })
  })

  test("the token can be shown, and GitHub's token page is one click away", () => {
    render(<IntegrationForm busy={false} onSubmit={mock()} onCancel={() => {}} />)
    const token = screen.getByLabelText("Personal access token") as HTMLInputElement
    expect(token.type).toBe("password")
    fireEvent.click(screen.getByRole("button", { name: "Show token" }))
    expect(token.type).toBe("text")
    expect(screen.getByRole("link", { name: /Create one on GitHub/ }).getAttribute("href")).toBe(GITHUB_TOKEN_URL)
  })

  test("a new integration needs a token; invalid settings show a message", () => {
    const onSubmit = mock()
    render(<IntegrationForm busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole("radio", { name: "ActiveCollab" }))
    fireEvent.change(screen.getByLabelText("ActiveCollab address"), { target: { value: "http://ac.kantor.test" } })
    fireEvent.change(screen.getByLabelText("Project ID"), { target: { value: "12" } })
    fireEvent.change(screen.getByLabelText("Task list ID"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/https/)
  })

  test("a card on the empty page picks the provider", () => {
    render(<IntegrationForm initialProvider="activecollab" busy={false} onSubmit={mock()} onCancel={() => {}} />)
    expect((screen.getByRole("radio", { name: "ActiveCollab" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText("API token")).toBeTruthy()
  })

  test("editing keeps the provider and may leave the token empty", () => {
    const onSubmit = mock()
    render(<IntegrationForm integration={existing} busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect((screen.getByRole("radio", { name: "GitHub" }) as HTMLInputElement).disabled).toBe(true)
    expect(within(screen.getByRole("grid", { name: "Labels" })).getByText("bug")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "github",
      config: { owner: "kantor", repo: "web", labels: ["bug"] },
      secret: "",
      autoSend: false,
    })
  })
})

describe("IntegrationForm for every provider", () => {
  const renderForm = () => {
    const onSubmit = mock()
    render(<IntegrationForm busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    return onSubmit
  }
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
  const autoSendSwitch = () => screen.queryByRole("switch", { name: /Send every new report automatically/ })

  test("the picker groups issue trackers and notifications", () => {
    renderForm()
    expect(screen.getByText("Issue trackers")).toBeTruthy()
    expect(screen.getByText("Notifications")).toBeTruthy()
    for (const name of ["GitHub", "GitLab", "Linear", "Jira", "ActiveCollab", "Slack", "Discord", "Telegram", "Webhook"]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy()
    }
  })

  test("GitLab starts at gitlab.com and links to its token page", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "GitLab" }))
    expect((screen.getByLabelText("GitLab address") as HTMLInputElement).value).toBe("https://gitlab.com")
    expect(screen.getByRole("link", { name: /Create one on GitLab/ }).getAttribute("href")).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    )
    type("Project path", "kantor/web")
    type("Personal access token", "glpat-x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "gitlab",
      config: { baseUrl: "https://gitlab.com", projectPath: "kantor/web", labels: [] },
      secret: "glpat-x",
      autoSend: false,
    })
  })

  test("Linear asks for the team key and an API key", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Linear" }))
    expect(screen.getByRole("link", { name: /Create one on Linear/ }).getAttribute("href")).toBe("https://linear.app/settings/account/security")
    type("Team key", "eng")
    type("API key", "lin_api_x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "linear", config: { teamKey: "ENG", labels: [] }, secret: "lin_api_x", autoSend: false })
  })

  test("Jira asks for the site, the account email, the project key and the issue type", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Jira" }))
    expect((screen.getByLabelText("Issue type") as HTMLInputElement).value).toBe("Bug")
    type("Jira site", "https://kantor.atlassian.net")
    type("Atlassian account email", "dana@kantor.test")
    type("Project key", "BUG")
    type("API token", "atl_x")
    expect(autoSendSwitch()).toBeTruthy()
    save()
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "jira",
      config: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test", projectKey: "BUG", issueType: "Bug", labels: [] },
      secret: "atl_x",
      autoSend: false,
    })
  })

  test("Slack takes only its webhook URL and has no auto-send switch", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Slack" }))
    expect(autoSendSwitch()).toBeNull()
    type("Incoming Webhook URL", "https://kantor.test/not-slack")
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/Slack/)
    type("Incoming Webhook URL", "https://hooks.slack.com/services/T0/B0/x")
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "slack", config: {}, secret: "https://hooks.slack.com/services/T0/B0/x", autoSend: false })
  })

  test("Telegram asks for the chat id and the bot token", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Telegram" }))
    type("Chat ID", "-1001234")
    type("Bot token", "123:abc")
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "telegram", config: { chatId: "-1001234" }, secret: "123:abc", autoSend: false })
  })

  test("a webhook needs its URL, and the signing secret is optional", () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Webhook" }))
    expect(autoSendSwitch()).toBeNull()
    type("Webhook URL", "https://hooks.kantor.test/bugs")
    expect(screen.getByLabelText("Signing secret (optional)")).toBeTruthy()
    save()
    expect(onSubmit).toHaveBeenCalledWith({ provider: "webhook", config: { url: "https://hooks.kantor.test/bugs" }, secret: "", autoSend: false })
  })
})

describe("IssuePreview", () => {
  test("shows the labels a GitHub issue gets, and only what the issue really holds", () => {
    const { container } = render(<IssuePreview provider="github" labels={["bug", "bugberry"]} />)
    expect(screen.getByText("How a report shows up in GitHub")).toBeTruthy()
    expect(container.textContent).toContain("bugberry")
    expect(container.textContent).toContain("First errors")
    expect(container.textContent).toContain("Open the report in BugBerry")
  })
})

describe("Integrations page parts", () => {
  test("the empty page offers each tracker", () => {
    const onPick = mock()
    render(<IntegrationsEmpty onPick={onPick} />)
    expect(screen.getByRole("heading", { name: "No integrations yet" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /ActiveCollab/ }))
    expect(onPick).toHaveBeenCalledWith("activecollab")
  })

  test("the empty page offers trackers and notification channels in two groups", () => {
    const onPick = mock()
    render(<IntegrationsEmpty onPick={onPick} />)
    expect(screen.getByRole("heading", { name: "Issue trackers" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Slack/ }))
    expect(onPick).toHaveBeenCalledWith("slack")
  })

  const slack: Integration = {
    ...existing,
    id: "n1",
    provider: "slack",
    kind: "notifier",
    config: {},
    label: "Slack channel",
    lastError: "Slack rejected the message (HTTP 404)",
  }
  const rowActions = () => ({ onTest: mock(), onEdit: mock(), onDelete: mock() })

  test("a notification channel sends a test message and shows its last error", () => {
    const actions = rowActions()
    render(
      <ul>
        <IntegrationRow integration={slack} testResult={null} testing={false} removing={false} {...actions} />
      </ul>,
    )
    expect(screen.getByText(/Posts new reports/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull()
    expect(screen.getByText("Last message failed: Slack rejected the message (HTTP 404)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }))
    expect(actions.onTest).toHaveBeenCalled()
  })

  test("a channel that delivered says when its last message went out", () => {
    render(
      <ul>
        <IntegrationRow
          integration={{ ...slack, lastError: null, lastDeliveredAt: new Date() }}
          testResult={null}
          testing={false}
          removing={false}
          {...rowActions()}
        />
      </ul>,
    )
    expect(screen.getByText("Last message just now")).toBeTruthy()
  })

  test("a saved integration can be tested, edited and deleted", () => {
    const actions = { onTest: mock(), onEdit: mock(), onDelete: mock() }
    render(
      <ul>
        <IntegrationRow
          integration={{ ...existing, autoSend: true }}
          testResult={{ id: "i1", ok: false, message: "GitHub refused the token" }}
          testing={false}
          removing={false}
          {...actions}
        />
      </ul>,
    )
    expect(screen.getByText("kantor/web")).toBeTruthy()
    expect(screen.getByText("Sends every report")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("GitHub refused the token")
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit kantor/web" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete kantor/web" }))
    expect(actions.onTest).toHaveBeenCalled()
    expect(actions.onEdit).toHaveBeenCalled()
    expect(actions.onDelete).toHaveBeenCalled()
  })
})
