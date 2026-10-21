import { isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
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
import { getRouteApi, Link, Navigate } from "@tanstack/react-router"
import { useCallback, useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { ProviderMark } from "../components/IntegrationForm"
import { SettingsRowsSkeleton } from "../components/Skeletons"
import { Badge, dangerText, EmptyState, ErrorState } from "../components/ui"
import { EditIntegrationSteps, type LoadOptions, UseConnectionModal } from "../components/UseConnectionDialog"
import { useNow } from "../hooks/useNow"
import { errorMessage, type Integration, type IntegrationInput, type OptionList } from "../lib/api"
import { api } from "../lib/client"
import { formatRelative } from "../lib/format"
import { INITIAL_INTEGRATIONS_UI, integrationsUi, type TestResult } from "../lib/integrations-ui"
import { queries } from "../lib/queries"
import { useCurrentWorkspace } from "../lib/workspace"

const routeApi = getRouteApi("/_authed/app/p/$projectSlug/integrations")
const legacyRouteApi = getRouteApi("/_authed/_admin/app/settings/projects/$projectId/integrations")

/** The connection's name, and where this use sends when that says more. */
const titleOf = (integration: Integration) =>
  integration.label === integration.connection.name ? integration.connection.name : `${integration.connection.name} → ${integration.label}`

/** A project's use of a connection: where it sends, how, its last message, and its actions. */
export function IntegrationRow({
  integration,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onRemove,
}: {
  integration: Integration
  testResult: TestResult | null
  testing: boolean
  removing: boolean
  onTest(): void
  onEdit(): void
  onRemove(): void
}) {
  const now = useNow()
  const notifier = !isTrackerProvider(integration.provider)
  const title = titleOf(integration)
  const labels = "labels" in integration.target ? (integration.target.labels as string[]) : []
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-4">
        <ProviderMark provider={integration.provider} className="size-11" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{title}</span>
            {integration.autoSend && <Badge className="bg-success-subtle text-success-subtle-foreground">Sends every report</Badge>}
          </span>
          <span className="text-sm text-muted-foreground">
            {PROVIDER_LABELS[integration.provider]} · {notifier ? "Posts new reports" : labels.length ? `Labels: ${labels.join(", ")}` : "Creates issues"}
          </span>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
            {notifier ? <RiSendPlaneLine aria-hidden /> : <RiPlugLine aria-hidden />}
            {notifier ? "Send test message" : "Test connection"}
          </Button>
          {!notifier && (
            <Button size="sm" intent="outline" onPress={onEdit} aria-label={`Edit ${title}`}>
              <RiPencilLine aria-hidden />
              Edit
            </Button>
          )}
          <Button size="sm" intent="plain" isDisabled={removing} onPress={onRemove} aria-label={`Remove ${title}`} className={dangerText}>
            <RiDeleteBinLine aria-hidden />
            Remove
          </Button>
        </span>
      </div>
      {notifier && integration.lastError && (
        <p className="flex items-center gap-1.5 text-sm text-danger-subtle-foreground">
          <RiCloseCircleLine aria-hidden className="size-4 shrink-0" />
          Last message failed: {integration.lastError}
        </p>
      )}
      {notifier && !integration.lastError && integration.lastDeliveredAt && (
        <p className="text-sm text-muted-foreground">Last message {formatRelative(integration.lastDeliveredAt, now)}</p>
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

export function ProjectIntegrationsPage() {
  const { projectSlug } = routeApi.useParams()
  const { confirm, dialog } = useConfirm()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.slug === projectSlug)
  const projectId = project?.id ?? ""
  const integrations = useQuery({ ...queries.integrations(projectId), enabled: Boolean(project) })
  const connections = useQuery({ ...queries.connections(workspaceId), enabled: Boolean(workspace) })
  const [{ testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Integration | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.integrations(projectId).queryKey })

  const loadOptions: LoadOptions = useCallback(
    (connectionId: string, list: OptionList, q: string, parent: string) =>
      queryClient.fetchQuery(queries.connectionOptions(workspaceId, connectionId, list, q, parent)),
    [queryClient, workspaceId],
  )

  const add = useMutation({
    mutationFn: (body: IntegrationInput) => api.addIntegration(projectId, body),
    onSuccess: async () => {
      setAdding(false)
      await refresh()
    },
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { labels?: string[]; autoSend: boolean } }) => api.updateIntegration(projectId, id, body),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
  })
  const remove = useMutation({ mutationFn: (id: string) => api.removeIntegration(projectId, id), onSuccess: refresh })
  const check = useMutation({
    mutationFn: (id: string) => api.testIntegration(projectId, id),
    onSuccess: async (_result, id) => {
      const tested = integrations.data?.find((item) => item.id === id)
      const sent = tested && !isTrackerProvider(tested.provider)
      dispatch({ type: "tested", id, ok: true, message: sent ? "Test message sent" : "Connection works" })
      await refresh()
    },
    onError: (error, id) => dispatch({ type: "tested", id, ok: false, message: errorMessage(error) }),
  })

  if (projects.isPending) return <SettingsRowsSkeleton />
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
  if (!project) return <EmptyState title="Project not found">No project has the slug “{projectSlug}”.</EmptyState>
  const error = remove.error ?? update.error

  return (
    <section className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/app/p/$projectSlug" params={{ projectSlug }} className="hover:text-foreground">
          {project.name}
        </Link>
        <RiArrowRightSLine aria-hidden className="size-4" />
        <span aria-current="page" className="font-medium text-primary">
          Integrations
        </span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">Integrations</h1>
          <p className="text-muted-foreground">Trackers that take reports from {project.name}, and channels that hear about new ones.</p>
        </div>
        <Button onPress={() => setAdding(true)}>
          <RiAddLine aria-hidden />
          Use a connection
        </Button>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}

      {integrations.isPending ? (
        <SettingsRowsSkeleton />
      ) : integrations.isError ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : integrations.data.length === 0 ? (
        <EmptyState title="Nothing connected yet">Use one of the workspace's connections to send this project's reports to a tracker or a channel.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {integrations.data.map((item) => (
            <IntegrationRow
              key={item.id}
              integration={item}
              testResult={testResult?.id === item.id ? testResult : null}
              testing={check.isPending}
              removing={remove.isPending}
              onTest={() => check.mutate(item.id)}
              onEdit={() => setEditing(item)}
              onRemove={async () => {
                const yes = await confirm({
                  title: `Remove ${titleOf(item)}?`,
                  description: "Issues already sent keep their links on their reports.",
                  confirmLabel: "Remove",
                })
                if (yes) remove.mutate(item.id)
              }}
            />
          ))}
        </ul>
      )}

      <UseConnectionModal
        isOpen={adding}
        error={add.error ? errorMessage(add.error) : connections.isError ? errorMessage(connections.error) : null}
        connections={connections.data}
        used={integrations.data ?? []}
        loadOptions={loadOptions}
        busy={add.isPending}
        onSubmit={(body) => add.mutate(body)}
        onClose={() => {
          setAdding(false)
          add.reset()
        }}
      />

      <Dialog isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)} aria-label="Edit integration" size="md">
        <DialogHeader>
          <DialogTitle>{editing ? titleOf(editing) : "Edit"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="pb-6">
          {editing && (
            <EditIntegrationSteps
              integration={editing}
              loadOptions={loadOptions}
              busy={update.isPending}
              onSubmit={(body) => update.mutate({ id: editing.id, body })}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogBody>
      </Dialog>
      {dialog}
    </section>
  )
}

/** The old address of a project's integrations page now leads to the project's own one. */
export function LegacyProjectIntegrations() {
  const { projectId } = legacyRouteApi.useParams()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.id === projectId)
  if (projects.isPending) return <SettingsRowsSkeleton />
  if (!project) return <EmptyState title="Project not found">This project no longer exists.</EmptyState>
  return <Navigate to="/app/p/$projectSlug/integrations" params={{ projectSlug: project.slug }} replace />
}
