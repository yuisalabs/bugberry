import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type OnboardingContext, OnboardingTestProvider } from "../src/components/onboarding/OnboardingProvider"
import { CopyLinkButton } from "../src/components/report/CopyLinkButton"
import { reportFixture } from "./fixtures"

function renderCopy(onboarding: OnboardingContext) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mock(() => Promise.resolve()) }, configurable: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(["me"], { id: "someone-else" })
  client.setQueryData(["workspaces"], [])
  render(
    <QueryClientProvider client={client}>
      <OnboardingTestProvider value={onboarding}>
        <CopyLinkButton report={reportFixture()} />
      </OnboardingTestProvider>
    </QueryClientProvider>,
  )
}

describe("Copy link during onboarding", () => {
  test("copying counts even before sharing is next", async () => {
    const record = mock()
    renderCopy({
      progress: { phase: "required", steps: [{ id: "devtools", done: false }, { id: "shared", done: false }], collapsed: false, reportTarget: null, trackerTarget: null },
      next: "devtools",
      record,
      setCollapsed: mock(),
    })
    const button = screen.getByRole("button", { name: "Copy link" })
    expect(button.hasAttribute("data-onboarding-pulse")).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(record).toHaveBeenCalledWith("shared"))
  })

  test("Copy link pulses while sharing is next, and copying counts", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: mock(() => Promise.resolve()) }, configurable: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(["me"], { id: "someone-else" })
    client.setQueryData(["workspaces"], [])
    const record = mock()
    const onboarding: OnboardingContext = {
      progress: { phase: "required", steps: [{ id: "shared", done: false }], collapsed: false, reportTarget: null, trackerTarget: null },
      next: "shared",
      record,
      setCollapsed: mock(),
    }
    render(
      <QueryClientProvider client={client}>
        <OnboardingTestProvider value={onboarding}>
          <CopyLinkButton report={reportFixture()} />
        </OnboardingTestProvider>
      </QueryClientProvider>,
    )
    const button = screen.getByRole("button", { name: "Copy link" })
    expect(button.hasAttribute("data-onboarding-pulse")).toBe(true)
    fireEvent.click(button)
    await waitFor(() => expect(record).toHaveBeenCalledWith("shared"))
  })
})
