import { RiArrowLeftLine, RiLayoutGridLine } from "@remixicon/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { backLink } from "./report-page"
import { BugBerryLogo } from "../../../components/layout/BugBerryLogo"
import { ProjectTile } from "../../projects/ProjectTile"

const navLink = "flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"

/**
 * The report page's top row. From tablet width up: back to the reports and the bell on the left, sharing and
 * the ⋯ menu on the right. On phones the bell joins the right side, beside ⋯.
 */
export function ReportHeader({
  back,
  leading,
  children,
}: {
  /** Where the back link leads and what it says ("All reports" or the project's name); the share page has none. */
  back: ReturnType<typeof backLink<{ id: string; slug: string; name: string; logoUrl?: string | null }>> | null
  /** Shown right after "All reports" (or the logo), such as the notification bell. */
  leading?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="mr-auto flex min-w-0 items-center gap-1 md:mr-0">
        {back ? (
          <>
            <Link {...back.link} className={`max-w-56 ${navLink}`}>
              {back.project ? (
                <>
                  <RiArrowLeftLine aria-hidden className="size-4 shrink-0" />
                  <ProjectTile project={back.project} className="size-4 rounded text-[9px]" />
                </>
              ) : (
                <RiLayoutGridLine aria-hidden className="size-4 shrink-0" />
              )}
              <span className="truncate">{back.label}</span>
            </Link>
            {/* Back leads to the project; every report is one more click away beside it. */}
            {back.project && (
              <Link to="/app" className={`hidden sm:flex ${navLink}`}>
                <RiLayoutGridLine aria-hidden className="size-4 shrink-0" />
                All reports
              </Link>
            )}
          </>
        ) : (
          <BugBerryLogo />
        )}
      </div>
      {leading && <div className="flex items-center">{leading}</div>}
      <div className="flex items-center gap-2 md:ml-auto">{children}</div>
    </div>
  )
}
