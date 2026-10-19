export interface ShutdownTarget {
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown
}

/**
 * Stops cleanly on SIGTERM/SIGINT. `docker stop` sends SIGTERM and kills the process 10 seconds later,
 * so in-flight requests get to finish and the database connection is closed instead of cut.
 */
export function installShutdown(
  target: ShutdownTarget,
  stop: () => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
  log: Pick<Console, "info" | "error"> = console,
): void {
  let stopping = false
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    target.once(signal, () => {
      if (stopping) return
      stopping = true
      log.info(`${signal}: shutting down`)
      stop().then(
        () => exit(0),
        (error) => {
          log.error("shutdown failed", error)
          exit(1)
        },
      )
    })
  }
}
