import { describe, expect, mock, test } from "bun:test"
import { ONBOARDING_STEPS } from "@bugberry/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { OnboardingProvider, useOnboarding } from "../src/components/onboarding/OnboardingProvider"
import type { OnboardingProgress } from "../src/lib/api"

const PROGRESS: OnboardingProgress = {
  phase: "required",
  steps: ONBOARDING_STEPS.map((id) => ({ id, done: id === "extension" })),
  collapsed: false,
  reportTarget: null,
  trackerTarget: null,
}

function Probe() {
  const onboarding = useOnboarding()
  if (!onboarding) return <p>no checklist</p>
  return (
    <>
      <p>{onboarding.progress.collapsed ? "collapsed" : "open"}</p>
      <button type="button" onClick={() => onboarding.setCollapsed(true)}>
        Collapse
      </button>
    </>
  )
}

function setup(load: (workspaceId: string) => Promise<OnboardingProgress | null>, send: () => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(["me"], { id: "me", lastWorkspaceId: "w1" })
  client.setQueryData(["workspaces"], [
    { id: "w1", name: "One", role: "admin" },
    { id: "w2", name: "Two", role: "member" },
  ])
  render(
    <QueryClientProvider client={client}>
      <OnboardingProvider load={load} send={send}>
        <Probe />
      </OnboardingProvider>
    </QueryClientProvider>,
  )
  return client
}

describe("OnboardingProvider", () => {
  test("a collapse that fails is undone", async () => {
    let fail: (error: Error) => void = () => {}
    setup(
      async () => PROGRESS,
      () => new Promise((_, reject) => (fail = reject)),
    )
    await screen.findByText("open")
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    await screen.findByText("collapsed")
    act(() => fail(new Error("offline")))
    await screen.findByText("open")
  })

  test("the checklist stays while another workspace's progress loads", async () => {
    const load = mock((workspaceId: string) => (workspaceId === "w1" ? Promise.resolve(PROGRESS) : new Promise<never>(() => {})))
    const client = setup(load, async () => ({ ok: true }))
    await screen.findByText("open")
    act(() => client.setQueryData(["me"], { id: "me", lastWorkspaceId: "w2" }))
    await waitFor(() => expect(load).toHaveBeenCalledWith("w2"))
    expect(screen.queryByText("no checklist")).toBeNull()
  })
})
