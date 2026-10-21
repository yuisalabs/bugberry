import { createContext } from "react"

/**
 * The report's video, for parts of the page outside the player: a "0:52" in a comment seeks it there. Null on a
 * screenshot report, and anywhere outside the report page.
 */
export const ReportVideoContext = createContext<{ seek(ms: number): void; durationMs: number } | null>(null)
