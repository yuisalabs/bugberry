import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { GITHUB_TOKEN_URL, IntegrationForm, IssuePreview } from "../src/components/IntegrationForm"
import type { Integration } from "../src/lib/api"
import { validateIntegration } from "../src/lib/integrations"
import { IntegrationRow, IntegrationsEmpty } from "../src/pages/settings/IntegrationsPage"

const empty = { owner: "", repo: "", labels: "", baseUrl: "", projectId: "", taskListId: "" }
const existing: Integration = {
  id: "i1",
  projectId: "p1",
  provider: "github",
  config: { owner: "kantor", repo: "web", labels: ["bug"] },
  autoSend: false,
  label: "kantor/web",
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
