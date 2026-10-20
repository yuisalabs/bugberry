import { RiLayoutGridLine } from "@remixicon/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { backTarget } from "../../lib/report-page"
import { BugBerryLogo } from "../BugBerryLogo"

/** The report page's top row: back to the reports and the bell on the left, sharing and the ⋯ menu on the right. */
export function ReportHeader({
  back,
  leading,
  children,
}: {
  /** Where "All reports" leads; the share page, opened by people outside the workspace, has none. */
  back: ReturnType<typeof backTarget> | null
  /** Shown right after "All reports" (or the logo), such as the notification bell. */
  leading?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        {back ? (
          <Link
            {...back}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RiLayoutGridLine aria-hidden className="size-4" />
            All reports
          </Link>
        ) : (
          <BugBerryLogo />
        )}
        {leading}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
