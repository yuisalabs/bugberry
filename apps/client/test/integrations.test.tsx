import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { IntegrationForm } from "../src/components/IntegrationForm"
import type { Integration } from "../src/lib/api"
import { validateIntegration } from "../src/lib/integrations"
import { choose } from "./fields"

const empty = { owner: "", repo: "", labels: "", baseUrl: "", projectId: "", taskListId: "" }

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
  test("creates a GitHub integration with its token and auto-send choice", () => {
    const onSubmit = mock()
    render(<IntegrationForm busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "kantor" } })
    fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "web" } })
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "ghp_x" } })
    fireEvent.click(screen.getByLabelText("Send every new report automatically"))
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "github",
      config: { owner: "kantor", repo: "web", labels: [] },
      secret: "ghp_x",
      autoSend: true,
    })
  })

  test("a new integration needs a token; invalid settings show a message", () => {
    const onSubmit = mock()
    render(<IntegrationForm busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    choose("Provider", "ActiveCollab")
    fireEvent.change(screen.getByLabelText("ActiveCollab address"), { target: { value: "http://ac.kantor.test" } })
    fireEvent.change(screen.getByLabelText("Project ID"), { target: { value: "12" } })
    fireEvent.change(screen.getByLabelText("Task list ID"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/https/)
  })

  test("editing keeps the provider and may leave the token empty", () => {
    const onSubmit = mock()
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
    render(<IntegrationForm integration={existing} busy={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect((screen.getByLabelText("Provider") as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("bug")
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "github",
      config: { owner: "kantor", repo: "web", labels: ["bug"] },
      secret: "",
      autoSend: false,
    })
  })
})
