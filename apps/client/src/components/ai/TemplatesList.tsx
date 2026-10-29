import { RiAddLine, RiDeleteBinLine, RiPencilLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Textarea } from "@bugberry/ui/textarea"
import { TextField } from "@bugberry/ui/text-field"
import type { AiSetup, AiTemplateInput } from "../../lib/api"
import { api } from "../../lib/client"
import { Badge } from "../ui"
import { errorMessage } from "../../lib/query/unwrap"

type Template = AiSetup["templates"][number]

const EMPTY: AiTemplateInput = { name: "", skeleton: "", instructions: "" }

function TemplateDialog({
  editing,
  onSave,
  onClose,
}: {
  /** The template being edited; null for a new one. */
  editing: Template | null
  onSave(input: AiTemplateInput): Promise<void>
  onClose(): void
}) {
  const [values, setValues] = useState<AiTemplateInput>(
    editing ? { name: editing.name, skeleton: editing.skeleton, instructions: editing.instructions } : EMPTY,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (key: keyof AiTemplateInput) => (value: string) => setValues((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!values.name.trim()) return setError("Give the template a name")
    setError(null)
    setSaving(true)
    try {
      await onSave({ ...values, name: values.name.trim() })
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} aria-label={editing ? "Edit template" : "New template"}>
      <form onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <TextField value={values.name} onChange={set("name")} maxLength={80}>
            <Label>Name</Label>
            <Input placeholder="QA checklist" />
          </TextField>
          <TextField value={values.skeleton} onChange={set("skeleton")} maxLength={4000}>
            <Label>Sections</Label>
            <Textarea rows={5} placeholder={"## Steps to reproduce\n## Expected\n## Actual"} className="font-mono" />
            <Description>Headings the AI fills in, one per line, e.g. ## Steps to reproduce</Description>
          </TextField>
          <TextField value={values.instructions} onChange={set("instructions")} maxLength={2000}>
            <Label>Extra instructions</Label>
            <Textarea rows={3} placeholder="Write in Indonesian, at most 5 steps." />
            <Description>Optional. The description follows the language you write these in.</Description>
          </TextField>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button intent="outline" onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" isPending={saving}>
            Save template
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

/** The workspace's shared templates: anyone in it can add, edit or delete them. */
export function TemplatesListView({
  templates,
  defaultTemplateId,
  usedByProjects,
  onCreate,
  onUpdate,
  onDelete,
}: {
  templates: readonly Template[]
  defaultTemplateId: string | null
  /** Templates some project starts with. */
  usedByProjects: readonly string[]
  onCreate(input: AiTemplateInput): Promise<void>
  onUpdate(id: string, input: AiTemplateInput): Promise<void>
  onDelete(id: string): Promise<void>
}) {
  const [editing, setEditing] = useState<Template | "new" | null>(null)
  const { confirm, dialog } = useConfirm()

  const remove = async (template: Template) => {
    const isDefault = template.id === defaultTemplateId || usedByProjects.includes(template.id)
    const yes = await confirm({
      title: `Delete "${template.name}"?`,
      description: isDefault
        ? "It is used as a default. Reports will start with the workspace's default template instead, or the first one."
        : "Nobody in the workspace will be able to use it any more.",
      confirmLabel: "Delete",
    })
    if (yes) await onDelete(template.id)
  }

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-background p-6 shadow-xs sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold text-foreground">Templates</h2>
          <p className="text-sm text-muted-foreground">How the AI lays out the description. Everyone in the workspace shares them.</p>
        </div>
        <Button intent="outline" size="sm" onPress={() => setEditing("new")}>
          <RiAddLine aria-hidden />
          New template
        </Button>
      </div>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet. Without one, the AI writes free text.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {template.name}
                  {template.id === defaultTemplateId && <Badge className="bg-primary-subtle text-primary">Default</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {template.skeleton.split("\n").filter(Boolean).join(" · ") || template.instructions || "Free text"}
                </span>
              </div>
              <Button intent="plain" size="sq-sm" aria-label={`Edit ${template.name}`} onPress={() => setEditing(template)}>
                <RiPencilLine aria-hidden />
              </Button>
              <Button intent="plain" size="sq-sm" aria-label={`Delete ${template.name}`} onPress={() => void remove(template)}>
                <RiDeleteBinLine aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateDialog
          editing={editing === "new" ? null : editing}
          onSave={(input) => (editing === "new" ? onCreate(input) : onUpdate(editing.id, input))}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog}
    </section>
  )
}

/** The list wired to the workspace's templates. */
export function TemplatesList({ workspaceId, setup }: { workspaceId: string; setup: AiSetup }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai", workspaceId] })
  return (
    <TemplatesListView
      templates={setup.templates}
      defaultTemplateId={setup.defaultTemplateId}
      usedByProjects={setup.projectDefaults.flatMap((entry) => (entry.templateId ? [entry.templateId] : []))}
      onCreate={async (input) => {
        await api.createAiTemplate(workspaceId, input)
        await refresh()
      }}
      onUpdate={async (id, input) => {
        await api.updateAiTemplate(workspaceId, id, input)
        await refresh()
      }}
      onDelete={async (id) => {
        await api.deleteAiTemplate(workspaceId, id)
        await refresh()
      }}
    />
  )
}
