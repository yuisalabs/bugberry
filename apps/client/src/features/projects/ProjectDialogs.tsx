import { RiAddLine, RiCheckboxCircleLine, RiCloseCircleLine, RiDeleteBinLine, RiGlobalLine, RiLinkM } from "@remixicon/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Description, Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { slugify } from "./slug"
import { LOGO_RULE, LogoPicker } from "../../components/LogoPicker"
import { cleanPatterns, MAX_PATTERN_LENGTH, MAX_PATTERNS, patternExamples, savePatternsLabel, testUrl } from "./url-patterns"
import { useCurrentWorkspace, workspaceColor } from "../../lib/workspace"
import { errorMessage } from "../../lib/query/unwrap"
import { qk } from "../../lib/query/keys"
import { confirmProjectLogo, createProject, type Project, type ProjectInput, projectLogoUploadTarget, removeProjectLogo, updateProject } from "./queries"

const sectionLabel = "text-sm font-medium text-foreground"

/** The URL patterns of one project, one field each, with examples and a URL to try them on. No dialog, so it renders in tests. */
export function UrlPatternsForm({
  projectName,
  patterns: initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  projectName: string
  patterns: readonly string[]
  saving: boolean
  error: string | null
  onSave(patterns: string[]): void
  onCancel(): void
}) {
  const [rows, setRows] = useState<string[]>(initial.length > 0 ? [...initial] : [""])
  const [tryUrl, setTryUrl] = useState("")
  const kept = cleanPatterns(rows)
  const result = testUrl(rows, tryUrl)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(kept)
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle className="font-heading text-xl sm:text-xl">URL patterns</DialogTitle>
        <DialogDescription>Bugs recorded on a matching page go straight to {projectName}.</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-6 pb-6">
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Patterns</span>
          {rows.map((value, index) => (
            // Rows are plain strings that can repeat while typed, so their place is their key.
            <div key={index} className="flex items-center gap-2">
              <TextField
                aria-label={`Pattern ${index + 1}`}
                value={value}
                maxLength={MAX_PATTERN_LENGTH}
                onChange={(next) => setRows((current) => current.map((row, at) => (at === index ? next : row)))}
                className="flex-1"
              >
                <InputGroup>
                  <RiGlobalLine aria-hidden data-slot="icon" />
                  <Input placeholder="app.example.com/*" className="font-mono" />
                </InputGroup>
              </TextField>
              <Button
                intent="plain"
                size="sq-sm"
                aria-label={`Remove pattern ${index + 1}`}
                onPress={() => setRows((current) => (current.length === 1 ? [""] : current.filter((_, at) => at !== index)))}
              >
                <RiDeleteBinLine aria-hidden />
              </Button>
            </div>
          ))}
          {rows.length < MAX_PATTERNS && (
            <Button intent="plain" size="sm" className="self-start [--btn-foreground:var(--color-primary)] [--btn-icon:var(--color-primary)]" onPress={() => setRows((current) => [...current, ""])}>
              <RiAddLine aria-hidden />
              Add another pattern
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded-xl bg-muted p-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Examples</span>
          <ul className="flex flex-col gap-2">
            {patternExamples(rows).map((example) => (
              <li key={example.pattern} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <code className="rounded-md border border-border bg-background px-1.5 font-mono text-foreground">{example.pattern}</code>
                {example.meaning}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <TextField value={tryUrl} onChange={setTryUrl}>
            <Label>Test a URL</Label>
            <InputGroup>
              <RiLinkM aria-hidden data-slot="icon" />
              <Input placeholder="https://app.example.com/checkout?step=2" className="font-mono" />
            </InputGroup>
          </TextField>
          {result.status === "match" ? (
            <p role="status" className="flex items-center gap-1.5 text-sm text-success-subtle-foreground">
              <RiCheckboxCircleLine aria-hidden className="size-4" />
              Matches
              <code className="rounded-md bg-success-subtle px-1.5 font-mono text-xs/5">{result.pattern}</code>
            </p>
          ) : result.status === "none" || result.status === "invalid" ? (
            <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RiCloseCircleLine aria-hidden className="size-4" />
              {result.status === "none" ? "No pattern matches this URL" : "That isn't a URL"}
            </p>
          ) : null}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter className="border-t border-border pt-(--gutter)">
        <Button intent="outline" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isDisabled={saving}>
          {savePatternsLabel(kept.length)}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The project's URL patterns in a dialog; saving keeps its name and slug. `adding` starts with one more pattern filled in. */
export function UrlPatternsDialog({ project, adding, onClose }: { project: Project | null; adding?: string; onClose(): void }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (urlPatterns: string[]) =>
      updateProject(project?.id ?? "", { name: project?.name ?? "", slug: project?.slug ?? "", urlPatterns }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.projects.all })
      onClose()
    },
  })
  return (
    <Dialog isOpen={project !== null} onOpenChange={(open) => !open && onClose()} aria-label="URL patterns" size="xl">
      {project && (
        <UrlPatternsForm
          key={`${project.id}:${adding ?? ""}`}
          projectName={project.name}
          patterns={adding && !project.urlPatterns.includes(adding) ? [...project.urlPatterns, adding] : project.urlPatterns}
          saving={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onSave={(patterns) => save.mutate(patterns)}
          onCancel={onClose}
        />
      )}
    </Dialog>
  )
}

/** What the project form saves: its name and slug, and a new logo to upload or the old one to remove. */
export interface ProjectFormValues {
  name: string
  slug: string
  logo: File | null
  removeLogo: boolean
}

/**
 * A new project's name, slug and optional logo, or an existing one's; its URL patterns have their own dialog. Without a
 * logo the project shows its first letter.
 */
export function ProjectForm({
  project,
  saving,
  error,
  measure,
  onSave,
  onCancel,
}: {
  project?: Project
  saving: boolean
  error: string | null
  /** Tests measure the image without a browser. */
  measure?: (file: File) => Promise<{ width: number; height: number }>
  onSave(input: ProjectFormValues): void
  onCancel(): void
}) {
  const [name, setName] = useState(project?.name ?? "")
  const [slug, setSlug] = useState(project?.slug ?? "")
  const [slugEdited, setSlugEdited] = useState(project !== undefined)
  const [logo, setLogo] = useState<File | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const current = removeLogo ? null : (project?.logoUrl ?? null)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ name: name.trim(), slug, logo, removeLogo: removeLogo && !logo })
      }}
      className="flex min-h-0 flex-col"
    >
      <DialogHeader>
        <DialogTitle className="font-heading text-xl sm:text-xl">{project ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription>Reports can be filed under a project, and the extension picks one by its URL patterns.</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-4 pb-6">
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
          <Input placeholder="Checkout web" />
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
          <Label>Slug</Label>
          <Input className="font-mono" />
          <Description>Used in the dashboard's address: /app/p/{slug || "…"}</Description>
        </TextField>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">
            Logo <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <LogoPicker
            file={logo}
            current={current}
            name={name}
            color={project ? workspaceColor(project.id) : "bg-primary"}
            measure={measure}
            hint={LOGO_RULE}
            onChange={(file) => {
              setLogo(file)
              setRemoveLogo(false)
            }}
            actions={
              (logo || current) && (
                <Button
                  size="sm"
                  intent="plain"
                  onPress={() => {
                    setLogo(null)
                    setRemoveLogo(true)
                  }}
                >
                  Remove
                </Button>
              )
            }
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter className="border-t border-border pt-(--gutter)">
        <Button intent="outline" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isDisabled={saving}>
          {project ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Puts a project's new logo in storage and makes it the one in use. */
async function uploadProjectLogo(projectId: string, file: File) {
  const { upload, logoId } = await projectLogoUploadTarget(projectId, file.type as "image/png" | "image/jpeg", file.size)
  const response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file })
  if (!response.ok) throw new Error("The logo didn't upload. Try again.")
  await confirmProjectLogo(projectId, logoId)
}

/**
 * "New project" (no `project`) or "Edit project" in a dialog; editing keeps the URL patterns as they are. A new logo
 * uploads once the project is saved, so a new project gets one too.
 */
export function ProjectDialog({ project, isOpen, onClose }: { project?: Project; isOpen: boolean; onClose(): void }) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const save = useMutation({
    mutationFn: async ({ logo, removeLogo, ...input }: ProjectInput & Pick<ProjectFormValues, "logo" | "removeLogo">) => {
      const saved = project ? await updateProject(project.id, input) : await createProject(workspace?.id ?? "", input)
      if (logo) await uploadProjectLogo(saved.id, logo)
      else if (removeLogo) await removeProjectLogo(saved.id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.projects.all })
      onClose()
    },
  })
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} aria-label={project ? "Edit project" : "New project"} size="lg">
      {isOpen && (
        <ProjectForm
          key={project?.id ?? "new"}
          project={project}
          saving={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onSave={({ name, slug, logo, removeLogo }) =>
            save.mutate({ name, slug, urlPatterns: project ? [...project.urlPatterns] : [], logo, removeLogo })
          }
          onCancel={onClose}
        />
      )}
    </Dialog>
  )
}
