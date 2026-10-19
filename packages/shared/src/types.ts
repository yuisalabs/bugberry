export interface DeviceInfo {
  browser: string
  os: string
  viewport: string
}

export interface DebuggerSummary {
  logs: number
  errors: number
  requests: number
  failedRequests: number
  actions: number
  /** Names of capture hooks that could not be installed on the page (e.g. "fetch"). */
  incomplete: string[]
}
