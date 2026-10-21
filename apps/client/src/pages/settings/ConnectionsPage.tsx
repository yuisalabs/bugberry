import { type IntegrationProvider, isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiPencilLine,
  RiPlugLine,
  RiSendPlaneLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { ConnectionForm, type ConnectionSubmit } from "../../components/ConnectionForm"
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

/** No connection yet: a card per provider that opens the form with it chosen. */
export function ConnectionsEmpty({ onPick }: { onPick(provider: IntegrationProvider): void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-background px-6 py-12 text-center shadow-xs">
      <div className="flex max-w-lg flex-col gap-2">
        <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">No connections yet</h2>
        <p className="text-muted-foreground">
          Connect an account or a channel once. Every project in the workspace can then send its reports there.
        </p>
      </div>
      {PROVIDER_GROUPS.map((group) => (
        <section key={group.title} className="flex w-full max-w-xl flex-col gap-3 text-left">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.items.map((provider) => (
              <li key={provider}>
                <button
                  type="button"
                  onClick={() => onPick(provider)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left outline-hidden transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ProviderMark provider={provider} className="size-10" />
                  <span className="flex-1 font-medium text-foreground">{PROVIDER_LABELS[provider]}</span>
                  <RiArrowRightSLine aria-hidden className="size-5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** A connection: what it is, how many projects use it, how its messages fare, and its actions. */
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
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-4">
        <ProviderMark provider={connection.provider} className="size-11" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground">{connection.name}</span>
          <span className="text-sm text-muted-foreground">
            {PROVIDER_LABELS[connection.provider]} · {connection.usedIn === 0 ? "not used yet" : `used in ${projects(connection.usedIn)}`}
          </span>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
            {sendsTest ? <RiSendPlaneLine aria-hidden /> : <RiPlugLine aria-hidden />}
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
      {notifier && status.failing > 0 && (
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
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">Integrations</h1>
          <p className="text-muted-foreground">Accounts and channels your projects can use. Tokens are entered here once.</p>
        </div>
        {editing === null && (
          <Button onPress={() => start("github")}>
            <RiAddLine aria-hidden />
            Add connection
          </Button>
        )}
      </header>

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
      ) : connections.data.length === 0 ? (
        <ConnectionsEmpty onPick={start} />
      ) : (
        PROVIDER_GROUPS.map((group) => {
          const rows = connections.data.filter((item) => (group.items as readonly string[]).includes(item.provider))
          if (rows.length === 0) return null
          return (
            <section key={group.title} className="flex flex-col gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h2>
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
            </section>
          )
        })
      )}
      {dialog}
    </section>
  )
}
