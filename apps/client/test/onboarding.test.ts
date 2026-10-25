import { describe, expect, test } from "bun:test"
import { ONBOARDING_MISSIONS, ONBOARDING_STEPS } from "@bugberry/shared"
import type { OnboardingProgress } from "../src/lib/api"
import { doneCount, nextStep, ONBOARDING_COPY } from "../src/lib/onboarding"

const progress = (done: boolean[]): OnboardingProgress => ({
  phase: "required",
  steps: ONBOARDING_STEPS.map((id, index) => ({ id, done: done[index] ?? false })),
  collapsed: false,
  reportTarget: null,
  trackerTarget: null,
})

describe("onboarding", () => {
  test("nextStep is the first undone step", () => {
    expect(nextStep(progress([true, false, true, false, false]))).toBe("screenshot")
    expect(nextStep(progress([true, true, true, true, true]))).toBeNull()
  })

  test("doneCount counts done steps", () => {
    expect(doneCount(progress([true, false, true, false, false]))).toEqual({ done: 2, total: 5 })
  })

  test("every item has copy", () => {
    for (const id of [...ONBOARDING_STEPS, ...ONBOARDING_MISSIONS]) expect(ONBOARDING_COPY[id].title.length).toBeGreaterThan(0)
  })
})
