/** The Getting started checklist: five steps everyone does first, then bonus missions. */
export const ONBOARDING_STEPS = ["extension", "screenshot", "video", "devtools", "shared"] as const
export const ONBOARDING_MISSIONS = ["invite", "project", "comment", "tracker", "send", "agent"] as const
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]
export type OnboardingMissionId = (typeof ONBOARDING_MISSIONS)[number]
export type OnboardingItemId = OnboardingStepId | OnboardingMissionId

/** What the dashboard reports itself: things no table records. */
export const ONBOARDING_EVENTS = ["extension", "devtools", "shared", "celebrated"] as const
export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[number]
