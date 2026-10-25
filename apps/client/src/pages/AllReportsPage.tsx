import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { OnboardingCard } from "../components/onboarding/OnboardingChecklist"
import { ReportsBrowser } from "../components/ReportsBrowser"

const routeApi = getRouteApi("/_authed/app")

/** `/`: every report, from every project and from none, with a project filter. */
export function AllReportsPage() {
  const search = routeApi.useSearch()
  const navigate = useNavigate({ from: "/app" })
  return (
    <ReportsBrowser
      title="All reports"
      scope={{}}
      search={search}
      setSearch={(update) => void navigate({ search: update })}
      showProjectFilter
      intro={<OnboardingCard />}
    />
  )
}
