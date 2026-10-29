import type { OnboardingEvent } from "@bugberry/shared"
import { queryOptions } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

/** The Getting started checklist in this workspace; null when there is none to show. */
export const onboarding = async (workspaceId: string) => (await unwrap(eden.api.me.onboarding.get({ query: { workspaceId } }))).progress
export const recordOnboarding = (change: { event: OnboardingEvent } | { collapsed: boolean }) =>
  unwrap(eden.api.me.onboarding.post(change))

export type OnboardingProgress = NonNullable<Awaited<ReturnType<typeof onboarding>>>

export const onboardingQueries = {
  /** Refreshed when the tab is back in front: a capture sent from the extension ticks its step. */
  onboarding: (workspaceId: string) =>
    queryOptions({ queryKey: qk.onboarding.of(workspaceId), queryFn: () => onboarding(workspaceId), refetchOnWindowFocus: true }),
}
