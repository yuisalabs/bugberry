import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProjectForm, UrlPatternsForm } from "../src/features/projects/ProjectDialogs"
import { formatAgo } from "../src/lib/format"
import { cleanPatterns, patternExamples, patternForPage, savePatternsLabel, testProjects, testUrl } from "../src/features/projects/url-patterns"
import { integrationsText, ProjectCardView } from "../src/features/projects/ProjectCard"
import { TestUrlCard } from "../src/features/projects/TestUrlCard"
import { pageMeta, UnmatchedPagesCard } from "../src/features/projects/UnmatchedPagesCard"

const project = { id: "p1", workspaceId: "w1", name: "Quinella AI", slug: "quinella-ai", urlPatterns: [] as string[], logoUrl: null, createdAt: new Date("2026-10-01T00:00:00Z") }

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

  test("its reports, open ones and the newest; dashes while they load", () => {
    const now = new Date("2026-10-23T12:00:00Z").getTime()
    render(
      <ul>
        <ProjectCardView
          project={project}
          stats={{ reports: 18, open: 7, lastReportAt: new Date(now - 2 * 60_000) }}
          now={now}
          integrationCount={1}
          integrationsLink={null}
          onEditPatterns={mock()}
          onEdit={mock()}
          onDelete={mock()}
        />
      </ul>,
    )
    expect(screen.getByText("18")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
    expect(screen.getByText("2m ago")).toBeTruthy()
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
    expect(onSave).toHaveBeenCalledWith({ name: "Checkout Web", slug: "checkout-web", logo: null, removeLogo: false })
  })
})

describe("Test a URL and pages without a project", () => {
  const shop = { ...project, id: "shop", name: "Quinella AI", urlPatterns: ["*.yuisalabs.com/*", "app.quinella.ai/*"] }
  const docs = { ...project, id: "docs", name: "Test nama project", slug: "test", urlPatterns: ["app.quinella.ai/checkout*"] }

  test("the most specific pattern of any project decides", () => {
    expect(testProjects([shop, docs], "https://app.quinella.ai/checkout?step=pay")).toMatchObject({
      status: "match",
      project: { id: "docs" },
      pattern: "app.quinella.ai/checkout*",
    })
    expect(testProjects([shop, docs], "docs.yuisalabs.com/start")).toMatchObject({ status: "match", project: { id: "shop" } })
    expect(testProjects([shop, docs], "https://quinella.ai/")).toEqual({ status: "none" })
    expect(testProjects([shop, docs], "  ")).toEqual({ status: "empty" })
  })

  test("the card says which project a pasted URL goes to", () => {
    render(<TestUrlCard projects={[shop]} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Page address" }), { target: { value: "https://app.quinella.ai/checkout" } })
    expect(screen.getByRole("status").textContent).toBe("MatchesQQuinella AIvia app.quinella.ai/*")
  })

  test("a page's pattern covers it and what is under it", () => {
    expect(patternForPage("staging.quinella.ai/checkout")).toBe("staging.quinella.ai/checkout*")
    expect(patternForPage("localhost:3000")).toBe("localhost:3000/*")
  })

  test("short times for tight places", () => {
    const now = new Date("2026-10-23T12:00:00Z").getTime()
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3h ago")
    expect(formatAgo(now - 30 * 3_600_000, now)).toBe("yesterday")
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("3d ago")
    expect(pageMeta({ reports: 4, lastReportAt: new Date(now - 3 * 3_600_000) }, now)).toBe("4 reports · last 3h ago")
  })

  test("each page suggests a project and adds the page's pattern to it", () => {
    const onAdd = mock()
    const now = new Date("2026-10-23T12:00:00Z").getTime()
    render(
      <UnmatchedPagesCard
        pages={[{ page: "staging.quinella.ai/checkout", reports: 4, lastReportAt: new Date(now - 3 * 3_600_000), suggestedProjectId: "shop" }]}
        projects={[shop, docs]}
        now={now}
        onAdd={onAdd}
      />,
    )
    expect(screen.getByRole("heading", { name: /Pages without a project/ })).toBeTruthy()
    expect(screen.getByText("4 reports · last 3h ago")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add pattern for staging.quinella.ai/checkout" }))
    expect(onAdd).toHaveBeenCalledWith(shop, "staging.quinella.ai/checkout*")
  })

  test("with every page covered the card is gone", () => {
    const { container } = render(<UnmatchedPagesCard pages={[]} projects={[shop]} now={0} onAdd={mock()} />)
    expect(container.textContent).toBe("")
  })
})
