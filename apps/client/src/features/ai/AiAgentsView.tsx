import { RiBookOpenLine, RiChat3Line, RiKey2Line, RiPlugLine, RiServerLine } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { BrandedHeader } from "../../components/BrandedHeader"
import { CopyButton } from "../../components/ui"
import { DOCS_URL } from "../../lib/docs-url"
import { formatDateTime } from "../../lib/format"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { SnippetTabs } from "./SnippetTabs"
import { AGENT_CAN, AGENT_PROMPT, connectSnippets, RECORDER_PORT, recorderSnippets, reportLinkForms } from "./snippets"

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

const when = (value: Date | string | null) => (value ? formatDateTime(value) : "never")

const card = "flex flex-col gap-5 rounded-3xl border border-border bg-background p-6"
const cardTitle = "font-heading text-lg font-semibold text-foreground"

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
  header = true,
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
  /** Off inside the AI settings page, whose own header is shown above the tabs. */
  header?: boolean
}) {
  const url = `${origin}/api/mcp`
  const snippets = connectSnippets(url)
  const [label, setLabel] = useState("")
  const { confirm, dialog } = useConfirm()
  const trimmed = label.trim()

  return (
    <section className="flex flex-col gap-8">
      {header && <BrandedHeader
        title="AI Agents (MCP)"
        description="Let AI apps like Claude Code or Cursor read your reports and work on them. Agents see only what you can see."
        action={
          <a
            href={`${DOCS_URL}/guide/ai-agents`}
            target="_blank"
            rel="noreferrer"
            className={buttonStyles({ intent: "outline", size: "md", className: "bg-background" })}
          >
            <RiBookOpenLine aria-hidden />
            Read the docs
          </a>
        }
      />}

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
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
                <SnippetTabs label="AI apps" snippets={snippets} />
              </Step>

              <Step number={3} title="Paste a report link into your agent">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                  <RiChat3Line aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {AGENT_PROMPT}
                    <span className="font-mono whitespace-nowrap text-primary">&lt;report link&gt;</span>
                  </span>
                  <CopyButton text={AGENT_PROMPT} label="Copy" className="bg-background" />
                </div>
              </Step>
            </ol>
            <div className="flex flex-col gap-1.5 border-t border-border pt-5 text-sm text-muted-foreground">
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
          </div>

          <div className={card}>
            <div className="flex flex-col gap-1">
              <h2 className={cardTitle}>Let agents record bugs</h2>
              <p className="text-sm text-muted-foreground">
                A coding agent can record a bug in a browser it drives and file it here, with video, console and network.
                Add these two servers beside BugBerry, connected with changes allowed. Then ask: “Show me the bug on /checkout.”
                Or ask it to test a page: the recorder's test-page prompt finds the bugs and files each one. After a fix,
                its verify-fix prompt records proof that the bug is gone.
              </p>
            </div>
            <SnippetTabs label="AI apps for recording" snippets={recorderSnippets(origin, RECORDER_PORT)} />
            <a href={`${DOCS_URL}/guide/agent-recordings`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
              How agent recordings work
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-6">
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
            <p className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
              Send as <code className="font-mono text-sm text-foreground">Authorization: Bearer &lt;token&gt;</code>
            </p>
            {tokens.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <RiKey2Line aria-hidden className="size-4 shrink-0" />
                No personal tokens yet.
              </p>
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
                        onPress={async () => {
                          const yes = await confirm({
                            title: `Revoke "${token.label}"?`,
                            description: "Apps using it stop working.",
                            confirmLabel: "Revoke",
                          })
                          if (yes) onRevokeToken(token.id)
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
          <div className={card}>
            <h2 className={cardTitle}>Connected apps</h2>
            {apps.length === 0 ? (
              <div className="flex items-center gap-4 rounded-2xl bg-muted p-4">
                <span aria-hidden className="grid size-11 shrink-0 place-content-center rounded-xl border border-border bg-background text-foreground">
                  <RiPlugLine className="size-5" />
                </span>
                <div className="flex flex-col">
                  <p className="font-medium text-foreground">No AI apps connected yet</p>
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
                        onPress={async () => {
                          const yes = await confirm({
                            title: `Disconnect ${app.name}?`,
                            description: "It loses access right away.",
                            confirmLabel: "Disconnect",
                          })
                          if (yes) onRevokeApp(app.clientId)
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
            <h2 className={cardTitle}>What agents can do</h2>
            <ul className="flex flex-col gap-4">
              {AGENT_CAN.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3.5">
                  <span aria-hidden className="grid size-10 shrink-0 place-content-center rounded-xl bg-primary-subtle text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{title}</span>
                    <span className="text-sm text-muted-foreground">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {dialog}
    </section>
  )
}
