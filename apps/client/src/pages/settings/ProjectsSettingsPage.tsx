import {
  RiAddLine,
  RiApps2Line,
  RiDeleteBinLine,
  RiGlobalLine,
  RiHashtag,
  RiMoreLine,
  RiPencilLine,
  RiPlugLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import { ProjectDialog, UrlPatternsDialog } from "../../components/projects/ProjectDialogs"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { EmptyState, ErrorState } from "../../components/ui"
import { errorMessage, type Project } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace, workspaceColor } from "../../lib/workspace"

/** "No integrations connected", "1 integration connected"; nothing while the count is loading. */
export function integrationsText(count: number | null): string {
  if (count === null) return ""
  if (count === 0) return "No integrations connected"
  return `${count} ${count === 1 ? "integration" : "integrations"} connected`
}

/** One project as a card. `integrationsLink` is the router link, so the card renders without a router in tests. */
export function ProjectCardView({
  project,
  integrationCount,
  integrationsLink,
  onEditPatterns,
  onEdit,
  onDelete,
}: {
  project: Project
  integrationCount: number | null
  integrationsLink: ReactNode
  onEditPatterns(): void
  onEdit(): void
  onDelete(): void
}) {
  const patterns = project.urlPatterns
  return (
    <li className="flex flex-col rounded-2xl border border-border bg-background shadow-xs">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden className={`grid size-12 shrink-0 place-content-center rounded-xl text-white ${workspaceColor(project.id)}`}>
            <RiHashtag className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate font-heading text-lg font-semibold text-foreground">{project.name}</h2>
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
            <Button intent="plain" size="sm" className="-mx-2 shrink-0 text-primary" onPress={onEditPatterns}>
              {patterns.length === 0 ? <RiAddLine aria-hidden /> : <RiPencilLine aria-hidden />}
              {patterns.length === 0 ? "Add pattern" : "Edit patterns"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
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

function ProjectCard({ project, ...actions }: { project: Project; onEditPatterns(): void; onEdit(): void; onDelete(): void }) {
  const integrations = useQuery(queries.integrations(project.id))
  return (
    <ProjectCardView
      project={project}
      integrationCount={integrations.data?.length ?? null}
      integrationsLink={
        <Link
          to="/app/settings/projects/$projectId/integrations"
          params={{ projectId: project.id }}
          className={buttonStyles({ intent: "outline", size: "sm" })}
        >
          <RiApps2Line aria-hidden />
          Integrations
        </Link>
      }
      {...actions}
    />
  )
}

export function ProjectsSettingsPage() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  // "new", or the project whose name and slug are being edited.
  const [editing, setEditing] = useState<Project | "new" | null>(null)
  const [patternsOf, setPatternsOf] = useState<Project | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">Projects</h1>
          <p className="text-muted-foreground text-sm">The extension uses URL patterns to pick a project automatically.</p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <RiAddLine aria-hidden />
          New project
        </Button>
      </header>
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
        <ul className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {projects.data.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEditPatterns={() => setPatternsOf(project)}
              onEdit={() => setEditing(project)}
              onDelete={() => {
                if (window.confirm(`Delete project “${project.name}”?`)) remove.mutate(project.id)
              }}
            />
          ))}
        </ul>
      )}
      <ProjectDialog project={editing === "new" ? undefined : (editing ?? undefined)} isOpen={editing !== null} onClose={() => setEditing(null)} />
      <UrlPatternsDialog project={patternsOf} onClose={() => setPatternsOf(null)} />
    </section>
  )
}
