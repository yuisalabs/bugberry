import { isTrackerProvider, PROVIDER_LABELS, type UseTarget } from "@bugberry/shared"
import { RiCheckboxCircleLine, RiSearchLine } from "@remixicon/react"
import { useEffect, useState } from "react"
import { Radio as CardRadio, RadioGroup as CardRadioGroup } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { SearchField } from "@bugberry/ui/search-field"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { TextField } from "@bugberry/ui/text-field"
import { type Connection, errorMessage, type Integration, type IntegrationInput, type OptionList } from "../lib/api"
import { validateChatId } from "../lib/integrations"
import { PROVIDER_GROUPS, ProviderMark } from "./IntegrationForm"

export interface Option {
  value: string
  label: string
}

export type LoadOptions = (connectionId: string, list: OptionList, q: string, parent: string) => Promise<Option[]>

/** What the first list of each tracker holds. */
const TARGET_NOUN: Record<string, string> = {
  github: "Repository",
  gitlab: "Project",
  linear: "Team",
  jira: "Project",
  plane: "Project",
  activecollab: "Project",
}

/** A list fetched from the connection's account: searchable when long, and never silently empty. */
function OptionPicker({
  label,
  connectionId,
  list,
  parent = "",
  searchable = false,
  loadOptions,
  value,
  onChange,
}: {
  label: string
  connectionId: string
  list: OptionList
  parent?: string
  searchable?: boolean
  loadOptions: LoadOptions
  value: string | null
  /** The picked value, and its label as the list showed it. */
  onChange(value: string, label: string): void
}) {
  const [q, setQ] = useState("")
  const [state, setState] = useState<{ options: Option[] | null; error: string | null }>({ options: null, error: null })

  useEffect(() => {
    let current = true
    // Typing waits a moment before asking the provider again; the first list comes at once.
    const timer = setTimeout(
      () => {
        loadOptions(connectionId, list, q, parent).then(
          (options) => current && setState({ options, error: null }),
          (error: unknown) => current && setState({ options: [], error: error instanceof Error ? error.message : errorMessage(error) }),
        )
      },
      q ? 250 : 0,
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [connectionId, list, parent, q, loadOptions])

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {searchable && (
        <SearchField aria-label={`Search ${label.toLowerCase()}`} value={q} onChange={setQ}>
          {/* Like the debugger's filters: InputGroup only places icons marked as icons inside the box. */}
          <InputGroup>
            <RiSearchLine aria-hidden data-slot="icon" />
            <Input placeholder={`Search ${label.toLowerCase()}…`} />
          </InputGroup>
        </SearchField>
      )}
      {state.error ? (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {state.error}
        </p>
      ) : state.options === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : state.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to pick: the account reaches none, or nothing matches.</p>
      ) : (
        <RadioGroup
          aria-label={label}
          value={value}
          onChange={(picked) => onChange(picked, state.options?.find((option) => option.value === picked)?.label ?? picked)}
          className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {state.options.map((option) => (
            <RadioField key={option.value} value={option.value}>
              <Radio>{option.label}</Radio>
            </RadioField>
          ))}
        </RadioGroup>
      )}
    </div>
  )
}

const MAX_LABELS = 10

/** The target's own labels, ticked on or off. */
function LabelPicker({
  connectionId,
  parent,
  loadOptions,
  value,
  onChange,
}: {
  connectionId: string
  parent: string
  loadOptions: LoadOptions
  value: string[]
  onChange(labels: string[]): void
}) {
  const [state, setState] = useState<{ options: Option[] | null; error: string | null }>({ options: null, error: null })
  useEffect(() => {
    let current = true
    loadOptions(connectionId, "labels", "", parent).then(
      (options) => current && setState({ options, error: null }),
      (error: unknown) => current && setState({ options: [], error: error instanceof Error ? error.message : errorMessage(error) }),
    )
    return () => {
      current = false
    }
  }, [connectionId, parent, loadOptions])
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger-subtle-foreground">
        {state.error}
      </p>
    )
  }
  if (!state.options?.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Labels</span>
        <span className="text-xs text-muted-foreground">Up to {MAX_LABELS} labels</span>
      </span>
      <div className="flex max-h-40 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">
        {state.options.map((option) => (
          <CheckboxField
            key={option.value}
            isSelected={value.includes(option.value)}
            // The server takes at most 10; past that only unticking works.
            isDisabled={value.length >= MAX_LABELS && !value.includes(option.value)}
            onChange={(on) => onChange(on ? [...value, option.value] : value.filter((label) => label !== option.value))}
          >
            <Checkbox>{option.label}</Checkbox>
          </CheckboxField>
        ))}
      </div>
    </div>
  )
}

function AutoSendSwitch({ value, onChange }: { value: boolean; onChange(value: boolean): void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3">
      <span className="text-sm text-foreground">Send every new report automatically</span>
      <SwitchField aria-label="Send every new report automatically" isSelected={value} onChange={onChange}>
        <Switch />
      </SwitchField>
    </div>
  )
}

/** The picks of step 2, turned into the target the server stores. Null with a reason while something is missing. */
function buildTarget(
  provider: Connection["provider"],
  picks: { target: string | null; targetLabel: string; second: string | null; labels: string[]; chatId: string },
): { target: UseTarget } | { error: string } {
  const noun = (TARGET_NOUN[provider] ?? "target").toLowerCase()
  if (provider === "telegram") {
    const chatId = validateChatId(picks.chatId)
    return chatId ? { target: { chatId } } : { error: "Enter a chat id, such as -1001234567890, or a channel's @name" }
  }
  if (!isTrackerProvider(provider)) return { target: {} }
  if (!picks.target) return { error: `Pick a ${noun} first` }
  if (provider === "github") {
    const slash = picks.target.indexOf("/")
    return { target: { owner: picks.target.slice(0, slash), repo: picks.target.slice(slash + 1), labels: picks.labels } }
  }
  if (provider === "gitlab") return { target: { projectPath: picks.target, labels: picks.labels } }
  if (provider === "plane") return { target: { projectId: picks.target, projectName: picks.targetLabel, labels: picks.labels } }
  if (provider === "linear") return { target: { teamKey: picks.target, labels: picks.labels } }
  if (provider === "jira") {
    if (!picks.second) return { error: "Pick an issue type" }
    return { target: { projectKey: picks.target, issueType: picks.second, labels: picks.labels } }
  }
  if (!picks.second) return { error: "Pick a task list" }
  return { target: { projectId: Number(picks.target), taskListId: Number(picks.second) } }
}

/**
 * Use a connection in a project, in two steps: pick one of the workspace's connections, then where it sends.
 * A channel without a target (Slack, Discord, Webhook) can be used once per project.
 */
export function UseConnectionSteps({
  connections,
  used,
  initialConnectionId,
  loadOptions,
  busy,
  onSubmit,
  onCancel,
}: {
  connections: Connection[]
  used: Integration[]
  /** A connection picked before the dialog opened (its Use button): the dialog starts at step 2. */
  initialConnectionId?: string
  loadOptions: LoadOptions
  busy: boolean
  onSubmit(body: IntegrationInput): void
  onCancel(): void
}) {
  const [chosenId, setChosenId] = useState<string | null>(initialConnectionId ?? null)
  const [step, setStep] = useState<1 | 2>(initialConnectionId ? 2 : 1)
  const [target, setTarget] = useState<string | null>(null)
  // The picked target as the list named it: Plane keeps it to show "Website (WEB)" instead of an id.
  const [targetLabel, setTargetLabel] = useState("")
  const [second, setSecond] = useState<string | null>(null)
  const [labels, setLabels] = useState<string[]>([])
  const [chatId, setChatId] = useState("")
  const [autoSend, setAutoSend] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = connections.find((item) => item.id === chosenId)
  const blocked = (connection: Connection) =>
    !isTrackerProvider(connection.provider) && connection.provider !== "telegram" && used.some((use) => use.connection.id === connection.id)

  if (step === 1 || !chosen) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">Connections are set up by workspace admins in Settings.</p>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">The workspace has no connections yet. Ask an admin to add one under Settings, Integrations.</p>
        ) : (
          <CardRadioGroup aria-label="Connection" value={chosenId} onChange={setChosenId} className="flex flex-col gap-4">
            {PROVIDER_GROUPS.map((group) => {
              const items = connections.filter((item) => (group.items as readonly string[]).includes(item.provider))
              if (items.length === 0) return null
              return (
                <div key={group.title} className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</span>
                  {items.map((item) => (
                    <CardRadio
                      key={item.id}
                      value={item.id}
                      isDisabled={blocked(item)}
                      className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 outline-hidden transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 selected:border-primary selected:ring-2 selected:ring-primary/20"
                    >
                      {({ isSelected }) => (
                        <>
                          <ProviderMark provider={item.provider} className="size-8" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium text-foreground">{item.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {blocked(item) ? "Already used in this project" : PROVIDER_LABELS[item.provider]}
                            </span>
                          </span>
                          {isSelected && <RiCheckboxCircleLine aria-hidden className="size-5 text-primary" />}
                        </>
                      )}
                    </CardRadio>
                  ))}
                </div>
              )
            })}
          </CardRadioGroup>
        )}
        <div className="flex justify-end gap-3">
          <Button intent="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button isDisabled={!chosen} onPress={() => setStep(2)}>
            Next
          </Button>
        </div>
      </div>
    )
  }

  const provider = chosen.provider
  const tracker = isTrackerProvider(provider)
  const submit = () => {
    const result = buildTarget(provider, { target, targetLabel, second, labels, chatId })
    if ("error" in result) return setError(result.error)
    setError(null)
    onSubmit({ connectionId: chosen.id, target: result.target, autoSend: tracker && autoSend })
  }
  const back = () => {
    setStep(1)
    setTarget(null)
    setSecond(null)
    setLabels([])
    setError(null)
  }
  const labelParent = provider === "jira" ? "" : (target ?? "")

  return (
    <div className="flex flex-col gap-5">
      {tracker && (
        <OptionPicker
          label={TARGET_NOUN[provider] ?? "Target"}
          connectionId={chosen.id}
          list="targets"
          searchable
          loadOptions={loadOptions}
          value={target}
          onChange={(value, label) => {
            setTarget(value)
            setTargetLabel(label)
            setSecond(null)
            setLabels([])
          }}
        />
      )}
      {provider === "jira" && target && (
        // Keyed by the project, so another project's issue types never show while its own load.
        <OptionPicker
          key={`issueTypes-${target}`}
          label="Issue type"
          connectionId={chosen.id}
          list="issueTypes"
          parent={target}
          loadOptions={loadOptions}
          value={second}
          onChange={setSecond}
        />
      )}
      {provider === "activecollab" && target && (
        <OptionPicker
          key={`taskLists-${target}`}
          label="Task list"
          connectionId={chosen.id}
          list="taskLists"
          parent={target}
          loadOptions={loadOptions}
          value={second}
          onChange={setSecond}
        />
      )}
      {tracker && provider !== "activecollab" && (provider === "jira" || target) && (
        <LabelPicker key={labelParent} connectionId={chosen.id} parent={labelParent} loadOptions={loadOptions} value={labels} onChange={setLabels} />
      )}
      {tracker && <AutoSendSwitch value={autoSend} onChange={setAutoSend} />}
      {provider === "telegram" && (
        <TextField value={chatId} onChange={setChatId}>
          <Label>Chat ID</Label>
          <Input placeholder="-1001234567890 or @channel" className="font-mono" />
        </TextField>
      )}
      {!tracker && provider !== "telegram" && (
        <p className="text-sm text-muted-foreground">
          Nothing else to set: the channel is part of the connection. You can send a test message after adding it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button intent="outline" onPress={back}>
          Back
        </Button>
        <Button isDisabled={busy} onPress={submit}>
          Use {chosen.name}
        </Button>
      </div>
    </div>
  )
}

/** Editing a use changes its labels and auto-send; a different target is a new use. */
export function EditIntegrationSteps({
  integration,
  loadOptions,
  busy,
  onSubmit,
  onCancel,
}: {
  integration: Integration
  loadOptions: LoadOptions
  busy: boolean
  onSubmit(body: { labels?: string[]; autoSend: boolean }): void
  onCancel(): void
}) {
  const target = integration.target as Partial<{ owner: string; repo: string; projectPath: string; teamKey: string; labels: string[] }>
  const [labels, setLabels] = useState<string[]>(target.labels ?? [])
  const [autoSend, setAutoSend] = useState(integration.autoSend)
  const parent =
    integration.provider === "github"
      ? `${target.owner}/${target.repo}`
      : integration.provider === "gitlab"
        ? (target.projectPath ?? "")
        : integration.provider === "linear"
          ? (target.teamKey ?? "")
          : ""
  const hasLabels = "labels" in integration.target
  return (
    <div className="flex flex-col gap-5">
      {hasLabels && (
        <LabelPicker connectionId={integration.connection.id} parent={parent} loadOptions={loadOptions} value={labels} onChange={setLabels} />
      )}
      <AutoSendSwitch value={autoSend} onChange={setAutoSend} />
      <div className="flex justify-end gap-3">
        <Button intent="outline" onPress={onCancel}>
          Cancel
        </Button>
        <Button isDisabled={busy} onPress={() => onSubmit({ ...(hasLabels ? { labels } : {}), autoSend })}>
          Save
        </Button>
      </div>
    </div>
  )
}

/**
 * The dialog around the steps. Cancel, the close button and a click outside all go through `onClose`, so whatever the
 * page clears on close (such as the last save error) is cleared however the dialog was left.
 */
export function UseConnectionModal({
  isOpen,
  error,
  connections,
  initialConnectionId,
  used,
  loadOptions,
  busy,
  onSubmit,
  onClose,
}: {
  isOpen: boolean
  error: string | null
  /** Undefined while the workspace's connections load. */
  connections: Connection[] | undefined
  initialConnectionId?: string
  used: Integration[]
  loadOptions: LoadOptions
  busy: boolean
  onSubmit(body: IntegrationInput): void
  onClose(): void
}) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} aria-label="Use a connection" size="lg">
      <DialogHeader>
        <DialogTitle>Use a connection</DialogTitle>
      </DialogHeader>
      <DialogBody className="pb-6">
        {error && (
          <p role="alert" className="mb-4 text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
        {connections === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <UseConnectionSteps
            connections={connections}
            used={used}
            initialConnectionId={initialConnectionId}
            loadOptions={loadOptions}
            busy={busy}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        )}
      </DialogBody>
    </Dialog>
  )
}
