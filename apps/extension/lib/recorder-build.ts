/** The build bundled with @bugberry/recorder (`bun run build:recorder`); the stores never get it. */
export function isRecorderBuild(env: Record<string, string | undefined>): boolean {
  return env.VITE_RECORDER_BUILD === "true"
}
