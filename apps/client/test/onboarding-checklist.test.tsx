import { describe, expect, mock, test } from "bun:test"
import { ONBOARDING_STEPS } from "@bugberry/shared"
import { fireEvent, render, screen } from "@testing-library/react"
import { OnboardingChecklistView } from "../src/components/onboarding/OnboardingChecklist"
import type { OnboardingProgress } from "../src/lib/api"

const required = (doneIds: string[], extra: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  phase: "required",
  steps: ONBOARDING_STEPS.map((id) => ({ id, done: doneIds.includes(id) })),
  collapsed: false,
  reportTarget: null,
  trackerTarget: null,
  ...extra,
})

const bonus = (collapsed = false): OnboardingProgress => ({
  phase: "bonus",
  steps: [
    { id: "invite", done: true },
    { id: "project", done: false },
    { id: "comment", done: false },
    { id: "tracker", done: false },
    { id: "send", done: false },
    { id: "agent", done: false },
  ],
  collapsed,
  reportTarget: null,
  trackerTarget: null,
})

const view = (progress: OnboardingProgress, handlers: { onCollapse?: () => void; onCelebrated?: () => void } = {}) =>
  render(
    <OnboardingChecklistView
      progress={progress}
      actions={{ video: <button type="button">Start recording</button> }}
      onCollapse={handlers.onCollapse ?? mock()}
      onCelebrated={handlers.onCelebrated ?? mock()}
    />,
  )

describe("OnboardingChecklistView", () => {
  test("shows progress and highlights the next step", () => {
    view(required(["extension", "screenshot"]))
    expect(screen.getByRole("region", { name: "Getting started" })).toBeTruthy()
    expect(screen.getByText("Get to know BugBerry")).toBeTruthy()
    expect(screen.getByText("2 of 5 done")).toBeTruthy()
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2")
    expect(screen.getByText("Video, console and network in one link.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy()
  })

  test("collapsing calls back, and collapsed it is a pill", () => {
    const onCollapse = mock()
    const { rerender } = view(required(["extension"]), { onCollapse })
    fireEvent.click(screen.getByRole("button", { name: "Hide checklist" }))
    expect(onCollapse).toHaveBeenCalledWith(true)
    rerender(
      <OnboardingChecklistView progress={required(["extension"], { collapsed: true })} actions={{}} onCollapse={onCollapse} onCelebrated={mock()} />,
    )
    expect(screen.getByRole("button", { name: "Getting started 1/5" })).toBeTruthy()
    expect(screen.queryByText("Record your first video")).toBeNull()
  })

  test("the collapsed bonus pill counts missions", () => {
    view(bonus(true))
    expect(screen.getByRole("button", { name: "Missions 1/6" })).toBeTruthy()
  })

  test("celebration", () => {
    const onCelebrated = mock()
    view(required([...ONBOARDING_STEPS], { phase: "celebrate" }), { onCelebrated })
    expect(screen.getByText("You're all set to catch bugs!")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "On to bonus missions" }))
    expect(onCelebrated).toHaveBeenCalled()
  })

  test("bonus phase title", () => {
    view(bonus())
    expect(screen.getByText("Bonus missions")).toBeTruthy()
    expect(screen.getByText("1 of 6 done")).toBeTruthy()
  })
})

describe("OnboardingWidget", () => {
  async function widget(props: { startAsPill?: boolean; aboveBottomBar?: boolean } = {}) {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
    const { OnboardingWidget } = await import("../src/components/onboarding/OnboardingChecklist")
    const { OnboardingTestProvider } = await import("../src/components/onboarding/OnboardingProvider")
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(["me"], { id: "me", lastWorkspaceId: null })
    client.setQueryData(["workspaces"], [])
    client.setQueryData(["client-config"], { extensionInstallUrl: null })
    const value = { progress: required(["extension"]), next: "screenshot" as const, record: mock(), setCollapsed: mock() }
    render(
      <QueryClientProvider client={client}>
        <OnboardingTestProvider value={value}>
          <OnboardingWidget {...props} />
        </OnboardingTestProvider>
      </QueryClientProvider>,
    )
    return screen.getByRole("region", { name: "Getting started" }).closest(".fixed")
  }

  test("it floats bottom left on every screen", async () => {
    const corner = await widget()
    expect(corner?.className).toContain("left-4")
    expect(corner?.className).not.toContain("right-4")
  })

  test("it opens on All reports", async () => {
    await widget()
    expect(screen.getByText("Take your first screenshot")).toBeTruthy()
  })

  test("elsewhere it starts as the pill", async () => {
    await widget({ startAsPill: true })
    expect(screen.getByRole("button", { name: "Getting started 1/5" })).toBeTruthy()
    expect(screen.queryByText("Take your first screenshot")).toBeNull()
  })

  test("on the report page it sits above the phone's Copy link bar", async () => {
    const corner = await widget({ startAsPill: true, aboveBottomBar: true })
    expect(corner?.className).toContain("bottom-20")
    expect(corner?.className).toContain("md:bottom-4")
  })
})
