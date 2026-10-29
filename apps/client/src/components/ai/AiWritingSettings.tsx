import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, type ReactNode, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { TextField } from "@bugberry/ui/text-field"
import type { AiProviderInput, AiSettingsPatch, AiSetup } from "../../lib/api"
import { api } from "../../lib/client"
import { useCurrentWorkspace } from "../../lib/workspace"
import { SettingsRowsSkeleton } from "../Skeletons"
import { ErrorState } from "../ui"
import { TemplatesList } from "./TemplatesList"
import { queries } from "../../lib/queries"
import { errorMessage } from "../../lib/query/unwrap"

const card = "flex flex-col gap-5 rounded-2xl border border-border bg-background p-6 shadow-xs sm:p-8"
const cardTitle = "font-heading text-lg font-semibold text-foreground"
/** The project picker's choice for "use the workspace's default". */
const WORKSPACE_DEFAULT = "__workspace"

type Team = AiSetup["team"] & { preset?: "openai" | "custom"; baseUrl?: string; model?: string; keyHint?: string }

function ProviderForm({ team, onSave }: { team: Team; onSave(input: AiProviderInput): Promise<void> }) {
  const [preset, setPreset] = useState<"openai" | "custom">(team.preset ?? "openai")
  const [baseUrl, setBaseUrl] = useState(team.preset === "custom" ? (team.baseUrl ?? "") : "")
  const [model, setModel] = useState(team.model ?? "")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (preset === "custom" && !baseUrl.trim()) return setError("Enter the provider's base URL")
    if (!model.trim()) return setError("Enter the model, for example gpt-4.1-mini")
    if (!team.configured && !apiKey.trim()) return setError("Enter the API key")
    setError(null)
    setSaving(true)
    try {
      await onSave({
        preset,
        ...(preset === "custom" ? { baseUrl: baseUrl.trim() } : {}),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setApiKey("")
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <RadioGroup aria-label="Provider" value={preset} onChange={(value) => setPreset(value as "openai" | "custom")} className="flex flex-col gap-2">
        <RadioField value="openai">
          <Radio>OpenAI</Radio>
        </RadioField>
        <RadioField value="custom">
          <Radio>OpenAI-compatible</Radio>
        </RadioField>
      </RadioGroup>
      {preset === "custom" && (
        <TextField value={baseUrl} onChange={setBaseUrl}>
          <Label>Base URL</Label>
          <Input placeholder="https://ai.example.com/v1" className="font-mono" />
          <Description>Any server with an OpenAI-style /chat/completions, reachable from the BugBerry server.</Description>
        </TextField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField value={model} onChange={setModel}>
          <Label>Model</Label>
          <Input placeholder="gpt-4.1-mini" className="font-mono" />
        </TextField>
        <TextField type="password" value={apiKey} onChange={setApiKey}>
          <Label>API key</Label>
          <Input placeholder={team.configured ? "Leave empty to keep the saved key" : "sk-…"} className="font-mono" autoComplete="off" />
          {team.keyHint && (
            <Description>
              Saved key: <span className="font-mono">{team.keyHint}</span>
            </Description>
          )}
        </TextField>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" isPending={saving}>
          Test and save
        </Button>
      </div>
    </form>
  )
}

/** Settings → AI, Write with AI: the team key, what is sent, and which template each project starts with. */
export function AiWritingSettingsView({
  setup,
  projects,
  onSaveProvider,
  onRemoveProvider,
  onChangeSettings,
  children,
}: {
  setup: AiSetup
  projects: Array<{ id: string; name: string }>
  onSaveProvider(input: AiProviderInput): Promise<void>
  onRemoveProvider(): Promise<void>
  onChangeSettings(patch: AiSettingsPatch): Promise<void>
  /** The templates list. */
  children?: ReactNode
}) {
  const admin = setup.role === "admin"
  const team = setup.team as Team
  const templateItems = setup.templates.map((template) => ({ id: template.id, name: template.name }))
  const ownDefault = (projectId: string) => setup.projectDefaults.find((entry) => entry.projectId === projectId)?.templateId ?? null

  return (
    <div className="flex flex-col gap-6">
      <section className={card}>
        <div className="flex flex-col gap-1">
          <h2 className={cardTitle}>Team AI key</h2>
          <p className="text-sm text-muted-foreground">
            Write with AI drafts a report's title and steps to reproduce in the extension, from the recording. Bring your own OpenAI key or any
            OpenAI-compatible provider. A ChatGPT subscription is not an API key.
          </p>
        </div>
        {admin ? (
          <>
            <ProviderForm key={`${team.preset}-${team.model}-${team.keyHint}`} team={team} onSave={onSaveProvider} />
            {team.configured && (
              <div>
                <Button intent="plain" size="sm" onPress={() => void onRemoveProvider()}>
                  Remove the team key
                </Button>
              </div>
            )}
          </>
        ) : team.configured ? (
          <p className="text-sm text-foreground">Your admin has set up a team AI key.</p>
        ) : (
          <p className="text-sm text-foreground">No team AI key yet: an admin sets it here. You can also add your own key in the extension's settings.</p>
        )}
      </section>

      {admin && (
        <section className={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className={cardTitle}>Send response bodies to AI</h2>
              <p className="text-sm text-muted-foreground">
                Failed requests' response bodies can help the AI explain an error. They may contain personal data such as names or emails, which is
                not redacted. Request bodies, headers and typed values are never sent.
              </p>
            </div>
            <SwitchField
              aria-label="Send response bodies to AI"
              isSelected={setup.sendResponseBodies}
              onChange={(on) => void onChangeSettings({ sendResponseBodies: on })}
            >
              <Switch />
            </SwitchField>
          </div>
        </section>
      )}

      {admin && setup.templates.length > 0 && (
        <section className={card}>
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Default templates</h2>
            <p className="text-sm text-muted-foreground">The template a report starts with in the extension. The reporter can pick another.</p>
          </div>
          <Select
            selectedKey={setup.defaultTemplateId}
            onSelectionChange={(key) => key !== null && void onChangeSettings({ defaultTemplateId: String(key) })}
          >
            <Label>Workspace default</Label>
            <SelectTrigger />
            <SelectContent items={templateItems}>{(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}</SelectContent>
          </Select>
          {projects.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-5">
              <h3 className="font-heading text-base font-semibold text-foreground">Per project</h3>
              <p className="text-sm text-muted-foreground">Reports from a project's pages start with its template.</p>
            </div>
          )}
          {projects.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((entry) => (
                <Select
                  key={entry.id}
                  selectedKey={ownDefault(entry.id) ?? WORKSPACE_DEFAULT}
                  onSelectionChange={(key) =>
                    key !== null &&
                    void onChangeSettings({ projectDefaults: [{ projectId: entry.id, templateId: key === WORKSPACE_DEFAULT ? null : String(key) }] })
                  }
                >
                  <Label>{entry.name}</Label>
                  <SelectTrigger />
                  <SelectContent items={[{ id: WORKSPACE_DEFAULT, name: "Use the workspace default" }, ...templateItems]}>
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </SelectContent>
                </Select>
              ))}
            </div>
          )}
        </section>
      )}

      {children}
    </div>
  )
}

/** The section wired to the current workspace. */
export function AiWritingSettings() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const setup = useQuery({ ...queries.ai(workspaceId), enabled: Boolean(workspace) })
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(workspace) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai", workspaceId] })
  const settings = useMutation({ mutationFn: (patch: AiSettingsPatch) => api.updateAiSettings(workspaceId, patch), onSettled: refresh })

  if (setup.isPending) return <SettingsRowsSkeleton />
  if (setup.isError) return <ErrorState error={setup.error} onRetry={() => void setup.refetch()} />
  return (
    <AiWritingSettingsView
      setup={setup.data}
      projects={(projects.data ?? []).map((entry) => ({ id: entry.id, name: entry.name }))}
      onSaveProvider={async (input) => {
        await api.saveAiProvider(workspaceId, input)
        await refresh()
      }}
      onRemoveProvider={async () => {
        await api.removeAiProvider(workspaceId)
        await refresh()
      }}
      onChangeSettings={async (patch) => {
        await settings.mutateAsync(patch)
      }}
    >
      <TemplatesList workspaceId={workspaceId} setup={setup.data} />
    </AiWritingSettingsView>
  )
}
