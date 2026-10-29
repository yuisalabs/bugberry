import { RiAddLine, RiGlobalLine } from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import { formatAgo } from "../../lib/format"
import { card, cardTitle, pinkAction } from "./card-styles"
import { ProjectTile } from "./ProjectTile"
import type { Project } from "./queries"
import { patternForPage } from "./url-patterns"

/** A page whose reports no URL pattern catches, as the overview lists it. */
export interface UnmatchedPage {
  page: string
  reports: number
  lastReportAt: Date | string
  suggestedProjectId: string | null
}

/** "4 reports · last 3h ago". */
export function pageMeta(page: Pick<UnmatchedPage, "reports" | "lastReportAt">, now: number): string {
  return `${page.reports} ${page.reports === 1 ? "report" : "reports"} · last ${formatAgo(page.lastReportAt, now)}`
}

/**
 * Pages whose reports no pattern catches, each with the project most of its reports went to. Add pattern opens
 * that project's patterns with the page's pattern filled in; without a suggestion it asks which project first.
 */
export function UnmatchedPagesCard({
  pages,
  projects,
  now,
  onAdd,
}: {
  pages: readonly UnmatchedPage[]
  projects: readonly Project[]
  now: number
  onAdd(project: Project, pattern: string): void
}) {
  if (pages.length === 0) return null
  return (
    <section className={`flex flex-col ${card}`}>
      <div className="flex flex-col gap-1 p-6 sm:px-8 sm:pt-8">
        <h2 className={`flex items-center gap-2.5 ${cardTitle}`}>
          Pages without a project
          <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-semibold text-warning-subtle-foreground">{pages.length}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Reports from these sites went to your last-used project. Add a pattern so they're filed correctly.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border border-t border-border">
        {pages.map((page) => {
          const suggested = projects.find((project) => project.id === page.suggestedProjectId)
          const pattern = patternForPage(page.page)
          return (
            <li key={page.page} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4 sm:px-8">
              <span aria-hidden className="grid size-10 shrink-0 place-content-center rounded-xl bg-muted text-foreground">
                <RiGlobalLine className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-foreground">{page.page}</span>
                <span className="text-sm text-muted-foreground">{pageMeta(page, now)}</span>
              </div>
              {suggested && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  Suggested:
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <ProjectTile project={suggested} className="size-4 rounded text-[9px]" />
                    {suggested.name}
                  </span>
                </span>
              )}
              {suggested ? (
                <Button
                  intent="outline"
                  size="sm"
                  aria-label={`Add pattern for ${page.page}`}
                  className={pinkAction}
                  onPress={() => onAdd(suggested, pattern)}
                >
                  <RiAddLine aria-hidden />
                  Add pattern
                </Button>
              ) : (
                <MenuTrigger>
                  <Button intent="outline" size="sm" aria-label={`Add pattern for ${page.page}`} className={pinkAction}>
                    <RiAddLine aria-hidden />
                    Add pattern
                  </Button>
                  <Menu placement="bottom end" className="min-w-48" aria-label="Add to project">
                    {projects.map((project) => (
                      <MenuItem key={project.id} id={project.id} textValue={project.name} onAction={() => onAdd(project, pattern)}>
                        <ProjectTile project={project} />
                        <MenuLabel>{project.name}</MenuLabel>
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
