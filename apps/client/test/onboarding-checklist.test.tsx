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

const view = (progress: OnboardingProgress, variant: "card" | "widget" = "card", handlers: { onCollapse?: () => void; onCelebrated?: () => void } = {}) =>
  render(
    <OnboardingChecklistView
      progress={progress}
      variant={variant}
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

  test("collapsing calls back, and the collapsed card is one row", () => {
    const onCollapse = mock()
    const { rerender } = view(required(["extension"]), "card", { onCollapse })
    fireEvent.click(screen.getByRole("button", { name: "Hide checklist" }))
    expect(onCollapse).toHaveBeenCalledWith(true)
    rerender(
      <OnboardingChecklistView progress={required(["extension"], { collapsed: true })} variant="card" actions={{}} onCollapse={onCollapse} onCelebrated={mock()} />,
    )
    expect(screen.getByRole("button", { name: "Show checklist" })).toBeTruthy()
    expect(screen.queryByText("Record your first video")).toBeNull()
  })

  test("the collapsed widget is a pill", () => {
    view(bonus(true), "widget")
    expect(screen.getByRole("button", { name: "Missions 1/6" })).toBeTruthy()
  })

  test("celebration", () => {
    const onCelebrated = mock()
    view(required([...ONBOARDING_STEPS], { phase: "celebrate" }), "card", { onCelebrated })
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
