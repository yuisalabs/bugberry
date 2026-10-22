import {
  RiAddLine,
  RiApps2Line,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiGlobalLine,
  RiInformationLine,
  RiLinkM,
  RiMoreLine,
  RiPencilLine,
  RiPlugLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Input, InputGroup } from "@bugberry/ui/input"
import { Menu, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import { TextField } from "@bugberry/ui/text-field"
import { BrandedHeader } from "../../components/BrandedHeader"
import { ProjectDialog, UrlPatternsDialog } from "../../components/projects/ProjectDialogs"
import { ProjectTile } from "../../components/ProjectTile"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { EmptyState, ErrorState } from "../../components/ui"
import { useNow } from "../../hooks/useNow"
import { errorMessage, type Project } from "../../lib/api"
import { api } from "../../lib/client"
import { formatAgo } from "../../lib/format"
import { queries } from "../../lib/queries"
import { patternForPage, testProjects } from "../../lib/url-patterns"
import { useCurrentWorkspace } from "../../lib/workspace"
import { useConfirm } from "@bugberry/ui/confirm-dialog"

/** A project's reports as the overview counts them; null while they load. */
export interface ProjectStats {
  reports: number
  open: number
  lastReportAt: Date | string | null
}

/** A page whose reports no URL pattern catches, as the overview lists it. */
export interface UnmatchedPage {
  page: string
  reports: number
  lastReportAt: Date | string
  suggestedProjectId: string | null
}

const card = "rounded-3xl border border-border bg-background"
const cardTitle = "font-heading text-xl font-semibold text-foreground"
// Pink text on a quiet button; the kit greys button icons by default, so the icon is told to follow the text.
const pinkAction = "text-primary [--btn-icon-active:currentColor] [--btn-icon:currentColor]"

/** "No integrations connected", "1 integration connected"; nothing while the count is loading. */
export function integrationsText(count: number | null): string {
  if (count === null) return ""
  if (count === 0) return "No integrations connected"
  return `${count} ${count === 1 ? "integration" : "integrations"} connected`
}

/** "4 reports · last 3h ago". */
export function pageMeta(page: Pick<UnmatchedPage, "reports" | "lastReportAt">, now: number): string {
  return `${page.reports} ${page.reports === 1 ? "report" : "reports"} · last ${formatAgo(page.lastReportAt, now)}`
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

/** The last tile of the grid: a dashed card that starts a new project. */
export function NewProjectTile({ onPress }: { onPress(): void }) {
  return (
    <li className="flex">
      <AriaButton
        onPress={onPress}
        className="flex min-h-64 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border bg-transparent p-6 text-center outline-hidden transition border-primary/40 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="mb-2 grid size-12 place-content-center rounded-full bg-primary-subtle text-primary">
          <RiAddLine className="size-6" />
        </span>
        <span className="font-heading text-lg font-semibold text-foreground">New project</span>
        <span className="text-sm text-muted-foreground">Group reports by site or app</span>
      </AriaButton>
    </li>
  )
}

/** Paste an address, see which project the extension files it under and which pattern decides it. */
export function TestUrlCard({ projects }: { projects: readonly Project[] }) {
  const [input, setInput] = useState("")
  const result = testProjects(projects, input)
  return (
    <section className={`flex flex-col gap-5 p-4 ${card}`}>
      <div className="flex flex-col gap-1">
        <h2 className={cardTitle}>Test a URL</h2>
        <p className="text-sm text-muted-foreground">Paste any page address to see which project the extension will file it under.</p>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <TextField aria-label="Page address" value={input} onChange={setInput} className="flex-1">
          {/* The input is taller than usual, so the icon is centred on it instead of at the kit's fixed offset. */}
          <InputGroup className="h-full *:data-[slot=icon]:top-1/2 *:data-[slot=icon]:-translate-y-1/2 sm:*:data-[slot=icon]:top-1/2">
            <RiLinkM aria-hidden data-slot="icon" />
            <Input placeholder="https://app.example.com/checkout?step=pay" className="h-11" />
          </InputGroup>
        </TextField>
        {result.status !== "empty" && (
          <p
            role="status"
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2.5 text-sm lg:max-w-[45%] ${
              result.status === "match" ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {result.status === "match" ? (
              <>
                <RiCheckboxCircleLine aria-hidden className="size-4 shrink-0" />
                Matches
                <span className="flex items-center gap-1.5 font-semibold">
                  <ProjectTile project={result.project} className="size-4 rounded text-[9px]" />
                  {result.project.name}
                </span>
                <span className="text-xs">
                  via <code className="font-mono">{result.pattern}</code>
                </span>
              </>
            ) : result.status === "none" ? (
              "No project matches this URL"
            ) : (
              "That isn't a page address"
            )}
          </p>
        )}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <RiInformationLine aria-hidden className="size-4 shrink-0" />
        No match? Reports land in the project you picked last in the extension.
      </p>
    </section>
  )
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

function ProjectCard({ project, ...rest }: Omit<Parameters<typeof ProjectCardView>[0], "integrationCount" | "integrationsLink">) {
  const integrations = useQuery(queries.integrations(project.id))
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

export function ProjectsSettingsPage() {
  const { confirm, dialog } = useConfirm()
  const queryClient = useQueryClient()
  const now = useNow()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(workspace) })
  const overview = useQuery({ ...queries.projectsOverview(workspaceId), enabled: Boolean(workspace) })
  // "new", or the project whose name and slug are being edited.
  const [editing, setEditing] = useState<Project | "new" | null>(null)
  // The project whose patterns are open, and a pattern to add to them (from Pages without a project).
  const [patternsOf, setPatternsOf] = useState<{ project: Project; adding?: string } | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })
  const statsOf = (id: string): ProjectStats | null => {
    if (!overview.data) return null
    return overview.data.stats.find((row) => row.projectId === id) ?? { reports: 0, open: 0, lastReportAt: null }
  }

  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader
        title="Projects"
        description="The extension uses URL patterns to pick a project automatically."
        action={
          <Button onPress={() => setEditing("new")}>
            <RiAddLine aria-hidden />
            New project
          </Button>
        }
      />
      {remove.error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(remove.error)}
        </p>
      )}
      {projects.isPending ? (
        <SettingsRowsSkeleton />
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : projects.data.length === 0 ? (
        <EmptyState title="No projects yet">Create one to sort reports by product or site.</EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            {projects.data.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                stats={statsOf(project.id)}
                now={now}
                onEditPatterns={() => setPatternsOf({ project })}
                onEdit={() => setEditing(project)}
                onDelete={async () => {
                  const yes = await confirm({
                    title: `Delete project “${project.name}”?`,
                    description: "Its URL patterns and integrations are deleted with it.",
                    confirmLabel: "Delete project",
                  })
                  if (yes) remove.mutate(project.id)
                }}
              />
            ))}
            <NewProjectTile onPress={() => setEditing("new")} />
          </ul>
          <TestUrlCard projects={projects.data} />
          <UnmatchedPagesCard
            pages={overview.data?.unmatched ?? []}
            projects={projects.data}
            now={now}
            onAdd={(project, pattern) => setPatternsOf({ project, adding: pattern })}
          />
        </>
      )}
      <ProjectDialog project={editing === "new" ? undefined : (editing ?? undefined)} isOpen={editing !== null} onClose={() => setEditing(null)} />
      <UrlPatternsDialog project={patternsOf?.project ?? null} adding={patternsOf?.adding} onClose={() => setPatternsOf(null)} />
      {dialog}
    </section>
  )
}
