import type { OnboardingItemId } from "@bugberry/shared"
import type { OnboardingProgress } from "./queries"

export interface OnboardingCopy {
  title: string
  /** One line under the step to do next. */
  hint: string
  /** The label of its button. */
  action: string
}

export const ONBOARDING_COPY: Record<OnboardingItemId, OnboardingCopy> = {
  extension: { title: "Install the extension", hint: "BugBerry captures from your browser.", action: "Add to Chrome" },
  screenshot: {
    title: "Take your first screenshot",
    hint: "The quickest capture: one click, with console and network attached.",
    action: "Take a screenshot",
  },
  video: { title: "Record your first video", hint: "Video, console and network in one link.", action: "Start recording" },
  devtools: { title: "Look at DevTools in a report", hint: "Open the Console or Network tab next to the video.", action: "Open report" },
  shared: { title: "Share a report", hint: "Copy the link and send it to whoever fixes it.", action: "Open report" },
  invite: { title: "Invite a teammate", hint: "Bugs get fixed faster together.", action: "Invite" },
  project: { title: "Create a project", hint: "Group reports by app or site.", action: "Create project" },
  comment: { title: "Comment and @mention", hint: "Type @ to bring a teammate in.", action: "Open report" },
  tracker: { title: "Connect a tracker", hint: "GitHub, GitLab, Jira, Linear and more.", action: "Connect" },
  send: { title: "Send a report to a tracker", hint: "Turn a report into an issue in one click.", action: "Open report" },
  agent: { title: "Connect an AI agent", hint: "Let Claude, Cursor and others read your reports.", action: "Connect" },
}

/** The step to do next: the first one not done, whatever order the others were done in. */
export function nextStep(progress: OnboardingProgress): OnboardingItemId | null {
  return progress.steps.find((step) => !step.done)?.id ?? null
}

/** Whether the checklist still waits for this item: doing it ticks it, whichever step is next. */
export function isUndone(progress: OnboardingProgress, id: OnboardingItemId): boolean {
  return progress.steps.some((step) => step.id === id && !step.done)
}

export function doneCount(progress: OnboardingProgress): { done: number; total: number } {
  return { done: progress.steps.filter((step) => step.done).length, total: progress.steps.length }
}
