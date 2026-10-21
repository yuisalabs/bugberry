import { PROVIDER_LABELS, TRACKER_PROVIDERS, type TrackerProvider } from "@bugberry/shared"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiPencilLine,
  RiPlugLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useReducer, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { IntegrationForm, type IntegrationSubmit, ProviderMark } from "../../components/IntegrationForm"
import { GithubIcon } from "../../components/LoginView"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { Badge, dangerText, ErrorState } from "../../components/ui"
import { errorMessage, type Integration, type IntegrationInput } from "../../lib/api"
import { api } from "../../lib/client"
import { INITIAL_INTEGRATIONS_UI, integrationsUi, type TestResult } from "../../lib/integrations-ui"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"

const routeApi = getRouteApi("/_authed/_admin/app/settings/projects/$projectId/integrations")

/** What each tracker makes out of a report. */
const PROVIDER_CREATES: Record<TrackerProvider, string> = { github: "Create issues", activecollab: "Create tasks" }

/** No integration yet: what one does, and a card per tracker that opens the form with it chosen. */
export function IntegrationsEmpty({ onPick }: { onPick(provider: TrackerProvider): void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-background px-6 py-12 text-center shadow-xs">
      <div aria-hidden className="flex items-center gap-4">
        <span className="grid size-14 place-content-center rounded-2xl bg-primary-subtle">
          <BugBerryLogo withWordmark={false} className="size-9" />
        </span>
        {/* The wave's shape comes from an image used as a mask, so it takes the theme's colour. */}
        <span className="h-4 w-16 bg-primary/40 [mask:url(/assets/wave.svg)_center/contain_no-repeat]" />
        <span className="grid size-14 place-content-center rounded-2xl bg-foreground text-background [&_svg]:size-7">
          <GithubIcon />
        </span>
      </div>
      <div className="flex max-w-lg flex-col gap-2">
        <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">No integrations yet</h2>
        <p className="text-muted-foreground">
          Connect a tracker and each report becomes a ready-to-work issue, with the video, console logs and steps attached.
        </p>
      </div>
      <ul className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {TRACKER_PROVIDERS.map((provider) => (
          <li key={provider}>
            <button
              type="button"
              onClick={() => onPick(provider)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left outline-hidden transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProviderMark provider={provider} className="size-10" />
              <span className="flex flex-1 flex-col">
                <span className="font-medium text-foreground">{PROVIDER_LABELS[provider]}</span>
                <span className="text-sm text-muted-foreground">{PROVIDER_CREATES[provider]}</span>
              </span>
              <RiArrowRightSLine aria-hidden className="size-5 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A saved integration: where it sends, whether it sends on its own, and its connection test. */
export function IntegrationRow({
  integration,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onDelete,
}: {
  integration: Integration
  testResult: TestResult | null
  testing: boolean
  removing: boolean
  onTest(): void
  onEdit(): void
  onDelete(): void
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-4">
        <ProviderMark provider={integration.provider} className="size-11" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono font-medium text-foreground">{integration.label}</span>
            {integration.autoSend && <Badge className="bg-success-subtle text-success-subtle-foreground">Sends every report</Badge>}
          </span>
          <span className="text-sm text-muted-foreground">
            {PROVIDER_LABELS[integration.provider]} · {PROVIDER_CREATES[integration.provider].toLowerCase()}
          </span>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
            <RiPlugLine aria-hidden />
            Test connection
          </Button>
          <Button size="sm" intent="outline" onPress={onEdit} aria-label={`Edit ${integration.label}`}>
            <RiPencilLine aria-hidden />
            Edit
          </Button>
          <Button
            size="sm"
            intent="plain"
            isDisabled={removing}
            onPress={onDelete}
            aria-label={`Delete ${integration.label}`}
            className={dangerText}
          >
            <RiDeleteBinLine aria-hidden />
            Delete
          </Button>
        </span>
      </div>
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

export function IntegrationsPage() {
  const { projectId } = routeApi.useParams()
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const integrations = useQuery(queries.integrations(projectId))
  const [{ editing, testResult }, dispatch] = useReducer(integrationsUi, INITIAL_INTEGRATIONS_UI)
  // The tracker chosen on the empty page's cards, for the new integration's form.
  const [picked, setPicked] = useState<TrackerProvider>("github")
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

  const start = (provider: TrackerProvider) => {
    setPicked(provider)
    dispatch({ type: "edit", id: "new" })
  }
  const cancel = () => {
    dispatch({ type: "cancel" })
    save.reset()
  }

  const project = projects.data?.find((item) => item.id === projectId)
  const projectName = project?.name ?? "this project"
  const error = save.error ?? remove.error
  const editingIntegration = editing && editing !== "new" ? integrations.data?.find((item) => item.id === editing) : undefined

  return (
    <section className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/app/settings/projects" className="hover:text-foreground">
          Projects
        </Link>
        <RiArrowRightSLine aria-hidden className="size-4" />
        {project ? (
          <Link to="/app/p/$projectSlug" params={{ projectSlug: project.slug }} className="hover:text-foreground">
            {project.name}
          </Link>
        ) : (
          <span>Project</span>
        )}
        <RiArrowRightSLine aria-hidden className="size-4" />
        <span aria-current="page" className="font-medium text-primary">
          Integrations
        </span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">Integrations</h1>
          <p className="text-muted-foreground">Reports in {projectName} can be sent to these trackers.</p>
        </div>
        {editing === null && (
          <Button onPress={() => start("github")}>
            <RiAddLine aria-hidden />
            New integration
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}

      {editing === "new" || editingIntegration ? (
        <IntegrationForm
          key={editing}
          integration={editingIntegration}
          projectName={projectName}
          initialProvider={picked}
          busy={save.isPending}
          onCancel={cancel}
          onSubmit={(value) => save.mutate({ id: editingIntegration?.id ?? null, value })}
        />
      ) : integrations.isPending ? (
        <SettingsRowsSkeleton />
      ) : integrations.isError ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : integrations.data.length === 0 ? (
        <IntegrationsEmpty onPick={start} />
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
              onEdit={() => dispatch({ type: "edit", id: item.id })}
              onDelete={() => {
                if (window.confirm("Delete this integration? Links to issues it already created are removed from BugBerry too.")) {
                  remove.mutate(item.id)
                }
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
