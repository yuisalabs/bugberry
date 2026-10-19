import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@bugberry/ui/button"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Tab, TabList, TabPanel, Tabs } from "@bugberry/ui/tabs"
import { TextField } from "@bugberry/ui/text-field"
import { useState } from "react"
import { CopyButton, ErrorState, Loading } from "../../components/ui"
import { errorMessage } from "../../lib/api"
import { api } from "../../lib/client"
import { formatDateTime } from "../../lib/format"

export interface TokenRow {
  id: string
  label: string
  createdAt: Date | string
  lastUsedAt: Date | string | null
}

export interface ConnectedApp {
  clientId: string
  name: string
  uri: string | null
  scopes: string[]
  grantedAt: Date | string | null
  lastUsedAt: Date | string | null
}

/** How to add the server in each AI app: what to paste, and where. */
export function connectSnippets(url: string): Array<{ id: string; label: string; where: string; code: string }> {
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  return [
    { id: "claude-code", label: "Claude Code", where: "Run in a terminal, then sign in when Claude Code asks.", code: `claude mcp add --transport http bugberry ${url}` },
    { id: "claude-ai", label: "Claude.ai", where: "Settings → Connectors → Add custom connector, then paste this URL.", code: url },
    { id: "cursor", label: "Cursor", where: "Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).", code: json({ mcpServers: { bugberry: { url } } }) },
    { id: "vscode", label: "VS Code", where: "Add to .vscode/mcp.json, or run “MCP: Add Server” and choose HTTP.", code: json({ servers: { bugberry: { type: "http", url } } }) },
    { id: "windsurf", label: "Windsurf", where: "Add to ~/.codeium/windsurf/mcp_config.json.", code: json({ mcpServers: { bugberry: { serverUrl: url } } }) },
    { id: "chatgpt", label: "ChatGPT", where: "Settings → Connectors → Create, then paste this URL.", code: url },
  ]
}

const when = (value: Date | string | null) => (value ? formatDateTime(value) : "never")

export function AiAgentsView({
  origin,
  tokens,
  apps,
  newToken,
  busy,
  error,
  onCreateToken,
  onRevokeToken,
  onRevokeApp,
  onDismissToken,
}: {
  origin: string
  tokens: readonly TokenRow[]
  apps: readonly ConnectedApp[]
  newToken: string | null
  busy: boolean
  error: string | null
  onCreateToken(label: string): void
  onRevokeToken(id: string): void
  onRevokeApp(clientId: string): void
  onDismissToken(): void
}) {
  const url = `${origin}/api/mcp`
  const [label, setLabel] = useState("")
  const trimmed = label.trim()

  return (
    <section className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">AI agents (MCP)</h1>
        <p className="text-sm text-muted-foreground">
          Let AI apps like Claude Code or Cursor read your reports and work on them: paste a report link into the agent and it can see
          the console, network, user actions and the code that failed, then comment or update the report for you. Agents see only what
          you can see.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-base font-semibold text-foreground">Server URL</h2>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm text-foreground">{url}</code>
          <CopyButton text={url} label="Copy URL" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-base font-semibold text-foreground">Connect an app</h2>
        <Tabs defaultSelectedKey="claude-code" className="gap-3">
          <TabList aria-label="AI apps">
            {connectSnippets(url).map((item) => (
              <Tab key={item.id} id={item.id}>
                {item.label}
              </Tab>
            ))}
          </TabList>
          {connectSnippets(url).map((item) => (
            <TabPanel key={item.id} id={item.id} className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{item.where}</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">{item.code}</pre>
              <CopyButton text={item.code} label="Copy" />
            </TabPanel>
          ))}
        </Tabs>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-base font-semibold text-foreground">Connected apps</h2>
        {apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI apps connected yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {apps.map((app) => (
              <li key={app.clientId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{app.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {app.scopes.includes("bugberry:write") ? "Can read and change" : "Can read"} · allowed {when(app.grantedAt)} · last
                    renewed {when(app.lastUsedAt)}
                  </span>
                </div>
                <Button
                  size="sm"
                  intent="outline"
                  isDisabled={busy}
                  onPress={() => {
                    if (window.confirm(`Disconnect ${app.name}? It loses access right away.`)) onRevokeApp(app.clientId)
                  }}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold text-foreground">Personal tokens</h2>
          <p className="text-sm text-muted-foreground">For clients without OAuth. Send it as "Authorization: Bearer &lt;token&gt;".</p>
        </div>
        {newToken && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3">
            <p className="text-sm font-medium text-foreground">Copy it now. You won't see it again.</p>
            <code className="break-all font-mono text-sm text-foreground">{newToken}</code>
            <div className="flex gap-2">
              <CopyButton text={newToken} label="Copy token" />
              <Button size="sm" intent="plain" onPress={onDismissToken}>
                Done
              </Button>
            </div>
          </div>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed) {
              onCreateToken(trimmed)
              setLabel("")
            }
          }}
        >
          <TextField value={label} maxLength={60} onChange={setLabel}>
            <Label>Token name</Label>
            <div className="flex gap-2">
              <Input placeholder="e.g. CI bot" />
              <Button size="sm" type="submit" isDisabled={busy || !trimmed}>
                Create token
              </Button>
            </div>
            <Description>It only works with the MCP server, not the rest of the BugBerry API.</Description>
          </TextField>
        </form>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No personal tokens.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{token.label}</span>
                  <span className="text-xs text-muted-foreground">
                    Created {when(token.createdAt)} · last used {when(token.lastUsedAt)}
                  </span>
                </div>
                <Button
                  size="sm"
                  intent="outline"
                  isDisabled={busy}
                  onPress={() => {
                    if (window.confirm(`Revoke "${token.label}"? Apps using it stop working.`)) onRevokeToken(token.id)
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </section>
  )
}

/** `/app/settings/ai`: connect AI apps to the MCP server, see which are connected, and manage personal tokens. */
export function AiAgentsPage() {
  const queryClient = useQueryClient()
  const tokens = useQuery({ queryKey: ["mcp-tokens"], queryFn: () => api.mcpTokens() })
  const apps = useQuery({ queryKey: ["oauth-apps"], queryFn: () => api.oauthApps() })
  const [newToken, setNewToken] = useState<string | null>(null)
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] }), queryClient.invalidateQueries({ queryKey: ["oauth-apps"] })])

  const create = useMutation({
    mutationFn: (label: string) => api.createMcpToken(label),
    onSuccess: async (created) => {
      setNewToken(created.token)
      await refresh()
    },
  })
  const revokeToken = useMutation({ mutationFn: (id: string) => api.revokeMcpToken(id), onSuccess: refresh })
  const revokeApp = useMutation({ mutationFn: (clientId: string) => api.revokeOAuthApp(clientId), onSuccess: refresh })

  if (tokens.isPending || apps.isPending) return <Loading />
  if (tokens.isError || apps.isError) {
    return (
      <ErrorState
        error={tokens.error ?? apps.error}
        onRetry={() => {
          void tokens.refetch()
          void apps.refetch()
        }}
      />
    )
  }
  const failed = create.error ?? revokeToken.error ?? revokeApp.error
  return (
    <AiAgentsView
      origin={window.location.origin}
      tokens={tokens.data}
      apps={apps.data}
      newToken={newToken}
      busy={create.isPending || revokeToken.isPending || revokeApp.isPending}
      error={failed ? errorMessage(failed) : null}
      onCreateToken={(label) => create.mutate(label)}
      onRevokeToken={(id) => revokeToken.mutate(id)}
      onRevokeApp={(clientId) => revokeApp.mutate(clientId)}
      onDismissToken={() => setNewToken(null)}
    />
  )
}
