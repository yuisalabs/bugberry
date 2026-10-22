import { isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import {
  RiAddLine,
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiPencilLine,
  RiPulseLine,
  RiSendPlaneLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, Navigate } from "@tanstack/react-router"
import { type ReactNode, useCallback, useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { BrandedHeader } from "../components/BrandedHeader"
import { ProviderMark, PROVIDER_GROUPS } from "../components/IntegrationForm"
import { EmptyGroup, GroupTitle, integrationCard, softButton, StatusChip } from "../components/IntegrationsLayout"
import { SettingsRowsSkeleton } from "../components/Skeletons"
import { Badge, dangerText, EmptyState, ErrorState } from "../components/ui"
import { EditIntegrationSteps, type LoadOptions, UseConnectionModal, usedUp } from "../components/UseConnectionDialog"
import { useNow } from "../hooks/useNow"
import { type Connection, errorMessage, type Integration, type IntegrationInput, type OptionList } from "../lib/api"
import { api } from "../lib/client"
import { formatRelative } from "../lib/format"
import { INITIAL_INTEGRATIONS_UI, integrationsUi, type TestResult } from "../lib/integrations-ui"
import { queries } from "../lib/queries"
import { useCurrentWorkspace } from "../lib/workspace"

const routeApi = getRouteApi("/_authed/app/p/$projectSlug/integrations")
const legacyRouteApi = getRouteApi("/_authed/_admin/app/settings/projects/$projectId/integrations")

/**
 * The workspace's connections this project can still use, each with Use: every tracker and Telegram (another repo,
 * project or chat), and the channels it doesn't send to yet. `addConnection` is the admin's link to the workspace page
 * (a router link, so this renders without a router in tests).
 */
export function ReadyToUse({
  workspaceName,
  connections,
  used = [],
  addConnection,
  onUse,
}: {
  workspaceName: string
  /** Every connection in the workspace. */
  connections: readonly Connection[]
  /** What this project already uses. */
  used?: readonly Integration[]
  addConnection: ReactNode
  onUse(connectionId: string): void
}) {
  const ready = connections.filter((connection) => !usedUp(connection, used))
  const usedHere = (connection: Connection) => used.some((use) => use.connection.id === connection.id)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <GroupTitle title="Ready to use" count={ready.length} />
        <p className="text-sm text-muted-foreground">Connections in {workspaceName} you can use in this project.</p>
      </div>
      {ready.length === 0 ? (
        <div className={`flex flex-col gap-1 border-dashed px-6 py-5 ${integrationCard}`}>
          <p className="font-semibold text-foreground">
            {connections.length === 0 ? `No connections in ${workspaceName} yet` : `Every connection in ${workspaceName} is in use here`}
          </p>
          <p className="text-sm text-muted-foreground">Connections are added once, under Workspace › Integrations.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {ready.map((connection) => (
            <li key={connection.id} className={`flex flex-col gap-4 p-6 ${integrationCard}`}>
              <div className="flex items-start justify-between gap-3">
                <ProviderMark provider={connection.provider} className="size-11" />
                <Badge className="bg-muted text-muted-foreground">{isTrackerProvider(connection.provider) ? "Issues" : "Messages"}</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <h3 className="truncate font-heading font-semibold text-foreground">{connection.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {PROVIDER_LABELS[connection.provider]} ·{" "}
                  {connection.usedIn === 0 ? "Not used yet" : `Used by ${connection.usedIn} ${connection.usedIn === 1 ? "project" : "projects"}`}
                </p>
                {/* A tracker or Telegram already here can send to another repo, project or chat too. */}
                {usedHere(connection) && <p className="text-sm text-muted-foreground">In use here, can send somewhere else too</p>}
              </div>
              <Button intent="plain" aria-label={`Use ${connection.name}`} onPress={() => onUse(connection.id)} className={`w-full ${softButton}`}>
                <RiAddLine aria-hidden />
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
      {addConnection ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <RiAddLine aria-hidden className="size-4 shrink-0" />
          {addConnection}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Need another tool? Ask a workspace admin to add one in Workspace › Integrations.</p>
      )}
    </section>
  )
}

/** What each group says while this project uses nothing in it. */
const EMPTY_GROUPS: Record<string, { title: string; text: (project: string) => string; action: string; marks: Connection["provider"][] }> = {
  "Issue trackers": {
    title: "No tracker yet",
    text: (project) => `Send ${project}'s reports to GitHub, Jira, Linear and more as issues.`,
    action: "Use a tracker",
    marks: ["github", "gitlab", "jira"],
  },
  Notifications: {
    title: "No chat channels yet",
    text: (project) => `Tell Slack, Discord or Telegram when a new report lands in ${project}.`,
    action: "Use a channel",
    marks: ["slack", "discord", "telegram"],
  },
}

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
    <li className={`flex flex-col gap-3 px-6 py-5 ${integrationCard}`}>
      <div className="flex flex-wrap items-center gap-4">
        <ProviderMark provider={integration.provider} className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-heading font-semibold text-foreground">{title}</span>
            <StatusChip failing={notifier && Boolean(integration.lastError)} />
            {integration.autoSend && <Badge className="bg-primary-subtle text-primary">Sends every report</Badge>}
          </span>
          <span className="text-sm text-muted-foreground">
            {PROVIDER_LABELS[integration.provider]} · {notifier ? "Posts new reports" : labels.length ? `Labels: ${labels.join(", ")}` : "Creates issues"}
          </span>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
            {notifier ? <RiSendPlaneLine aria-hidden /> : <RiPulseLine aria-hidden />}
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
  // Open with nothing chosen ({}), or at step 2 for the connection whose Use was pressed.
  const [adding, setAdding] = useState<{ connectionId?: string } | null>(null)
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
      setAdding(null)
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
      <Link
        to="/app/p/$projectSlug"
        params={{ projectSlug }}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <RiArrowLeftLine aria-hidden className="size-4" />
        Back to {project.name}
      </Link>

      <BrandedHeader
        title="Integrations"
        description={`Trackers that take reports from ${project.name}, and channels that hear about new ones.`}
        action={
          <Button onPress={() => setAdding({})}>
            <RiAddLine aria-hidden />
            Use a connection
          </Button>
        }
      />

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}

      {integrations.isPending ? (
        <SettingsRowsSkeleton />
      ) : integrations.isError ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : (
        <>
          {PROVIDER_GROUPS.map((group) => {
            const rows = integrations.data.filter((item) => (group.items as readonly string[]).includes(item.provider))
            const empty = EMPTY_GROUPS[group.title]
            return (
              <section key={group.title} className="flex flex-col gap-3">
                <GroupTitle title={group.title} count={rows.length} />
                {rows.length === 0 && empty ? (
                  <EmptyGroup
                    providers={empty.marks}
                    title={empty.title}
                    text={empty.text(project.name)}
                    action={empty.action}
                    onPick={() => setAdding({})}
                  />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {rows.map((item) => (
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
              </section>
            )
          })}
          <ReadyToUse
            workspaceName={workspace?.name ?? "this workspace"}
            connections={connections.data ?? []}
            used={integrations.data}
            addConnection={
              workspace?.role === "admin" ? (
                <Link to="/app/settings/integrations" className="hover:underline">
                  Need another tool? Add a connection in Workspace › Integrations
                </Link>
              ) : null
            }
            onUse={(connectionId) => setAdding({ connectionId })}
          />
        </>
      )}

      <UseConnectionModal
        // Keyed by the connection, so a second Use starts the steps afresh.
        key={adding?.connectionId ?? "any"}
        isOpen={adding !== null}
        initialConnectionId={adding?.connectionId}
        error={add.error ? errorMessage(add.error) : connections.isError ? errorMessage(connections.error) : null}
        connections={connections.data}
        used={integrations.data ?? []}
        loadOptions={loadOptions}
        busy={add.isPending}
        onSubmit={(body) => add.mutate(body)}
        onClose={() => {
          setAdding(null)
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
