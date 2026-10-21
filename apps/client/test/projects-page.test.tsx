import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProjectForm, UrlPatternsForm } from "../src/components/projects/ProjectDialogs"
import { cleanPatterns, patternExamples, savePatternsLabel, testUrl } from "../src/lib/url-patterns"
import { integrationsText, ProjectCardView } from "../src/pages/settings/ProjectsSettingsPage"

const project = { id: "p1", workspaceId: "w1", name: "Quinella AI", slug: "quinella-ai", urlPatterns: [] as string[], createdAt: new Date("2026-10-01T00:00:00Z") }

describe("URL pattern helpers", () => {
  test("only real, distinct patterns are saved", () => {
    expect(cleanPatterns([" app.quinella.ai/* ", "", "app.quinella.ai/*", "staging.quinella.ai/*"])).toEqual([
      "app.quinella.ai/*",
      "staging.quinella.ai/*",
    ])
    expect(savePatternsLabel(2)).toBe("Save 2 patterns")
    expect(savePatternsLabel(1)).toBe("Save 1 pattern")
    expect(savePatternsLabel(0)).toBe("Save")
  })

  test("examples use the project's own domain", () => {
    expect(patternExamples(["app.quinella.ai/*"]).map((example) => example.pattern)).toEqual([
      "quinella.ai/*",
      "*.quinella.ai/*",
      "app.quinella.ai/checkout*",
    ])
    expect(patternExamples(["https://*.kantor.com/*"])[0]?.pattern).toBe("kantor.com/*")
    expect(patternExamples([""])[0]?.pattern).toBe("example.com/*")
  })

  test("a URL to try: matched, not matched, not a URL, or nothing yet", () => {
    const patterns = ["app.quinella.ai/*", "staging.quinella.ai/*"]
    expect(testUrl(patterns, "https://app.quinella.ai/checkout?step=2")).toEqual({ status: "match", pattern: "app.quinella.ai/*" })
    // Typed without a scheme, it reads as https.
    expect(testUrl(patterns, "staging.quinella.ai/login")).toEqual({ status: "match", pattern: "staging.quinella.ai/*" })
    expect(testUrl(patterns, "https://quinella.ai/")).toEqual({ status: "none" })
    expect(testUrl(patterns, "https://exa mple")).toEqual({ status: "invalid" })
    expect(testUrl(patterns, "  ")).toEqual({ status: "empty" })
  })
})

describe("UrlPatternsForm", () => {
  test("edits the list, tries a URL, and saves what is left", () => {
    const onSave = mock()
    render(
      <UrlPatternsForm projectName="Quinella AI" patterns={["app.quinella.ai/*"]} saving={false} error={null} onSave={onSave} onCancel={mock()} />,
    )
    expect(screen.getByText("Bugs recorded on a matching page go straight to Quinella AI.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Add another pattern" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Pattern 2" }), { target: { value: "staging.quinella.ai/*" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Test a URL" }), { target: { value: "https://staging.quinella.ai/cart" } })
    expect(screen.getByRole("status").textContent).toBe("Matchesstaging.quinella.ai/*")

    fireEvent.click(screen.getByRole("button", { name: "Save 2 patterns" }))
    expect(onSave).toHaveBeenCalledWith(["app.quinella.ai/*", "staging.quinella.ai/*"])

    fireEvent.click(screen.getByRole("button", { name: "Remove pattern 1" }))
    expect((screen.getByRole("textbox", { name: "Pattern 1" }) as HTMLInputElement).value).toBe("staging.quinella.ai/*")
    expect(screen.getByRole("button", { name: "Save 1 pattern" })).toBeTruthy()
  })

  test("says when no pattern catches the URL", () => {
    render(<UrlPatternsForm projectName="Quinella AI" patterns={[]} saving={false} error={null} onSave={mock()} onCancel={mock()} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Test a URL" }), { target: { value: "https://quinella.ai/" } })
    expect(screen.getByRole("status").textContent).toBe("No pattern matches this URL")
  })
})

describe("ProjectCardView", () => {
  const card = (urlPatterns: string[], integrationCount: number | null = 0) => {
    const actions = { onEditPatterns: mock(), onEdit: mock(), onDelete: mock() }
    render(
      <ul>
        <ProjectCardView
          project={{ ...project, urlPatterns }}
          integrationCount={integrationCount}
          integrationsLink={<a href="/integrations">Integrations</a>}
          {...actions}
        />
      </ul>,
    )
    return actions
  }

  test("a project without patterns offers to add one", () => {
    const actions = card([])
    expect(screen.getByRole("heading", { name: "Quinella AI" })).toBeTruthy()
    expect(screen.getByText("/app/p/quinella-ai")).toBeTruthy()
    expect(screen.getByText("No URL patterns yet")).toBeTruthy()
    expect(screen.getByText("No integrations connected")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add pattern" }))
    expect(actions.onEditPatterns).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Edit Quinella AI" }))
    expect(actions.onEdit).toHaveBeenCalled()
  })

  test("a project with patterns lists them", () => {
    card(["app.quinella.ai/*", "staging.quinella.ai/*"], 2)
    expect(screen.getByText("app.quinella.ai/*")).toBeTruthy()
    expect(screen.getByText("staging.quinella.ai/*")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit patterns" })).toBeTruthy()
    expect(screen.getByText("2 integrations connected")).toBeTruthy()
  })

  test("integration counts read naturally", () => {
    expect(integrationsText(null)).toBe("")
    expect(integrationsText(0)).toBe("No integrations connected")
    expect(integrationsText(1)).toBe("1 integration connected")
  })
})

describe("ProjectForm", () => {
  test("a new project's slug follows its name until it is edited", () => {
    const onSave = mock()
    render(<ProjectForm saving={false} error={null} onSave={onSave} onCancel={mock()} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Checkout Web" } })
    expect((screen.getByRole("textbox", { name: "Slug" }) as HTMLInputElement).value).toBe("checkout-web")
    fireEvent.click(screen.getByRole("button", { name: "Create project" }))
    expect(onSave).toHaveBeenCalledWith({ name: "Checkout Web", slug: "checkout-web" })
  })
})
