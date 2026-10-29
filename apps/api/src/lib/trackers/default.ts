import type { AppDeps } from "../../deps"
import { createHostGuard } from "../net/host-guard"
import { createTrackerFactory, DEFAULT_TIMEOUT_MS, type TrackerFactory } from "./providers"

/** The app's tracker factory: the one a test gave, or the real one behind the private-network guard. */
export function trackerFactoryFor(deps: Pick<AppDeps, "trackers" | "config">): TrackerFactory {
  return (
    deps.trackers ??
    createTrackerFactory(fetch, DEFAULT_TIMEOUT_MS, createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts }))
  )
}
