import { PROVIDER_LABELS } from "@bugberry/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useReducer } from "react"
import { Button } from "@bugberry/ui/button"
import { IntegrationForm, type IntegrationSubmit } from "../../components/IntegrationForm"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { Badge, EmptyState, ErrorState, PageHeader } from "../../components/ui"
import { errorMessage, type IntegrationInput } from "../../lib/api"
import { api } from "../../lib/client"
import { INITIAL_INTEGRATIONS_UI, integrationsUi } from "../../lib/integrations-ui"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"

const routeApi = getRouteApi("/_authed/_admin/app/settings/projects/$projectId/integrations")

export function IntegrationsPage() {
  const { projectId } = routeApi.useParams()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const integrations = useQuery(queries.integrations(projectId))
  const [{ editing, testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.integrations(projectId).queryKey })

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: string | null; value: IntegrationSubmit }) => {
      if (id) {
        return api.updateIntegration(projectId, id, {
          config: value.config,
          autoSend: value.autoSend,
          ...(value.secret ? { secret: value.secret } : {}),
        })
      }
      return api.createIntegration(projectId, {
        provider: value.provider,
        config: value.config,
        secret: value.secret,
        autoSend: value.autoSend,
      } as IntegrationInput)
    },
    onSuccess: async () => {
      dispatch({ type: "saved" })
      await refresh()
    },
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteIntegration(projectId, id), onSuccess: refresh })
  const check = useMutation({
    mutationFn: (id: string) => api.testIntegration(projectId, id),
    onSuccess: (_result, id) => dispatch({ type: "tested", id, ok: true, message: "Connection works" }),
    onError: (error, id) => dispatch({ type: "tested", id, ok: false, message: errorMessage(error) }),
  })

  const cancel = () => {
    dispatch({ type: "cancel" })
    save.reset()
  }

  const project = projects.data?.find((item) => item.id === projectId)
  const error = save.error ?? remove.error

  return (
    <section className="flex max-w-4xl flex-col gap-4">
      <Link to="/app/settings/projects" className="text-sm text-primary hover:underline">
        ← Project
      </Link>
      <PageHeader
        title={`Integrations${project ? ` · ${project.name}` : ""}`}
        subtitle="Reports in this project can be sent to these trackers."
        actions={editing !== "new" && <Button size="sm" onPress={() => dispatch({ type: "edit", id: "new" })}>New integration</Button>}
      />
      {editing === "new" && (
        <IntegrationForm
          busy={save.isPending}
          onCancel={cancel}
          onSubmit={(value) => save.mutate({ id: null, value })}
        />
      )}
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
        <EmptyState title="No integrations yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {integrations.data.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                <IntegrationForm
                  integration={item}
                  busy={save.isPending}
                  onCancel={cancel}
                  onSubmit={(value) => save.mutate({ id: item.id, value })}
                />
              </li>
            ) : (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-background p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {PROVIDER_LABELS[item.provider]} · {item.label}
                  </p>
                  {item.autoSend && <Badge className="mt-1 bg-success-subtle text-success-subtle-foreground">Auto-send</Badge>}
                  {testResult?.id === item.id && (
                    <p role="status" className={`mt-1 text-sm ${testResult.ok ? "text-success-subtle-foreground" : "text-danger-subtle-foreground"}`}>
                      {testResult.message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" intent="outline" isDisabled={check.isPending} onPress={() => check.mutate(item.id)}>
                    Test connection
                  </Button>
                  <Button size="sm" intent="outline" onPress={() => dispatch({ type: "edit", id: item.id })}>
                    Edit
                  </Button>
                  <Button size="sm"
                    intent="danger"
                    isDisabled={remove.isPending}
                    onPress={() => {
                      if (window.confirm("Delete this integration? Links to issues it already created are removed from BugBerry too.")) {
                        remove.mutate(item.id)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
