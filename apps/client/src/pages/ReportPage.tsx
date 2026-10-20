import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { NotificationBell } from "../components/NotificationBell"
import { CopyLinkButton } from "../components/report/CopyLinkButton"
import { MoreMenu } from "../components/report/MoreMenu"
import { ReportFields } from "../components/report/ReportFields"
import { ReportHeader } from "../components/report/ReportHeader"
import { ReportTitle } from "../components/report/ReportTitle"
import { ReportComments } from "../components/ReportComments"
import { ReportView } from "../components/ReportView"
import { ReportDetailSkeleton } from "../components/Skeletons"
import { ErrorState } from "../components/ui"
import { ApiError, errorMessage, type ReportPatch } from "../lib/api"
import { api } from "../lib/client"
import { queries } from "../lib/queries"
import { backTarget, sentIssues } from "../lib/report-page"
import { toast } from "../lib/toast"
import { useCurrentWorkspace } from "../lib/workspace"

const routeApi = getRouteApi("/_authed/app/r/$reportId")

/** The report page has no sidebar, so an error still offers the way back to the reports. */
export function ReportUnavailable({ error, onRetry }: { error: unknown; onRetry(): void }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      <ReportHeader back={{ to: "/app" }}>{null}</ReportHeader>
      <ErrorState error={error} onRetry={onRetry} />
    </div>
  )
}

export function ReportPage() {
  const { reportId } = routeApi.useParams()
  const { t } = routeApi.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const report = useQuery({ ...queries.report(reportId), retry: false })
  const workspaceId = report.data?.workspaceId ?? ""
  const projects = useQuery({ ...queries.projects(workspaceId), enabled: Boolean(report.data) })
  const members = useQuery({ ...queries.members(workspaceId), enabled: Boolean(report.data) })
  const trackers = useQuery({ ...queries.reportTrackers(reportId), enabled: Boolean(report.data) })
  const { workspace, workspaces, switchTo } = useCurrentWorkspace()

  const update = useMutation({
    mutationFn: (patch: ReportPatch) => api.updateReport(reportId, patch),
    onSuccess: (detail) => {
      queryClient.setQueryData(queries.report(reportId).queryKey, detail)
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
    },
    onError: (error) => toast({ title: errorMessage(error), tone: "error" }),
  })

  // Someone outside the workspace who may still read the report is sent to its share link.
  const shareSlug =
    report.error instanceof ApiError && report.error.code === "use_share_link" ? report.error.body.shareSlug : undefined
  useEffect(() => {
    if (typeof shareSlug === "string") void navigate({ to: "/s/$slug", params: { slug: shareSlug }, replace: true })
  }, [shareSlug, navigate])
  // A link to a report in another of my workspaces switches to that workspace.
  useEffect(() => {
    if (workspaceId && workspace && workspace.id !== workspaceId && workspaces.some((item) => item.id === workspaceId)) {
      void switchTo(workspaceId)
    }
  }, [workspaceId, workspace, workspaces, switchTo])

  if (report.isPending || typeof shareSlug === "string") return <ReportDetailSkeleton />
  if (report.isError) return <ReportUnavailable error={report.error} onRetry={() => void report.refetch()} />

  return (
    <ReportView
      key={report.data.id}
      report={report.data}
      header={
        <ReportHeader back={backTarget(report.data, projects.data ?? [])} leading={<NotificationBell placement="bottom start" />}>
          <CopyLinkButton report={report.data} />
          <MoreMenu report={report.data} />
        </ReportHeader>
      }
      fields={
        <ReportFields
          report={report.data}
          members={members.data}
          disabled={update.isPending}
          onChange={(patch) => update.mutate(patch)}
        />
      }
      title={<ReportTitle title={report.data.title} editable onSave={(title) => update.mutate({ title })} />}
      issues={sentIssues(trackers.data)}
      refreshReport={async () => (await report.refetch()).data}
      startAtSeconds={t}
    >
      <ReportComments reportId={report.data.id} workspaceId={report.data.workspaceId} />
    </ReportView>
  )
}
