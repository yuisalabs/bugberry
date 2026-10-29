import { isTrackerProvider } from "@bugberry/shared"
import { RiAddLine, RiArrowLeftLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useCallback, useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { BrandedHeader } from "../../components/BrandedHeader"
import { PROVIDER_GROUPS } from "./IntegrationForm"
import { IntegrationGroup } from "./IntegrationsLayout"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { EmptyState, ErrorState } from "../../components/ui"
import { EditIntegrationSteps, type LoadOptions, UseConnectionModal } from "./UseConnectionDialog"
import { INITIAL_INTEGRATIONS_UI, integrationsUi } from "./integrations-ui"
import { qk } from "../../lib/query/keys"
import { useCurrentWorkspace } from "../../lib/workspace"
import { errorMessage } from "../../lib/query/unwrap"
import { projectQueries } from "../projects/queries"
import {
  addIntegration,
  type Connection,
  type Integration,
  type IntegrationInput,
  integrationQueries,
  type OptionList,
  testIntegration,
  updateIntegration,
  useRemoveIntegration,
} from "./queries"
import { IntegrationRow, titleOf } from "./IntegrationRow"
import { ReadyToUse } from "./ReadyToUse"

const routeApi = getRouteApi("/_authed/app/p/$projectSlug/integrations")

/** What each group's last card says: the words of a project that uses nothing in it yet. */
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

export function ProjectIntegrationsPage() {
  const { projectSlug } = routeApi.useParams()
  const { confirm, dialog } = useConfirm()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const projects = useQuery({ ...projectQueries.projects(workspaceId), enabled: Boolean(workspace) })
  const project = projects.data?.find((item) => item.slug === projectSlug)
  const projectId = project?.id ?? ""
  const integrations = useQuery({ ...integrationQueries.integrations(projectId), enabled: Boolean(project) })
  const connections = useQuery({ ...integrationQueries.connections(workspaceId), enabled: Boolean(workspace) })
  const [{ testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  // Open with nothing chosen ({}), or at step 2 for the connection whose Use was pressed.
  const [adding, setAdding] = useState<{ connectionId?: string } | null>(null)
  const [editing, setEditing] = useState<Integration | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.integrations(projectId) })

  const loadOptions: LoadOptions = useCallback(
    (connectionId: string, list: OptionList, q: string, parent: string) =>
      queryClient.fetchQuery(integrationQueries.connectionOptions(workspaceId, connectionId, list, q, parent)),
    [queryClient, workspaceId],
  )

  const add = useMutation({
    mutationFn: (body: IntegrationInput) => addIntegration(projectId, body),
    onSuccess: async () => {
      setAdding(null)
      await refresh()
    },
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { labels?: string[]; autoSend: boolean } }) => updateIntegration(projectId, id, body),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
  })
  const remove = useRemoveIntegration(projectId)
  const check = useMutation({
    mutationFn: (id: string) => testIntegration(projectId, id),
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
            if (!empty) return null
            return (
              <IntegrationGroup
                key={group.title}
                title={group.title}
                count={rows.length}
                empty={{ ...empty, text: empty.text(project.name) }}
                onAdd={() => setAdding({})}
              >
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
              </IntegrationGroup>
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
