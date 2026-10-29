import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, useLocation, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { NotificationBell } from "../../notifications/NotificationBell"
import { CopyLinkButton } from "../share/CopyLinkButton"
import { MoreMenu } from "./MoreMenu"
import { TrackerButton } from "./TrackerButton"
import { ReportFields } from "./ReportFields"
import { ReportHeader } from "./ReportHeader"
import { ReportTitle } from "./ReportTitle"
import { ReportComments } from "../comments/ReportComments"
import { ReportView } from "./ReportView"
import { ReportDetailSkeleton } from "../../../components/layout/Skeletons"
import { ErrorPage } from "../../../components/layout/ErrorPage"
import { backLink, sentIssues, withPatch } from "./report-page"
import { toast } from "../../../lib/toast"
import { useCurrentWorkspace } from "../../workspaces/workspace"
import { ApiError, errorMessage } from "../../../lib/query/unwrap"
import { projectQueries } from "../../projects/queries"
import { workspaceQueries } from "../../workspaces/queries"
import { type ReportPatch, reportQueries, updateReport } from "../queries"
import { qk } from "../../../lib/query/keys"

const routeApi = getRouteApi("/_authed/app/r/$reportId")

/** A report that can't be shown: its status page, whose Home leads back to the reports. */
export function ReportUnavailable({ error, onRetry }: { error: unknown; onRetry(): void }) {
  return <ErrorPage error={error} onRetry={onRetry} description="This report was deleted, or it isn't in a workspace you're in." />
}

export function ReportPage() {
  const { reportId } = routeApi.useParams()
  const { t } = routeApi.useSearch()
  // The list this report was opened from (a project's page or All reports), so the back link leads there.
  const reportsFrom = useLocation({ select: (location) => location.state.reportsFrom })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const report = useQuery({ ...reportQueries.report(reportId), retry: false })
  const workspaceId = report.data?.workspaceId ?? ""
  const projects = useQuery({ ...projectQueries.projects(workspaceId), enabled: Boolean(report.data) })
  const members = useQuery({ ...workspaceQueries.members(workspaceId), enabled: Boolean(report.data) })
  const trackers = useQuery({ ...reportQueries.reportTrackers(reportId), enabled: Boolean(report.data) })
  const { workspace, workspaces, switchTo } = useCurrentWorkspace()

  const reportKey = reportQueries.report(reportId).queryKey
  const updateKey = ["update-report", reportId]
  // A change shows at once and the fields stay usable while it saves, so nothing dims or jumps back.
  const update = useMutation({
    mutationKey: updateKey,
    mutationFn: (patch: ReportPatch) => updateReport(reportId, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: reportKey })
      const before = queryClient.getQueryData(reportKey)
      if (before) queryClient.setQueryData(reportKey, withPatch(before, patch, members.data))
      return { before }
    },
    onSuccess: (detail) => {
      // Two quick changes: only the last answer is the whole truth; an earlier one would undo the later change.
      if (queryClient.isMutating({ mutationKey: updateKey }) === 1) queryClient.setQueryData(reportKey, detail)
      void queryClient.invalidateQueries({ queryKey: qk.reports.all })
      void queryClient.invalidateQueries({ queryKey: qk.activity(reportId) })
    },
    onError: (error, _patch, context) => {
      if (context?.before) queryClient.setQueryData(reportKey, context.before)
      // Another change may have saved meanwhile: the server says what the report is now.
      void queryClient.invalidateQueries({ queryKey: reportKey })
      toast({ title: errorMessage(error), tone: "error" })
    },
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
        <ReportHeader back={backLink(report.data, projects.data ?? [], reportsFrom)} leading={<NotificationBell placement="bottom start" />}>
          {/* On phones both live elsewhere: Copy link in the bottom bar, trackers in the ⋯ sheet. */}
          <span className="hidden gap-2 md:inline-flex">
            <TrackerButton report={report.data} />
            <CopyLinkButton report={report.data} />
          </span>
          <MoreMenu report={report.data} />
        </ReportHeader>
      }
      footer={<CopyLinkButton report={report.data} bar />}
      project={projects.data?.find((project) => project.id === report.data.projectId)?.name ?? null}
      fields={
        <ReportFields
          report={report.data}
          members={members.data}
          onChange={(patch) => update.mutate(patch)}
          rows
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
