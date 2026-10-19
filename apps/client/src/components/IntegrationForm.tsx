import { PROVIDER_LABELS, TRACKER_PROVIDERS, type TrackerConfig, type TrackerProvider } from "@bugberry/shared"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import type { Integration } from "../lib/api"
import { type IntegrationFields, validateIntegration } from "../lib/integrations"

export interface IntegrationSubmit {
  provider: TrackerProvider
  config: TrackerConfig
  secret: string
  autoSend: boolean
}

function initialFields(integration?: Integration): IntegrationFields {
  const config = integration?.config
  return {
    owner: config && "owner" in config ? config.owner : "",
    repo: config && "repo" in config ? config.repo : "",
    labels: config && "labels" in config ? config.labels.join(", ") : "",
    baseUrl: config && "baseUrl" in config ? config.baseUrl : "",
    projectId: config && "projectId" in config ? String(config.projectId) : "",
    taskListId: config && "taskListId" in config ? String(config.taskListId) : "",
  }
}

export function IntegrationForm({
  integration,
  busy,
  onSubmit,
  onCancel,
}: {
  integration?: Integration
  busy: boolean
  onSubmit(value: IntegrationSubmit): void
  onCancel(): void
}) {
  const [provider, setProvider] = useState<TrackerProvider>(integration?.provider ?? "github")
  const [fields, setFields] = useState(() => initialFields(integration))
  const [secret, setSecret] = useState("")
  const [autoSend, setAutoSend] = useState(integration?.autoSend ?? false)
  const [error, setError] = useState<string | null>(null)
  const update = (changes: Partial<IntegrationFields>) => setFields((current) => ({ ...current, ...changes }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateIntegration(provider, fields)
    if (!result.ok) return setError(result.error)
    if (!integration && !secret.trim()) return setError("Enter a token")
    setError(null)
    onSubmit({ provider, config: result.config, secret: secret.trim(), autoSend })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <Select
        selectedKey={provider}
        isDisabled={Boolean(integration)}
        onSelectionChange={(key) => key && setProvider(key as TrackerProvider)}
      >
        <Label>Provider</Label>
        <SelectTrigger />
        <SelectContent>
          {TRACKER_PROVIDERS.map((item) => (
            <SelectItem key={item} id={item}>
              {PROVIDER_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {provider === "github" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField value={fields.owner} onChange={(owner) => update({ owner })}>
            <Label>Owner</Label>
            <Input />
          </TextField>
          <TextField value={fields.repo} onChange={(repo) => update({ repo })}>
            <Label>Repo</Label>
            <Input />
          </TextField>
          <TextField value={fields.labels} onChange={(labels) => update({ labels })}>
            <Label>Label</Label>
            <Input placeholder="bug, bugberry" />
          </TextField>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField value={fields.baseUrl} onChange={(baseUrl) => update({ baseUrl })}>
            <Label>ActiveCollab address</Label>
            <Input placeholder="https://ac.example.com" />
          </TextField>
          <TextField inputMode="numeric" value={fields.projectId} onChange={(projectId) => update({ projectId })}>
            <Label>Project ID</Label>
            <Input />
          </TextField>
          <TextField inputMode="numeric" value={fields.taskListId} onChange={(taskListId) => update({ taskListId })}>
            <Label>Task list ID</Label>
            <Input />
          </TextField>
        </div>
      )}
      <TextField type="password" autoComplete="off" value={secret} onChange={setSecret}>
        <Label>Token</Label>
        <Input placeholder={integration ? "Leave empty to keep the current token" : undefined} />
        <Description className="text-xs">
          {provider === "github"
            ? "Use a fine-grained personal access token with Issues: Read and write access to this repo."
            : "Use an ActiveCollab API token from an account that can create tasks in this project."}
        </Description>
      </TextField>
      <CheckboxField isSelected={autoSend} onChange={setAutoSend}>
        <Checkbox>Send every new report automatically</Checkbox>
      </CheckboxField>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" isDisabled={busy}>
          Save integration
        </Button>
        <Button size="sm" intent="outline" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
