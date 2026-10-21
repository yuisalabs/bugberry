import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { UseConnectionModal, UseConnectionSteps } from "../src/components/UseConnectionDialog"
import type { Connection, Integration, OptionList } from "../src/lib/api"
import { IntegrationRow } from "../src/pages/ProjectIntegrationsPage"

const status = { failing: 0, lastError: null, lastDeliveredAt: null }
const githubKantor: Connection = { id: "c-gh", provider: "github", kind: "tracker", name: "GitHub Kantor", usedIn: 1, status }
const jira: Connection = { id: "c-jira", provider: "jira", kind: "tracker", name: "Jira", usedIn: 0, status }
const slack: Connection = { id: "c-slack", provider: "slack", kind: "notifier", name: "Slack #qa", usedIn: 1, status }
const telegram: Connection = { id: "c-tg", provider: "telegram", kind: "notifier", name: "Telegram bot", usedIn: 0, status }

const slackUse: Integration = {
  id: "u-slack",
  projectId: "p1",
  provider: "slack",
  kind: "notifier",
  connection: { id: "c-slack", name: "Slack #qa" },
  target: {},
  label: "Slack #qa",
  autoSend: false,
  lastError: "Slack rejected the message (HTTP 404)",
  lastDeliveredAt: null,
  createdAt: new Date(),
}

const OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  "c-gh/targets/": [
    { value: "kantor/checkout", label: "kantor/checkout" },
    { value: "kantor/web", label: "kantor/web" },
  ],
  "c-gh/labels/kantor/checkout": [
    { value: "bug", label: "bug" },
    { value: "frontend", label: "frontend" },
  ],
  "c-gh/labels/kantor/web": Array.from({ length: 11 }, (_, index) => ({ value: `label-${index}`, label: `label-${index}` })),
  "c-jira/targets/": [
    { value: "BUG", label: "Bugs (BUG)" },
    { value: "OPS", label: "Operations (OPS)" },
  ],
  "c-jira/issueTypes/BUG": [
    { value: "Bug", label: "Bug" },
    { value: "Task", label: "Task" },
  ],
  "c-jira/labels/": [],
}

function steps(options: { used?: Integration[]; failing?: boolean } = {}) {
  const onSubmit = mock()
  const loadOptions = mock(async (connectionId: string, list: OptionList, _q: string, parent: string) => {
    if (options.failing) throw new Error("The GitHub token is invalid or has expired")
    // Operations' issue types are still loading for as long as the test looks.
    if (connectionId === "c-jira" && list === "issueTypes" && parent === "OPS") return new Promise<Array<{ value: string; label: string }>>(() => {})
    return OPTIONS[`${connectionId}/${list}/${parent}`] ?? []
  })
  render(
    <UseConnectionSteps
      connections={[githubKantor, jira, slack, telegram]}
      used={options.used ?? []}
      loadOptions={loadOptions}
      busy={false}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  )
  return { onSubmit, loadOptions }
}

const choose = (name: string) => {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(name) }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
}

describe("Use a connection", () => {
  test("a repository and its labels are picked from the account's lists", async () => {
    const { onSubmit } = steps()
    choose("GitHub Kantor")
    fireEvent.click(await screen.findByRole("radio", { name: "kantor/checkout" }))
    fireEvent.click(await screen.findByRole("checkbox", { name: "bug" }))
    fireEvent.click(screen.getByRole("button", { name: "Use GitHub Kantor" }))
    expect(onSubmit).toHaveBeenCalledWith({
      connectionId: "c-gh",
      target: { owner: "kantor", repo: "checkout", labels: ["bug"] },
      autoSend: false,
    })
  })

  test("Jira asks for the issue type after the project", async () => {
    const { onSubmit } = steps()
    choose("Jira")
    fireEvent.click(await screen.findByRole("radio", { name: "Bugs (BUG)" }))
    fireEvent.click(await screen.findByRole("radio", { name: "Task" }))
    fireEvent.click(screen.getByRole("button", { name: "Use Jira" }))
    expect(onSubmit).toHaveBeenCalledWith({
      connectionId: "c-jira",
      target: { projectKey: "BUG", issueType: "Task", labels: [] },
      autoSend: false,
    })
  })

  test("at most 10 labels can be ticked", async () => {
    steps()
    choose("GitHub Kantor")
    fireEvent.click(await screen.findByRole("radio", { name: "kantor/web" }))
    for (let index = 0; index < 10; index++) fireEvent.click(await screen.findByRole("checkbox", { name: `label-${index}` }))
    expect((screen.getByRole("checkbox", { name: "label-10" }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("Up to 10 labels")).toBeTruthy()
  })

  test("another Jira project never shows the first project's issue types", async () => {
    steps()
    choose("Jira")
    fireEvent.click(await screen.findByRole("radio", { name: "Bugs (BUG)" }))
    expect(await screen.findByRole("radio", { name: "Task" })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Operations (OPS)" }))
    expect(screen.queryByRole("radio", { name: "Task" })).toBeNull()
  })

  test("a channel already used in this project cannot be picked again", () => {
    steps({ used: [slackUse] })
    const radio = screen.getByRole("radio", { name: /Slack #qa/ }) as HTMLInputElement
    expect(radio.disabled).toBe(true)
    expect(screen.getByText("Already used in this project")).toBeTruthy()
  })

  test("Slack needs nothing more", () => {
    const { onSubmit } = steps()
    choose("Slack #qa")
    fireEvent.click(screen.getByRole("button", { name: "Use Slack #qa" }))
    expect(onSubmit).toHaveBeenCalledWith({ connectionId: "c-slack", target: {}, autoSend: false })
  })

  test("Telegram asks for the chat id", () => {
    const { onSubmit } = steps()
    choose("Telegram bot")
    fireEvent.change(screen.getByLabelText("Chat ID"), { target: { value: "kantor" } })
    fireEvent.click(screen.getByRole("button", { name: "Use Telegram bot" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/chat id/i)
    fireEvent.change(screen.getByLabelText("Chat ID"), { target: { value: "-1001234" } })
    fireEvent.click(screen.getByRole("button", { name: "Use Telegram bot" }))
    expect(onSubmit).toHaveBeenCalledWith({ connectionId: "c-tg", target: { chatId: "-1001234" }, autoSend: false })
  })

  test("a list the provider refuses shows its reason", async () => {
    steps({ failing: true })
    choose("GitHub Kantor")
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The GitHub token is invalid or has expired"))
  })
})

describe("the Use a connection dialog", () => {
  test("cancelling closes through onClose, which also clears the last error", () => {
    const onClose = mock()
    render(
      <UseConnectionModal
        isOpen
        error="This project already uses that connection for that target"
        connections={[slack]}
        used={[]}
        loadOptions={async () => []}
        busy={false}
        onSubmit={() => {}}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole("alert").textContent).toBe("This project already uses that connection for that target")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe("a project's integration row", () => {
  test("a notification channel sends a test message and shows its last error", () => {
    const actions = { onTest: mock(), onEdit: mock(), onRemove: mock() }
    render(
      <ul>
        <IntegrationRow integration={slackUse} testResult={null} testing={false} removing={false} {...actions} />
      </ul>,
    )
    expect(screen.getByText(/Posts new reports/)).toBeTruthy()
    expect(screen.getByText("Last message failed: Slack rejected the message (HTTP 404)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Slack #qa" }))
    expect(actions.onTest).toHaveBeenCalled()
    expect(actions.onRemove).toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull()
  })
})
