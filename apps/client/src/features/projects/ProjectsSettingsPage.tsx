import { RiAddLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { BrandedHeader } from "../../components/BrandedHeader"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { EmptyState, ErrorState } from "../../components/ui"
import { useNow } from "../../hooks/useNow"
import { errorMessage } from "../../lib/query/unwrap"
import { useCurrentWorkspace } from "../workspaces/workspace"
import { NewProjectTile } from "./NewProjectTile"
import { ProjectCard, type ProjectStats } from "./ProjectCard"
import { ProjectDialog, UrlPatternsDialog } from "./ProjectDialogs"
import { type Project, projectQueries, useDeleteProject } from "./queries"
import { TestUrlCard } from "./TestUrlCard"
import { UnmatchedPagesCard } from "./UnmatchedPagesCard"

export function ProjectsSettingsPage() {
  const { confirm, dialog } = useConfirm()
  const now = useNow()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const projects = useQuery({ ...projectQueries.projects(workspaceId), enabled: Boolean(workspace) })
  const overview = useQuery({ ...projectQueries.projectsOverview(workspaceId), enabled: Boolean(workspace) })
  // "new", or the project whose name and slug are being edited.
  const [editing, setEditing] = useState<Project | "new" | null>(null)
  // The project whose patterns are open, and a pattern to add to them (from Pages without a project).
  const [patternsOf, setPatternsOf] = useState<{ project: Project; adding?: string } | null>(null)
  const remove = useDeleteProject()
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
