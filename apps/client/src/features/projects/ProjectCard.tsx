import { RiAddLine, RiApps2Line, RiDeleteBinLine, RiGlobalLine, RiMoreLine, RiPencilLine, RiPlugLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import { formatAgo } from "../../lib/format"
import { integrationQueries } from "../integrations/queries"
import { card, pinkAction } from "./card-styles"
import { ProjectTile } from "./ProjectTile"
import type { Project } from "./queries"

/** A project's reports as the overview counts them; null while they load. */
export interface ProjectStats {
  reports: number
  open: number
  lastReportAt: Date | string | null
}

/** "No integrations connected", "1 integration connected"; nothing while the count is loading. */
export function integrationsText(count: number | null): string {
  if (count === null) return ""
  if (count === 0) return "No integrations connected"
  return `${count} ${count === 1 ? "integration" : "integrations"} connected`
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-l border-border pl-5 first:border-l-0 first:pl-0">
      <span className="truncate font-heading text-lg font-semibold text-foreground">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

/** One project as a card. `integrationsLink` is the router link, so the card renders without a router in tests. */
export function ProjectCardView({
  project,
  stats = null,
  now = Date.now(),
  integrationCount,
  integrationsLink,
  onEditPatterns,
  onEdit,
  onDelete,
}: {
  project: Project
  /** Reports, open ones and the newest; null while they load. */
  stats?: ProjectStats | null
  now?: number
  integrationCount: number | null
  integrationsLink: ReactNode
  onEditPatterns(): void
  onEdit(): void
  onDelete(): void
}) {
  const patterns = project.urlPatterns
  return (
    <li className={`flex flex-col ${card}`}>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex items-start gap-2">
          <ProjectTile project={project} className="size-10 rounded-xl text-base" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate font-heading text-md font-semibold text-foreground">{project.name}</h2>
            <span className="truncate font-mono text-sm text-muted-foreground">/app/p/{project.slug}</span>
          </div>
          <MenuTrigger>
            <Button intent="outline" size="sq-sm" aria-label={`More for ${project.name}`}>
              <RiMoreLine aria-hidden />
            </Button>
            <Menu placement="bottom end" className="min-w-48">
              <MenuItem onAction={onEditPatterns} textValue="URL patterns">
                <RiGlobalLine aria-hidden />
                <MenuLabel>URL patterns</MenuLabel>
              </MenuItem>
              <MenuItem intent="danger" onAction={onDelete} textValue="Delete project">
                <RiDeleteBinLine aria-hidden />
                <MenuLabel>Delete project</MenuLabel>
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <Stat value={stats ? String(stats.reports) : "–"} label="Reports" />
          <Stat value={stats ? String(stats.open) : "–"} label="Open" />
          <Stat value={stats?.lastReportAt ? formatAgo(stats.lastReportAt, now) : "–"} label="Last report" />
        </div>

        <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-2">
          {patterns.length === 0 ? (
            <span aria-hidden className="mt-3.5 size-2 shrink-0 rounded-full bg-warning" />
          ) : (
            <RiGlobalLine aria-hidden className="mt-2.5 size-4 shrink-0 text-muted-foreground" />
          )}
          {/* The text (or the patterns) and the button share a row, and the button drops below when it doesn't fit. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
            {patterns.length === 0 ? (
              <span className="py-2 text-sm text-foreground">No URL patterns yet</span>
            ) : (
              <span className="flex min-w-0 flex-wrap gap-1.5 py-2">
                {patterns.map((pattern) => (
                  <code key={pattern} className="rounded-md border border-border bg-background px-1.5 font-mono text-xs/5 break-all text-foreground">
                    {pattern}
                  </code>
                ))}
              </span>
            )}
            <Button
              intent="plain"
              size="sm"
              aria-label={patterns.length === 0 ? "Add pattern" : "Edit patterns"}
              className={`-mx-2 shrink-0 ${pinkAction}`}
              onPress={onEditPatterns}
            >
              {patterns.length === 0 ? <RiAddLine aria-hidden /> : <RiPencilLine aria-hidden />}
              {patterns.length === 0 ? "Add pattern" : "Edit"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <RiPlugLine aria-hidden className="size-4" />
          {integrationsText(integrationCount)}
        </span>
        <span className="flex gap-2">
          {integrationsLink}
          <Button intent="outline" size="sm" onPress={onEdit} aria-label={`Edit ${project.name}`}>
            <RiPencilLine aria-hidden />
            Edit
          </Button>
        </span>
      </div>
    </li>
  )
}

export function ProjectCard({ project, ...rest }: Omit<Parameters<typeof ProjectCardView>[0], "integrationCount" | "integrationsLink">) {
  const integrations = useQuery(integrationQueries.integrations(project.id))
  return (
    <ProjectCardView
      project={project}
      integrationCount={integrations.data?.length ?? null}
      integrationsLink={
        <Link
          to="/app/p/$projectSlug/integrations"
          params={{ projectSlug: project.slug }}
          className={buttonStyles({ intent: "outline", size: "sm" })}
        >
          <RiApps2Line aria-hidden />
          Integrations
        </Link>
      }
      {...rest}
    />
  )
}
