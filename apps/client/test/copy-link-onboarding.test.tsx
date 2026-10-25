import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type OnboardingContext, OnboardingTestProvider } from "../src/components/onboarding/OnboardingProvider"
import { CopyLinkButton } from "../src/components/report/CopyLinkButton"
import { reportFixture } from "./fixtures"

describe("Copy link during onboarding", () => {
  test("Copy link pulses while sharing is next, and copying counts", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: mock(() => Promise.resolve()) }, configurable: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(["me"], { id: "someone-else" })
    client.setQueryData(["workspaces"], [])
    const record = mock()
    const onboarding: OnboardingContext = {
      progress: { phase: "required", steps: [], collapsed: false, reportTarget: null, trackerTarget: null },
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
