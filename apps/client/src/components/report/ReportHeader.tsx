import { RiLayoutGridLine } from "@remixicon/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { backTarget } from "../../lib/report-page"
import { BugBerryLogo } from "../BugBerryLogo"

/** The report page's top row: back to the reports on the left, sharing and the ⋯ menu on the right. */
export function ReportHeader({
  back,
  children,
}: {
  /** Where "All reports" leads; the share page, opened by people outside the workspace, has none. */
  back: ReturnType<typeof backTarget> | null
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
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
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
