import type { AppDeps } from "../../deps"

/**
 * Starts the work that follows a finished upload (auto-send, notifications) without holding up the answer. The work
 * starts here, whether or not a `background` hook is set: the hook only lets tests wait for it.
 */
export function afterFinalize(deps: Pick<AppDeps, "background">, reportId: string, work: () => Promise<void>): void {
  const task = work().catch((error) => console.error("after finalize failed", { reportId, error }))
  deps.background?.(task)
}
