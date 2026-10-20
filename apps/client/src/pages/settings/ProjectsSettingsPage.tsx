import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { EmptyState, ErrorState, PageHeader } from "../../components/ui"
import { errorMessage, type Project, type ProjectInput } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"
import { parsePatterns, slugify } from "../../lib/slug"

export function ProjectsSettingsPage() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const [editing, setEditing] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })

  return (
    <section className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Projects"
        subtitle="The extension uses URL patterns to pick a project automatically."
        actions={editing !== "new" && <Button size="sm" onPress={() => setEditing("new")}>New project</Button>}
      />
      {editing === "new" && <ProjectForm onDone={() => setEditing(null)} />}
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
        <EmptyState title="No projects yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.data.map((project) =>
            editing === project.id ? (
              <li key={project.id}>
                <ProjectForm project={project} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={project.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-background p-4">
                <div className="min-w-0">
                  <p className="font-medium">{project.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">/app/p/{project.slug}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {project.urlPatterns.length > 0 ? project.urlPatterns.join(" · ") : "No URL patterns"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to="/app/settings/projects/$projectId/integrations"
                    params={{ projectId: project.id }}
                    className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Integrations
                  </Link>
                  <Button size="sm" intent="outline" onPress={() => setEditing(project.id)}>
                    Edit
                  </Button>
                  <Button size="sm"
                    intent="danger"
                    isDisabled={remove.isPending}
                    onPress={() => {
                      if (window.confirm(`Delete project “${project.name}”?`)) remove.mutate(project.id)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const [name, setName] = useState(project?.name ?? "")
  const [slug, setSlug] = useState(project?.slug ?? "")
  const [slugEdited, setSlugEdited] = useState(project !== undefined)
  const [patterns, setPatterns] = useState(project?.urlPatterns.join("\n") ?? "")
  const save = useMutation({
    mutationFn: (input: ProjectInput) => (project ? api.updateProject(project.id, input) : api.createProject(workspace?.id ?? "", input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      onDone()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ name: name.trim(), slug, urlPatterns: parsePatterns(patterns) })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <TextField
        isRequired
        maxLength={80}
        value={name}
        onChange={(value) => {
          setName(value)
          if (!slugEdited) setSlug(slugify(value))
        }}
      >
        <Label>Name</Label>
        <Input />
      </TextField>
      <TextField
        isRequired
        maxLength={40}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={slug}
        onChange={(value) => {
          setSlug(value)
          setSlugEdited(true)
        }}
      >
        <Label>Slug (used in the dashboard URL)</Label>
        <Input className="font-mono" />
      </TextField>
      <TextField value={patterns} onChange={setPatterns}>
        <Label>URL patterns, one per line (e.g. *.app.example.com/*)</Label>
        <Textarea rows={4} className="font-mono" />
      </TextField>
      {save.error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" isDisabled={save.isPending}>
          Save
        </Button>
        <Button size="sm" intent="plain" onPress={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
