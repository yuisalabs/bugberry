import { LABEL_COLORS, type LabelColor, MAX_LABEL_NAME_LENGTH } from "@bugberry/shared"
import { RiDeleteBinLine, RiPencilLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Input } from "@bugberry/ui/input"
import { Menu, MenuItem, MenuTrigger } from "@bugberry/ui/menu"
import { BrandedHeader } from "../../components/layout/BrandedHeader"
import { SettingsRowsSkeleton } from "../../components/layout/Skeletons"
import { EmptyState } from "../../components/ui/empty-state"
import { ErrorState } from "../../components/ui/error-state"
import { qk } from "../../lib/query/keys"
import { errorMessage } from "../../lib/query/unwrap"
import { useCurrentWorkspace } from "../workspaces/workspace"
import { LabelChip } from "./LabelChip"
import { LABEL_SWATCHES } from "./label-colors"
import { createLabel, deleteLabel, labelQueries, updateLabel, type WorkspaceLabel } from "./queries"

const COLOR_NAMES: Record<LabelColor, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
}

const reportsText = (count: number) => `${count} report${count === 1 ? "" : "s"}`

function LabelRow({
  label,
  onRename,
  onRecolor,
  onDelete,
}: {
  label: WorkspaceLabel
  onRename(id: string, name: string): Promise<void>
  onRecolor(id: string, color: LabelColor): void
  onDelete(label: WorkspaceLabel): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (draft === null || draft.trim() === label.name) return setDraft(null)
    try {
      await onRename(label.id, draft)
      setDraft(null)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3">
        <MenuTrigger>
          <Button intent="plain" size="sq-sm" aria-label={`Color of ${label.name}: ${COLOR_NAMES[label.color]}`}>
            <span aria-hidden className={`size-3.5 rounded-full ${LABEL_SWATCHES[label.color]}`} />
          </Button>
          <Menu
            aria-label={`Color of ${label.name}`}
            selectionMode="single"
            selectedKeys={[label.color]}
            onAction={(key) => onRecolor(label.id, key as LabelColor)}
          >
            {LABEL_COLORS.map((color) => (
              <MenuItem key={color} id={color} textValue={COLOR_NAMES[color]}>
                <span className="flex items-center gap-2">
                  <span aria-hidden className={`size-3 rounded-full ${LABEL_SWATCHES[color]}`} />
                  {COLOR_NAMES[color]}
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <div className="min-w-0 flex-1">
          {draft === null ? (
            <LabelChip label={label} />
          ) : (
            <Input
              aria-label={`Name of ${label.name}`}
              value={draft}
              maxLength={MAX_LABEL_NAME_LENGTH}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void save()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save()
                if (event.key === "Escape") {
                  setDraft(null)
                  setError(null)
                }
              }}
              className="max-w-xs"
            />
          )}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{reportsText(label.reportCount)}</span>
        <Button intent="plain" size="sq-sm" aria-label={`Rename ${label.name}`} onPress={() => setDraft(label.name)}>
          <RiPencilLine aria-hidden />
        </Button>
        <Button intent="plain" size="sq-sm" aria-label={`Delete ${label.name}`} onPress={() => onDelete(label)} className="text-danger-subtle-foreground">
          <RiDeleteBinLine aria-hidden />
        </Button>
      </div>
      {error && (
        <p role="alert" className="pl-11 text-xs text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </li>
  )
}

/** The admin's list of a workspace's labels: add, rename, recolor and delete. */
export function LabelsSettingsView({
  labels,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: {
  labels: readonly WorkspaceLabel[]
  onCreate(name: string): Promise<void>
  onRename(id: string, name: string): Promise<void>
  onRecolor(id: string, color: LabelColor): void
  onDelete(id: string): void
}) {
  const { confirm, dialog } = useConfirm()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!name.trim()) return
    try {
      await onCreate(name)
      setName("")
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  const remove = async (label: WorkspaceLabel) => {
    const yes = await confirm({
      title: `Delete the label "${label.name}"?`,
      description: `It comes off ${reportsText(label.reportCount)}.`,
      confirmLabel: "Delete label",
    })
    if (yes) onDelete(label.id)
  }
  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <form onSubmit={(event) => void submit(event)} className="flex max-w-md items-start gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Input aria-label="New label" placeholder="Label name" value={name} maxLength={MAX_LABEL_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />
          {error && (
            <p role="alert" className="text-xs text-danger-subtle-foreground">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" onPress={() => void submit()}>
          Create label
        </Button>
      </form>
      {labels.length === 0 ? (
        <EmptyState title="No labels yet">
          Labels sort reports your own way, such as by team or by kind of bug. Members put them on reports and filter the list by them.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {labels.map((label) => (
            <LabelRow key={label.id} label={label} onRename={onRename} onRecolor={onRecolor} onDelete={(row) => void remove(row)} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function LabelsSettingsPage() {
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const queryClient = useQueryClient()
  const labels = useQuery({ ...labelQueries.labels(workspaceId), enabled: Boolean(workspace) })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.labels(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: qk.reports.all })
  }
  const recolor = useMutation({ mutationFn: ({ id, color }: { id: string; color: LabelColor }) => updateLabel(id, { color }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => deleteLabel(id), onSuccess: refresh })
  const failure = recolor.error ?? remove.error

  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader title="Labels" description="Members put labels on reports and filter the list by them. Only admins rename, recolor or delete them." />
      {failure && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(failure)}
        </p>
      )}
      {labels.isPending ? (
        <SettingsRowsSkeleton />
      ) : labels.isError ? (
        <ErrorState error={labels.error} onRetry={() => void labels.refetch()} />
      ) : (
        <LabelsSettingsView
          labels={labels.data}
          onCreate={async (name) => {
            await createLabel(workspaceId, name)
            refresh()
          }}
          onRename={async (id, name) => {
            await updateLabel(id, { name })
            refresh()
          }}
          onRecolor={(id, color) => recolor.mutate({ id, color })}
          onDelete={(id) => remove.mutate(id)}
        />
      )}
    </section>
  )
}
