import { type IntegrationProvider, isTrackerProvider } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { BrandedHeader } from "../../components/layout/BrandedHeader"
import { ConnectionForm, type ConnectionSubmit } from "./ConnectionForm"
import { PROVIDER_GROUPS } from "./IntegrationForm"
import { SettingsRowsSkeleton } from "../../components/layout/Skeletons"
import { ErrorState } from "../../components/ui/error-state"
import { INITIAL_INTEGRATIONS_UI, integrationsUi } from "./integrations-ui"
import { qk } from "../../lib/query/keys"
import { useCurrentWorkspace } from "../workspaces/workspace"
import { errorMessage } from "../../lib/query/unwrap"
import { createConnection, integrationQueries, testConnection, updateConnection, useDeleteConnection } from "./queries"
import { AllIntegrations } from "./AllIntegrations"
import { ConnectionGroups } from "./ConnectionGroups"
import { deleteDescription } from "./provider-info"

export function ConnectionsPage() {
  const { confirm, dialog } = useConfirm()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const connections = useQuery({ ...integrationQueries.connections(workspaceId), enabled: Boolean(workspace) })
  const [{ editing, testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  // The provider chosen on the empty page's cards, for the new connection's form.
  const [picked, setPicked] = useState<IntegrationProvider>("github")
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.connections(workspaceId) })

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: string | null; value: ConnectionSubmit }) =>
      id
        ? updateConnection(workspaceId, id, { name: value.name, settings: value.settings, ...(value.secret ? { secret: value.secret } : {}) })
        : createConnection(workspaceId, value),
    onSuccess: async () => {
      dispatch({ type: "saved" })
      await refresh()
    },
  })
  const remove = useDeleteConnection(workspaceId)
  const check = useMutation({
    mutationFn: (id: string) => testConnection(workspaceId, id),
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
          <ConnectionGroups
            connections={connections.data}
            testResult={testResult}
            testing={check.isPending}
            removing={remove.isPending}
            onTest={(id) => check.mutate(id)}
            onEdit={(id) => dispatch({ type: "edit", id })}
            onDelete={async (item) => {
              const yes = await confirm({
                title: `Delete ${item.name}?`,
                description: deleteDescription(item),
                confirmLabel: "Delete connection",
              })
              if (yes) remove.mutate(item.id)
            }}
            onAdd={start}
          />
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
