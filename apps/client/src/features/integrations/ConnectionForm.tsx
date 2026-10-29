import { type ConnectionSettings, type IntegrationProvider, isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import { RiArrowRightUpLine, RiEyeLine, RiEyeOffLine, RiKey2Line } from "@remixicon/react"
import { type FormEvent, useId, useState } from "react"
import { RadioGroup } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { type ConnectionFields, EMPTY_FIELDS, validateConnection, validateSecret } from "./integrations"
import { DEFAULT_ADDRESS, Field, IssuePreview, MessagePreview, PROVIDER_GROUPS, ProviderOption, SECRET_SETUP } from "./IntegrationForm"
import type { Connection } from "./queries"

export interface ConnectionSubmit {
  provider: IntegrationProvider
  name: string
  settings: ConnectionSettings
  secret: string
}

function initialFields(provider: IntegrationProvider, connection?: Connection): ConnectionFields {
  const settings = (connection?.settings ?? {}) as Partial<ConnectionFields>
  return {
    ...EMPTY_FIELDS,
    ...settings,
    baseUrl: settings.baseUrl ?? DEFAULT_ADDRESS[provider] ?? "",
  }
}

/** An account or channel the workspace connects once; projects then pick it and their own target. */
export function ConnectionForm({
  connection,
  initialProvider = "github",
  busy,
  onSubmit,
  onCancel,
}: {
  connection?: Connection
  /** The provider picked from the empty page's cards. */
  initialProvider?: IntegrationProvider
  busy: boolean
  onSubmit(value: ConnectionSubmit): void
  onCancel(): void
}) {
  const tokenHint = useId()
  const [provider, setProvider] = useState<IntegrationProvider>(connection?.provider ?? initialProvider)
  const [name, setName] = useState(connection?.name ?? PROVIDER_LABELS[connection?.provider ?? initialProvider])
  const [fields, setFields] = useState(() => initialFields(connection?.provider ?? initialProvider, connection))
  const [secret, setSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = (key: keyof ConnectionFields) => ({ value: fields[key], onChange: (value: string) => setFields((current) => ({ ...current, [key]: value })) })
  const setup = SECRET_SETUP[provider]
  const tokenLink = setup.link?.(fields)

  const choose = (next: IntegrationProvider) => {
    // A name nobody typed follows the provider.
    if (name === PROVIDER_LABELS[provider]) setName(PROVIDER_LABELS[next])
    setProvider(next)
    setFields((current) => {
      // GitLab and Plane start at their cloud address; a default nobody changed does not follow to another provider.
      const untouched = !current.baseUrl || Object.values(DEFAULT_ADDRESS).includes(current.baseUrl)
      return untouched ? { ...current, baseUrl: DEFAULT_ADDRESS[next] ?? "" } : current
    })
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError("Give the connection a name")
    const result = validateConnection(provider, fields)
    if (!result.ok) return setError(result.error)
    const token = secret.trim()
    if (!connection && !token && !setup.optional) return setError(`Enter the ${setup.label.toLowerCase()}`)
    const secretError = token ? validateSecret(provider, token) : null
    if (secretError) return setError(secretError)
    setError(null)
    onSubmit({ provider, name: name.trim(), settings: result.settings, secret: token })
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <form onSubmit={submit} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
        <div className="flex flex-col gap-1 border-b border-border px-6 py-5 sm:px-8">
          <h2 className="font-heading text-lg font-semibold text-foreground">{connection ? "Edit connection" : "New connection"}</h2>
          <p className="text-sm text-muted-foreground">Connect it once; every project in the workspace can then use it.</p>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6 sm:px-8">
          <RadioGroup
            aria-label="Provider"
            value={provider}
            isDisabled={Boolean(connection)}
            onChange={(value) => choose(value as IntegrationProvider)}
            className="flex flex-col gap-4"
          >
            <span className="text-sm font-medium text-foreground">Provider</span>
            {PROVIDER_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <ProviderOption key={item} provider={item} />
                  ))}
                </div>
              </div>
            ))}
          </RadioGroup>

          <TextField value={name} onChange={setName}>
            <Label>Name</Label>
            <Input placeholder={`${PROVIDER_LABELS[provider]} Kantor`} />
          </TextField>

          {(provider === "gitlab" || provider === "activecollab") && (
            <TextField {...text("baseUrl")}>
              <Label>{PROVIDER_LABELS[provider]} address</Label>
              <Input placeholder={DEFAULT_ADDRESS[provider] ?? "https://ac.example.com"} className="font-mono" />
            </TextField>
          )}
          {provider === "plane" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField {...text("baseUrl")}>
                <Label>Plane address</Label>
                <Input placeholder={DEFAULT_ADDRESS.plane} className="font-mono" />
              </TextField>
              <TextField {...text("workspaceSlug")}>
                <Label>Workspace slug</Label>
                <Input placeholder="my-team" className="font-mono" />
              </TextField>
            </div>
          )}
          {provider === "jira" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField {...text("siteUrl")}>
                <Label>Jira site</Label>
                <Input placeholder="https://yourteam.atlassian.net" className="font-mono" />
              </TextField>
              <TextField type="email" {...text("email")}>
                <Label>Atlassian account email</Label>
                <Input placeholder="you@example.com" />
              </TextField>
            </div>
          )}
          {provider === "webhook" && (
            <TextField type="url" {...text("url")}>
              <Label>Webhook URL</Label>
              <Input placeholder="https://example.com/bugberry" className="font-mono" />
            </TextField>
          )}

          <Field
            label={setup.label}
            aside={
              tokenLink && (
                <a href={tokenLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Create one on {PROVIDER_LABELS[provider]}
                  <RiArrowRightUpLine aria-hidden className="size-4" />
                </a>
              )
            }
          >
            <TextField
              aria-label={setup.label}
              aria-describedby={tokenHint}
              type={showSecret ? "text" : "password"}
              autoComplete="off"
              value={secret}
              onChange={setSecret}
            >
              <InputGroup>
                <Input placeholder={connection ? "Leave empty to keep the current one" : setup.placeholder} className="font-mono" />
                <Button
                  intent="plain"
                  size="sq-xs"
                  aria-label={showSecret ? "Hide token" : "Show token"}
                  onPress={() => setShowSecret((shown) => !shown)}
                  className="me-1"
                >
                  {showSecret ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
                </Button>
              </InputGroup>
            </TextField>
            <p id={tokenHint} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RiKey2Line aria-hidden className="size-3.5 shrink-0" />
              {setup.hint}
            </p>
          </Field>
          {isTrackerProvider(provider) && (
            <p className="text-xs text-muted-foreground">
              Anyone in the workspace can point a project at what this token reaches, so give it only the access projects should have.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger-subtle-foreground">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/50 px-6 py-4 sm:px-8">
          <Button intent="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy}>
            Save connection
          </Button>
        </div>
      </form>

      {isTrackerProvider(provider) ? <IssuePreview provider={provider} labels={[]} /> : <MessagePreview provider={provider} />}
    </div>
  )
}
