import type { OnboardingEvent, OnboardingItemId } from "@bugberry/shared"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react"
import { nextStep } from "./onboarding"
import { useCurrentWorkspace } from "../../lib/workspace"
import { useExtensionAnswer } from "./ExtensionCard"
import { onboarding, type OnboardingProgress, onboardingQueries, recordOnboarding } from "./queries"
import { qk } from "../../lib/query/keys"

export interface OnboardingContext {
  progress: OnboardingProgress
  next: OnboardingItemId | null
  record(event: OnboardingEvent): void
  setCollapsed(collapsed: boolean): void
}

const Context = createContext<OnboardingContext | null>(null)

/** The person's Getting started checklist; null without one (an older account, a finished one, or a share page). */
export function useOnboarding(): OnboardingContext | null {
  return useContext(Context)
}

/** A fixed checklist for component tests, without the API. */
export function OnboardingTestProvider({ value, children }: { value: OnboardingContext | null; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function OnboardingProvider({
  children,
  load = onboarding,
  send = recordOnboarding,
}: {
  children: ReactNode
  /** The API by default; tests pass their own. */
  load?: (workspaceId: string) => Promise<OnboardingProgress | null>
  send?: (change: { event: OnboardingEvent } | { collapsed: boolean }) => Promise<unknown>
}) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const query = useQuery({
    ...onboardingQueries.onboarding(workspaceId),
    queryFn: () => load(workspaceId),
    enabled: Boolean(workspace),
    // Switching workspace keeps the checklist on screen while the new one's progress loads.
    placeholderData: keepPreviousData,
  })
  const progress = query.data ?? null
  const key = qk.onboarding.of(workspaceId)

  const event = useMutation({
    mutationFn: (name: OnboardingEvent) => send({ event: name }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.onboarding.all }),
  })
  const collapse = useMutation({
    mutationFn: (collapsed: boolean) => send({ collapsed }),
    onMutate: (collapsed) => {
      const before = queryClient.getQueryData<OnboardingProgress | null>(key)
      queryClient.setQueryData(key, (old: OnboardingProgress | null | undefined) => (old ? { ...old, collapsed } : old))
      return { before }
    },
    // Not saved: back to what it was, then whatever the server says.
    onError: (_error, _collapsed, context) => queryClient.setQueryData(key, context?.before),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  })

  // The extension answering for this server is what "Install the extension" means; the server can't see it.
  const extension = useExtensionAnswer()
  const extensionActive = extension.installed && extension.active
  const extensionDone = progress?.steps.find((step) => step.id === "extension")?.done ?? true
  useEffect(() => {
    if (extensionActive && !extensionDone && !event.isPending) event.mutate("extension")
  }, [extensionActive, extensionDone])

  const value = useMemo<OnboardingContext | null>(
    () =>
      progress && {
        progress,
        next: nextStep(progress),
        record: (name) => event.mutate(name),
        setCollapsed: (collapsed) => collapse.mutate(collapsed),
      },
    [progress],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}
