/** What only the agent recorder's build may carry: its automation page, and the stop that skips the review. */
const AUTOMATION_PAGE = /(^|\/)automation\.html$/
const AUTOMATION_STOP = "bugberry:automation-stop"

/** The files of a store build that hold the recorder's automation path; empty for a clean build. */
export function storeBuildLeaks(files: Array<{ path: string; text: string }>): string[] {
  return files.filter((file) => AUTOMATION_PAGE.test(file.path) || file.text.includes(AUTOMATION_STOP)).map((file) => file.path)
}
