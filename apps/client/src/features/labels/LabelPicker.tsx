import { MAX_LABELS_PER_REPORT } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Popover, PopoverTrigger } from "@bugberry/ui/popover"
import { SearchField, SearchInput } from "@bugberry/ui/search-field"
import { errorMessage } from "../../lib/query/unwrap"
import { qk } from "../../lib/query/keys"
import { LabelChip } from "./LabelChip"
import { LABEL_SWATCHES } from "./label-colors"
import { createLabel, type Label, labelQueries, setReportLabels } from "./queries"

/** The report's labels as chips and an "Add label" popover; `onSet` gets the whole new set of ids. */
export function LabelPickerView({
  labels,
  options,
  onSet,
  onCreate,
  error = null,
}: {
  labels: readonly Label[]
  /** The workspace's labels; undefined while they load. */
  options: readonly Label[] | undefined
  onSet(labelIds: string[]): void
  /** Creates the label and puts it on the report. */
  onCreate(name: string): Promise<void>
  error?: string | null
}) {
  const [query, setQuery] = useState("")
  const typed = query.trim()
  const all = options ?? []
  const shown = typed ? all.filter((label) => label.name.toLowerCase().includes(typed.toLowerCase())) : all
  const exact = all.some((label) => label.name.toLowerCase() === typed.toLowerCase())
  const ids = labels.map((label) => label.id)
  const full = ids.length >= MAX_LABELS_PER_REPORT
  const toggle = (id: string) => onSet(ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
        <PopoverTrigger onOpenChange={(isOpen) => !isOpen && setQuery("")}>
          <Button intent="plain" size="xs" className="text-muted-foreground">
            <RiAddLine aria-hidden />
            Add label
          </Button>
          <Popover placement="bottom start" className="w-64">
            <div className="flex flex-col gap-2 p-2.5">
              <SearchField aria-label="Find or create a label" value={query} onChange={setQuery} autoFocus>
                <SearchInput placeholder="Find or create a label" maxLength={40} />
              </SearchField>
              {full && <p className="px-1 text-xs text-muted-foreground">A report takes at most {MAX_LABELS_PER_REPORT} labels.</p>}
              <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {options === undefined && <p className="px-1 text-sm text-muted-foreground">Loading labels…</p>}
                {shown.map((label) => {
                  const checked = ids.includes(label.id)
                  return (
                    <CheckboxField
                      key={label.id}
                      aria-label={label.name}
                      isSelected={checked}
                      isDisabled={full && !checked}
                      onChange={() => toggle(label.id)}
                      className="rounded-md px-1.5 py-1 hover:bg-muted"
                    >
                      <Checkbox>
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${LABEL_SWATCHES[label.color]}`} />
                          <span className="truncate">{label.name}</span>
                        </span>
                      </Checkbox>
                    </CheckboxField>
                  )
                })}
              </div>
              {typed && !exact && !full && options !== undefined && (
                <Button
                  intent="outline"
                  size="sm"
                  // A failed create shows its error below and keeps the name, so it can be changed and tried again.
                  onPress={() => void onCreate(typed).then(() => setQuery(""), () => undefined)}
                >
                  {`Create "${typed}"`}
                </Button>
              )}
              {options?.length === 0 && !typed && (
                <p className="px-1 text-sm text-muted-foreground">No labels yet. Type a name to create the first one.</p>
              )}
            </div>
          </Popover>
        </PopoverTrigger>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The picker wired to the API. The chips change at once, like status and priority beside them; a refused save
 * puts them back and shows the server's message.
 */
export function LabelPicker({ workspaceId, reportId, labels }: { workspaceId: string; reportId: string; labels: readonly Label[] }) {
  const queryClient = useQueryClient()
  const options = useQuery({ ...labelQueries.labels(workspaceId), enabled: Boolean(workspaceId) })
  const [pending, setPending] = useState<readonly Label[] | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.report(reportId) })
    void queryClient.invalidateQueries({ queryKey: qk.activity(reportId) })
    void queryClient.invalidateQueries({ queryKey: qk.reports.all })
    void queryClient.invalidateQueries({ queryKey: qk.labels(workspaceId) })
  }
  // One scope per report: quick toggles are saved one after another, in the order they were made.
  const latest = useRef(0)
  const save = useMutation({
    scope: { id: `report-labels-${reportId}` },
    mutationFn: ({ labelIds }: { labelIds: string[]; turn: number }) => setReportLabels(reportId, labelIds),
    // Only the last toggle's save hands the chips back to the server's answer, so earlier ones never flicker them.
    onSettled: (_answer, _error, { turn }) => turn === latest.current && setPending(null),
    onSuccess: refresh,
  })
  const create = useMutation({
    mutationFn: (name: string) => createLabel(workspaceId, name),
    // Listed at once, even when putting it on the report then fails.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.labels(workspaceId) }),
  })
  const shown = pending ?? labels
  const known = [...(options.data ?? []), ...labels]
  const set = (labelIds: string[]) => {
    setPending(labelIds.flatMap((id) => known.find((label) => label.id === id) ?? []))
    save.mutate({ labelIds, turn: ++latest.current })
  }
  return (
    <LabelPickerView
      labels={shown}
      options={options.data}
      onSet={set}
      onCreate={async (name) => {
        const created = await create.mutateAsync(name)
        setPending([...shown, created])
        save.mutate({ labelIds: [...shown.map((label) => label.id), created.id], turn: ++latest.current })
      }}
      error={save.error ? errorMessage(save.error) : create.error ? errorMessage(create.error) : null}
    />
  )
}
