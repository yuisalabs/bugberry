import type { OnboardingEvent, OnboardingItemId } from "@bugberry/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react"
import type { OnboardingProgress } from "../../lib/api"
import { api } from "../../lib/client"
import { nextStep } from "../../lib/onboarding"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"
import { useExtensionAnswer } from "../ExtensionCard"

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

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const query = useQuery({ ...queries.onboarding(workspaceId), enabled: Boolean(workspace) })
  const progress = query.data ?? null
  const key = queries.onboarding(workspaceId).queryKey

  const event = useMutation({
    mutationFn: (name: OnboardingEvent) => api.recordOnboarding({ event: name }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  })
  const collapse = useMutation({
    mutationFn: (collapsed: boolean) => api.recordOnboarding({ collapsed }),
    onMutate: (collapsed) => queryClient.setQueryData(key, (old: OnboardingProgress | null | undefined) => (old ? { ...old, collapsed } : old)),
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
