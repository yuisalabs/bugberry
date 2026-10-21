import { RiBookOpenLine, RiChat3Line, RiPlugLine, RiServerLine, RiTerminalBoxLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { SettingsPageSkeleton } from "../../components/Skeletons"
import { CopyButton, ErrorState } from "../../components/ui"
import { errorMessage } from "../../lib/api"
import { api } from "../../lib/client"
import { DOCS_URL } from "../../lib/docs-url"
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

/** The prompt step 3 offers to copy; the person adds their report's link after it. */
export const AGENT_PROMPT = "Fix this bug: "

/**
 * The report links an agent can be given on this server, as the MCP server reads them (parseReportRef): the
 * report page's address and a share link. Both need this server's full origin.
 */
export function reportLinkForms(origin: string): Array<{ link: string; what: string }> {
  return [
    { link: `${origin}/app/r/…`, what: "the report's page" },
    { link: `${origin}/s/…`, what: "a share link" },
  ]
}

const card = "flex flex-col gap-5 rounded-2xl border border-border bg-background p-6 shadow-xs"
const cardTitle = "font-heading text-lg font-semibold text-foreground"
// A terminal look (the theme's ink as the background), so a command reads as something to paste.
// On phones Copy sits above the command (pt-14) so the command has the whole width; wider, it sits beside it.
const codeBlock = "relative rounded-xl bg-foreground p-4 pt-14 font-mono text-sm leading-6 text-background sm:pt-4 sm:pr-28"

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3">
      <h3 className="flex items-center gap-3 font-medium text-foreground">
        <span aria-hidden className="grid size-6 shrink-0 place-content-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
          {number}
        </span>
        {title}
      </h3>
      {children}
    </li>
  )
}

function ListRow({ title, meta, action }: { title: string; meta: string; action: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{meta}</span>
      </div>
      <span className="shrink-0">{action}</span>
    </li>
  )
}

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
  const snippets = connectSnippets(url)
  const [label, setLabel] = useState("")
  const trimmed = label.trim()

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">AI Agents (MCP)</h1>
          <p className="text-muted-foreground">
            Let AI apps like Claude Code or Cursor read your reports and work on them: paste a report link into the agent and it can see
            the console, network, user actions and the code that failed, then comment or update the report for you. Agents see only what
            you can see.
          </p>
        </div>
        <a href={`${DOCS_URL}/guide/ai-agents`} target="_blank" rel="noreferrer" className={buttonStyles({ intent: "outline", size: "sm" })}>
          <RiBookOpenLine aria-hidden />
          Read the docs
        </a>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <div className={card}>
          <h2 className={cardTitle}>Connect an app</h2>
          <ol className="flex flex-col gap-7">
            <Step number={1} title="Copy the server URL">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-2">
                  <RiServerLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <code className="truncate font-mono text-sm text-foreground">{url}</code>
                </div>
                <CopyButton text={url} label="Copy URL" className="h-auto" />
              </div>
            </Step>

            <Step number={2} title="Add it to your AI app">
              <Tabs defaultSelectedKey="claude-code" className="flex flex-col gap-3">
                <TabList aria-label="AI apps" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-6">
                  {snippets.map((item) => (
                    <Tab
                      key={item.id}
                      id={item.id}
                      className="cursor-default rounded-lg px-2 py-2 text-center text-sm whitespace-nowrap text-muted-foreground outline-hidden transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring selected:bg-background selected:font-medium selected:text-foreground selected:shadow-xs"
                    >
                      {item.label}
                    </Tab>
                  ))}
                </TabList>
                {snippets.map((item) => (
                  <TabPanel key={item.id} id={item.id} className="flex flex-col gap-3 outline-hidden">
                    <p className="flex items-start gap-2 text-sm text-foreground">
                      <RiTerminalBoxLine aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item.where}
                    </p>
                    <div className={codeBlock}>
                      <pre className="overflow-x-auto break-words whitespace-pre-wrap">
                        {item.id === "claude-code" && (
                          <span aria-hidden className="mr-3 text-primary select-none">
                            $
                          </span>
                        )}
                        <code>{item.code}</code>
                      </pre>
                      <CopyButton
                        text={item.code}
                        label="Copy"
                        className="absolute top-3 right-3 border-background/15 bg-background/10 text-background hover:bg-background/20"
                      />
                    </div>
                  </TabPanel>
                ))}
              </Tabs>
            </Step>

            <Step number={3} title="Paste a report link into your agent">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <RiChat3Line aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  {AGENT_PROMPT}
                  <span className="font-mono whitespace-nowrap text-primary">&lt;report link&gt;</span>
                </span>
                <CopyButton text={AGENT_PROMPT} label="Copy" className="bg-background" />
              </div>
              <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                <span>A report link is either:</span>
                <ul className="flex flex-col gap-1">
                  {reportLinkForms(origin).map((form) => (
                    <li key={form.link} className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono break-all text-foreground">{form.link}</code>
                      <span>{form.what}</span>
                    </li>
                  ))}
                </ul>
                <span>
                  A number like <code className="font-mono text-foreground">BB-123</code> works too.
                </span>
              </div>
            </Step>
          </ol>
        </div>

        <div className="flex flex-col gap-6">
          <div className={card}>
            <h2 className={cardTitle}>Connected apps</h2>
            {apps.length === 0 ? (
              <div className="flex items-center gap-3">
                <span aria-hidden className="grid size-11 shrink-0 place-content-center rounded-xl border border-border bg-muted text-muted-foreground">
                  <RiPlugLine className="size-5" />
                </span>
                <div className="flex flex-col">
                  <p className="text-sm font-medium text-foreground">No AI apps connected yet</p>
                  <p className="text-sm text-muted-foreground">Apps show up here once you sign in from them.</p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {apps.map((app) => (
                  <ListRow
                    key={app.clientId}
                    title={app.name}
                    meta={`${app.scopes.includes("bugberry:write") ? "Can read and change" : "Can read"} · allowed ${when(app.grantedAt)} · last renewed ${when(app.lastUsedAt)}`}
                    action={
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
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <div className="flex flex-col gap-1">
              <h2 className={cardTitle}>Personal tokens</h2>
              <p className="text-sm text-muted-foreground">
                For clients without OAuth. Works with the MCP server only, not the rest of the BugBerry API.
              </p>
            </div>
            {newToken && (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary-subtle p-3">
                <p className="text-sm font-medium text-foreground">Copy it now. You won't see it again.</p>
                <code className="break-all font-mono text-sm text-foreground">{newToken}</code>
                <div className="flex gap-2">
                  <CopyButton text={newToken} label="Copy token" className="bg-background" />
                  <Button size="sm" intent="plain" onPress={onDismissToken}>
                    Done
                  </Button>
                </div>
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (trimmed) {
                  onCreateToken(trimmed)
                  setLabel("")
                }
              }}
            >
              <TextField aria-label="Token name" value={label} maxLength={60} onChange={setLabel} className="flex-1">
                <Input placeholder="Token name, e.g. CI bot" />
              </TextField>
              <Button type="submit" isDisabled={busy || !trimmed}>
                Create
              </Button>
            </form>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Send as <code className="font-mono text-sm text-foreground">Authorization: Bearer &lt;token&gt;</code>
            </p>
            {tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No personal tokens yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {tokens.map((token) => (
                  <ListRow
                    key={token.id}
                    title={token.label}
                    meta={`Created ${when(token.createdAt)} · last used ${when(token.lastUsedAt)}`}
                    action={
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
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
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

  if (tokens.isPending || apps.isPending) return <SettingsPageSkeleton />
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
