import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { CopyLinkButton } from "../components/report/CopyLinkButton"
import { ReportHeader } from "../components/report/ReportHeader"
import { ReportTitle } from "../components/report/ReportTitle"
import { ReportView } from "../components/ReportView"
import { ErrorPage } from "../components/status/ErrorPage"
import { PageLoading } from "../components/ui"
import { ApiError } from "../lib/api"
import { queries } from "../lib/queries"
import { sharePageTarget } from "../lib/report-page"

const routeApi = getRouteApi("/s/$slug")

/**
 * Read-only report for a share link. Internal reports answer 401; the query client's 401 handler
 * then sends the visitor to /login?next=/s/<slug>. Unknown and withdrawn links look the same.
 * Members of the report's workspace go on to the full report page.
 */
export function SharePage() {
  const { slug } = routeApi.useParams()
  const { t } = routeApi.useSearch()
  const navigate = useNavigate()
  const share = useQuery(queries.share(slug))
  const target = share.data ? sharePageTarget(share.data) : null

  useEffect(() => {
    if (target) void navigate({ ...target, search: { t }, replace: true })
  }, [target?.params.reportId, t, navigate])

  if (share.isPending || target) return <PageLoading />
  if (share.error instanceof ApiError && share.error.status === 401) return <PageLoading label="Redirecting to sign in…" />
  if (share.isError) {
    return (
      <ErrorPage
        error={share.error}
        onRetry={() => void share.refetch()}
        description="This link is wrong, was replaced, or the report isn't shared."
      />
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <ReportView
        key={share.data.id}
        report={share.data}
        header={
          <ReportHeader back={null}>
            <span className="hidden md:inline-flex">
              <CopyLinkButton report={share.data} settings={false} />
            </span>
          </ReportHeader>
        }
        footer={<CopyLinkButton report={share.data} settings={false} bar />}
        title={<ReportTitle title={share.data.title} editable={false} onSave={() => {}} />}
        refreshReport={async () => (await share.refetch()).data}
        startAtSeconds={t}
      />
    </div>
  )
}
