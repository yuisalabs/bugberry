import { type IntegrationProvider, isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiPencilLine,
  RiPulseLine,
  RiSendPlaneLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { BrandedHeader } from "../../components/BrandedHeader"
import { ConnectionForm, type ConnectionSubmit } from "../../components/ConnectionForm"
import { EmptyGroup, GroupTitle, integrationCard, softButton, StatusChip } from "../../components/IntegrationsLayout"
import { PROVIDER_GROUPS, ProviderMark } from "../../components/IntegrationForm"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { dangerText, ErrorState } from "../../components/ui"
import { useNow } from "../../hooks/useNow"
import { type Connection, errorMessage } from "../../lib/api"
import { api } from "../../lib/client"
import { formatRelative } from "../../lib/format"
import { INITIAL_INTEGRATIONS_UI, integrationsUi, type TestResult } from "../../lib/integrations-ui"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"

const projects = (count: number) => `${count} ${count === 1 ? "project" : "projects"}`

/** The delete confirmation names every project that loses the connection. */
export function deleteDescription(connection: Connection): string {
  const usedBy = connection.usedBy ?? []
  if (usedBy.length === 0) return "Not used in any project."
  return `Used in ${projects(usedBy.length)}: ${usedBy.map((use) => use.projectName).join(", ")}. They will stop sending to ${connection.name}.`
}

const card = integrationCard

export { EmptyGroup }

/** What each provider is and does, for its card under All integrations. */
export const PROVIDER_INFO: Record<IntegrationProvider, { category: string; text: string }> = {
  github: { category: "Issue tracker", text: "Open issues with the errors and a link to the replay." },
  gitlab: { category: "Issue tracker", text: "Turn reports into GitLab issues with a link to the full report." },
  jira: { category: "Issue tracker", text: "Create Jira tickets with the page, browser and errors." },
  linear: { category: "Issue tracker", text: "Send reports to a Linear team as issues." },
  activecollab: { category: "Project management", text: "Turn reports into tasks in your ActiveCollab projects." },
  plane: { category: "Project management", text: "File bugs as Plane work items, the replay one click away." },
  slack: { category: "Notifications", text: "Post every new report to a Slack channel." },
  discord: { category: "Notifications", text: "Ping your Discord server when a bug lands." },
  telegram: { category: "Notifications", text: "Ping a Telegram group when a bug lands." },
  webhook: { category: "Custom endpoint", text: "POST every new report to your own endpoint." },
}

/** "used in 1 project (Quinella AI)", "not used yet". */
export function usageText(connection: Connection): string {
  if (connection.usedIn === 0) return "not used yet"
  const names = (connection.usedBy ?? []).map((use) => use.projectName)
  return `used in ${projects(connection.usedIn)}${names.length > 0 ? ` (${names.join(", ")})` : ""}`
}

/** The providers with none of them connected first, each keeping its order; the ones already in use after. */
export function catalogueOrder(
  providers: readonly IntegrationProvider[],
  connected: Partial<Record<IntegrationProvider, number>>,
): IntegrationProvider[] {
  return [...providers.filter((provider) => !connected[provider]), ...providers.filter((provider) => connected[provider])]
}

/**
 * Every provider as a card that opens the form with it chosen. A provider can be connected more than once (two GitHub
 * accounts, a Slack channel per team), so the ones in use stay here: they say how many are connected and offer another.
 */
export function AllIntegrations({
  providers,
  connected,
  onPick,
}: {
  providers: readonly IntegrationProvider[]
  /** How many connections each provider has; missing means none. */
  connected: Partial<Record<IntegrationProvider, number>>
  onPick(provider: IntegrationProvider): void
}) {
  return (
    <section className="flex flex-col gap-3">
      <GroupTitle title="All integrations" count={providers.length} />
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {catalogueOrder(providers, connected).map((provider) => {
          const count = connected[provider] ?? 0
          const label = PROVIDER_LABELS[provider]
          return (
            <li key={provider} className={`flex flex-col gap-4 p-6 ${card}`}>
              <div className="flex items-start justify-between gap-3">
                <ProviderMark provider={provider} className="size-11" />
                {count > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-subtle-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    {count} connected
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <h3 className="font-heading font-semibold text-foreground">{label}</h3>
                <p className="text-sm text-muted-foreground">{PROVIDER_INFO[provider].category}</p>
                <p className="text-sm text-foreground">{PROVIDER_INFO[provider].text}</p>
              </div>
              <Button
                intent="plain"
                aria-label={count > 0 ? `Add another ${label} connection` : `Connect ${label}`}
                onPress={() => onPick(provider)}
                className={`w-full ${softButton}`}
              >
                <RiAddLine aria-hidden />
                {count > 0 ? "Add another" : "Connect"}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A connection: what it is, whether it works, which projects use it, and its actions. */
export function ConnectionRow({
  connection,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onDelete,
}: {
  connection: Connection
  testResult: TestResult | null
  testing: boolean
  removing: boolean
  onTest(): void
  onEdit(): void
  onDelete(): void
}) {
  const now = useNow()
  const notifier = !isTrackerProvider(connection.provider)
  // Telegram's account test checks the bot; its messages go from a project, where the chat is.
  const sendsTest = notifier && connection.provider !== "telegram"
  const { status } = connection
  const failing = notifier && status.failing > 0
  return (
    <li className={`flex flex-col gap-3 px-6 py-5 ${card}`}>
      <div className="flex flex-wrap items-center gap-4">
        <ProviderMark provider={connection.provider} className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-heading font-semibold text-foreground">{PROVIDER_LABELS[connection.provider]}</span>
            <StatusChip failing={failing} />
          </span>
          <span className="text-sm text-muted-foreground">
            {connection.name} · {usageText(connection)}
          </span>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
            {sendsTest ? <RiSendPlaneLine aria-hidden /> : <RiPulseLine aria-hidden />}
            {sendsTest ? "Send test message" : "Test connection"}
          </Button>
          <Button size="sm" intent="outline" onPress={onEdit} aria-label={`Edit ${connection.name}`}>
            <RiPencilLine aria-hidden />
            Edit
          </Button>
          <Button
            size="sm"
            intent="plain"
            isDisabled={removing}
            onPress={onDelete}
            aria-label={`Delete ${connection.name}`}
            className={dangerText}
          >
            <RiDeleteBinLine aria-hidden />
            Delete
          </Button>
        </span>
      </div>
      {failing && (
        <p className="flex items-center gap-1.5 text-sm text-danger-subtle-foreground">
          <RiCloseCircleLine aria-hidden className="size-4 shrink-0" />
          Last message failed in {projects(status.failing)}: {status.lastError}
        </p>
      )}
      {notifier && status.failing === 0 && status.lastDeliveredAt && (
        <p className="text-sm text-muted-foreground">Last message {formatRelative(status.lastDeliveredAt, now)}</p>
      )}
      {testResult && (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-sm ${testResult.ok ? "text-success-subtle-foreground" : "text-danger-subtle-foreground"}`}
        >
          {testResult.ok ? <RiCheckboxCircleLine aria-hidden className="size-4" /> : <RiCloseCircleLine aria-hidden className="size-4" />}
          {testResult.message}
        </p>
      )}
    </li>
  )
}

/** What each group says while nothing in it is connected. */
const EMPTY_GROUPS: Record<string, { title: string; text: string; action: string; marks: readonly IntegrationProvider[] }> = {
  "Issue trackers": {
    title: "No issue trackers yet",
    text: "Turn reports into issues in GitHub, GitLab, Jira or Linear, with the logs attached.",
    action: "Connect a tracker",
    marks: ["github", "gitlab", "jira"],
  },
  Notifications: {
    title: "No chat channels yet",
    text: "Post new reports to Slack, Discord or Telegram so the right people see them first.",
    action: "Connect a channel",
    marks: ["slack", "discord", "telegram"],
  },
}

export function ConnectionsPage() {
  const { confirm, dialog } = useConfirm()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const connections = useQuery({ ...queries.connections(workspaceId), enabled: Boolean(workspace) })
  const [{ editing, testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  // The provider chosen on the empty page's cards, for the new connection's form.
  const [picked, setPicked] = useState<IntegrationProvider>("github")
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.connections(workspaceId).queryKey })

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: string | null; value: ConnectionSubmit }) =>
      id
        ? api.updateConnection(workspaceId, id, { name: value.name, settings: value.settings, ...(value.secret ? { secret: value.secret } : {}) })
        : api.createConnection(workspaceId, value),
    onSuccess: async () => {
      dispatch({ type: "saved" })
      await refresh()
    },
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteConnection(workspaceId, id), onSuccess: refresh })
  const check = useMutation({
    mutationFn: (id: string) => api.testConnection(workspaceId, id),
    onSuccess: (_result, id) => {
      const tested = connections.data?.find((item) => item.id === id)
      const sent = tested && !isTrackerProvider(tested.provider) && tested.provider !== "telegram"
      dispatch({ type: "tested", id, ok: true, message: sent ? "Test message sent" : "Connection works" })
    },
    onError: (error, id) => dispatch({ type: "tested", id, ok: false, message: errorMessage(error) }),
  })

  const start = (provider: IntegrationProvider) => {
    setPicked(provider)
    dispatch({ type: "edit", id: "new" })
  }
  const cancel = () => {
    dispatch({ type: "cancel" })
    save.reset()
  }
  const error = save.error ?? remove.error
  const editingConnection = editing && editing !== "new" ? connections.data?.find((item) => item.id === editing) : undefined

  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader
        title="Integrations"
        description="Accounts and channels your projects can use. Tokens are entered here once."
        action={
          editing === null && (
            <Button onPress={() => start("github")}>
              <RiAddLine aria-hidden />
              Add connection
            </Button>
          )
        }
      />

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}

      {editing === "new" || editingConnection ? (
        <ConnectionForm
          key={editing}
          connection={editingConnection}
          initialProvider={picked}
          busy={save.isPending}
          onCancel={cancel}
          onSubmit={(value) => save.mutate({ id: editingConnection?.id ?? null, value })}
        />
      ) : connections.isPending ? (
        <SettingsRowsSkeleton />
      ) : connections.isError ? (
        <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />
      ) : (
        <>
          {PROVIDER_GROUPS.map((group) => {
            const rows = connections.data.filter((item) => (group.items as readonly string[]).includes(item.provider))
            const empty = EMPTY_GROUPS[group.title]
            return (
              <section key={group.title} className="flex flex-col gap-3">
                <GroupTitle title={group.title} count={rows.length} />
                {rows.length === 0 && empty ? (
                  <EmptyGroup
                    providers={empty.marks}
                    title={empty.title}
                    text={empty.text}
                    action={empty.action}
                    onPick={() => start(group.items[0])}
                  />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {rows.map((item) => (
                      <ConnectionRow
                        key={item.id}
                        connection={item}
                        testResult={testResult?.id === item.id ? testResult : null}
                        testing={check.isPending}
                        removing={remove.isPending}
                        onTest={() => check.mutate(item.id)}
                        onEdit={() => dispatch({ type: "edit", id: item.id })}
                        onDelete={async () => {
                          const yes = await confirm({
                            title: `Delete ${item.name}?`,
                            description: deleteDescription(item),
                            confirmLabel: "Delete connection",
                          })
                          if (yes) remove.mutate(item.id)
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
          <AllIntegrations
            providers={PROVIDER_GROUPS.flatMap((group) => group.items)}
            connected={connections.data.reduce<Partial<Record<IntegrationProvider, number>>>((counts, item) => {
              counts[item.provider] = (counts[item.provider] ?? 0) + 1
              return counts
            }, {})}
            onPick={start}
          />
        </>
      )}
      {dialog}
    </section>
  )
}
