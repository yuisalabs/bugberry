import type { QueryClient } from "@tanstack/react-query"
import { APP_MAIN_ID, mayRestoreScroll } from "./lib/app-scroll"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type ParsedLocation,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import { AppShell } from "./components/AppShell"
import { ErrorPage } from "./components/status/ErrorPage"
import { StatusPage } from "./components/status/StatusPage"
import { requireWorkspaceAdmin } from "./features/auth/admin-guard"
import { legacyAppPath } from "./lib/legacy-paths"
import { publicSiteGate } from "./lib/public-site"
import { startSecondsFrom } from "./lib/urls"
import { validateLoginSearch } from "./features/auth/login"
import { validateProjectReportSearch, validateReportSearch } from "./lib/report-search"
// The report lists load with the app; the report page (debugger, media), sharing, sign-in and the
// settings pages are split off so the first load stays small.
import { AllReportsPage } from "./pages/AllReportsPage"
import { LandingPage } from "./pages/LandingPage"
import { ProjectReportsPage } from "./pages/ProjectReportsPage"

/** Any address no page answers, at the top level or inside the dashboard. */
function NotFoundPage() {
  return <StatusPage kind="404" />
}

/** A page that failed to load or crashed; trying again loads it afresh. */
function CrashPage({ error }: { error: unknown }) {
  return <ErrorPage error={error} onRetry={() => window.location.reload()} />
}

export interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: CrashPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: validateLoginSearch,
  component: lazyRouteComponent(() => import("./features/auth/LoginPage"), "LoginPage"),
})

/** Everything behind login. Without a session the person goes to /login and comes back afterwards. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: async ({ context, location }) => {
    try {
      return { me: await context.queryClient.ensureQueryData(accountQueries.me()) }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login", search: { next: location.href } })
      }
      if (error instanceof ApiError && error.status === 403) {
        throw redirect({ to: "/login", search: { error: "domain_not_allowed" } })
      }
      throw error
    }
  },
  component: AppShell,
})

const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app",
  validateSearch: validateReportSearch,
  component: AllReportsPage,
})

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/p/$projectSlug",
  validateSearch: validateProjectReportSearch,
  component: ProjectReportsPage,
})

/** Public: an invitation link works before signing in. */
const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/invite/$token", component: lazyRouteComponent(() => import("./pages/InvitePage"), "InvitePage") })

/** Where an AI app's OAuth sign-in asks the person to approve it; handles signed-out visitors itself. */
const oauthConsentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/consent",
  component: lazyRouteComponent(() => import("./features/auth/OAuthConsentPage"), "OAuthConsentPage"),
})

/** Where a session that ended mid-use lands (lib/session-end): the 401 page, with a way to sign in again. */
const sessionEndedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session-ended",
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({ next: typeof search.next === "string" ? search.next : undefined }),
  component: lazyRouteComponent(() => import("./features/auth/SessionEndedPage"), "SessionEndedPage"),
})

/** Public: the privacy policy the browser extension stores link to. */
const privacyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: lazyRouteComponent(() => import("./pages/PrivacyPage"), "PrivacyPage") })

/** Public: a workspace's shared invite link; works signed out so the person can sign in first. */
const joinRoute = createRoute({ getParentRoute: () => rootRoute, path: "/join/$code", component: lazyRouteComponent(() => import("./pages/JoinPage"), "JoinPage") })

/** `?t=3` starts the video at 0:03 (the player's "Share at" link). */
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$slug",
  validateSearch: (search: Record<string, unknown>): { t?: number } => ({ t: startSecondsFrom(search) }),
  component: lazyRouteComponent(() => import("./pages/SharePage"), "SharePage"),
})

/** Takes `?t=` too, so a member sent on from a share link keeps the start time. */
const reportRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/r/$reportId",
  validateSearch: (search: Record<string, unknown>): { t?: number } => ({ t: startSecondsFrom(search) }),
  component: lazyRouteComponent(() => import("./pages/ReportPage"), "ReportPage"),
})

/** Admin-only pages; the role is checked with the server on every visit. */
const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: "_admin",
  beforeLoad: ({ context }) => requireWorkspaceAdmin(context.queryClient),
})

const projectsSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/projects",
  component: lazyRouteComponent(() => import("./features/projects/ProjectsSettingsPage"), "ProjectsSettingsPage"),
})

/** The workspace's connections: admins connect accounts and channels once, for every project. */
const connectionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/integrations",
  component: lazyRouteComponent(() => import("./features/integrations/ConnectionsPage"), "ConnectionsPage"),
})

/** The old address of a project's integrations; leads to the project's own page. */
const integrationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/projects/$projectId/integrations",
  component: lazyRouteComponent(() => import("./features/integrations/LegacyProjectIntegrations"), "LegacyProjectIntegrations"),
})

/** A project's integrations: everyone in the workspace uses the workspace's connections here. */
const projectIntegrationsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/p/$projectSlug/integrations",
  component: lazyRouteComponent(() => import("./features/integrations/ProjectIntegrationsPage"), "ProjectIntegrationsPage"),
})

/** Everyone in the workspace sees its members; admins also invite and manage them. */
const membersRoute = createRoute({ getParentRoute: () => authedRoute, path: "/app/settings/members", component: lazyRouteComponent(() => import("./pages/settings/MembersPage"), "MembersPage") })

/** Anyone signed in: connect AI apps to the MCP server and manage their personal tokens. */
const aiAgentsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/settings/ai",
  component: lazyRouteComponent(() => import("./features/ai/AiAgentsPage"), "AiAgentsPage"),
})

/** Anyone signed in: their own name, photo and sign-in methods. */
const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/settings/account",
  component: lazyRouteComponent(() => import("./features/account/AccountSettingsPage"), "AccountSettingsPage"),
})

const workspaceSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/workspace",
  component: lazyRouteComponent(() => import("./pages/settings/WorkspaceSettingsPage"), "WorkspaceSettingsPage"),
})

/** Public, on BugBerry cloud only (publicSiteGate): the home page and the marketing pages. */
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", beforeLoad: publicSiteGate, component: LandingPage })
const publicPage = (path: string, component: () => Promise<Record<string, unknown>>, name: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, beforeLoad: publicSiteGate, component: lazyRouteComponent(component, name) })
const pricingRoute = publicPage("/pricing", () => import("./pages/PricingPage"), "PricingPage")
const integrationsPublicRoute = publicPage("/integrations", () => import("./pages/IntegrationsPage"), "IntegrationsPage")
const aiAgentsPublicRoute = publicPage("/ai-agents", () => import("./pages/AiAgentsPublicPage"), "AiAgentsPublicPage")
const demoRoute = publicPage("/demo", () => import("./pages/DemoPage"), "DemoPage")

/** Old dashboard addresses (before /app) redirect, keeping their query and hash. */
const legacyRedirect = ({ location }: { location: ParsedLocation }) => {
  const target = legacyAppPath(location.pathname)
  // A retired page's query (an extension id) means nothing at /app.
  if (target === "/app") throw redirect({ href: target })
  if (target) throw redirect({ href: `${target}${location.searchStr}${location.hash ? `#${location.hash}` : ""}` })
}
const legacyRoutes = ["/p/$", "/r/$", "/settings", "/settings/$", "/extension/connect", "/app/settings/tokens"].map((path) =>
  createRoute({ getParentRoute: () => rootRoute, path, beforeLoad: legacyRedirect }),
)

const routeTree = rootRoute.addChildren([
  landingRoute,
  pricingRoute,
  integrationsPublicRoute,
  aiAgentsPublicRoute,
  demoRoute,
  ...legacyRoutes,
  loginRoute,
  sessionEndedRoute,
  shareRoute,
  inviteRoute,
  joinRoute,
  privacyRoute,
  oauthConsentRoute,
  authedRoute.addChildren([
    homeRoute,
    projectRoute,
    projectIntegrationsRoute,
    reportRoute,
    membersRoute,
    accountRoute,
    aiAgentsRoute,
    adminRoute.addChildren([projectsSettingsRoute, connectionsRoute, integrationsRoute, workspaceSettingsRoute]),
  ]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: mayRestoreScroll,
    scrollToTopSelectors: [`#${APP_MAIN_ID}`],
    // Child routes (the dashboard's pages) get the same status pages as the root.
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: CrashPage,
  })
}

import type { ReportsFrom } from "./lib/report-page"
import { ApiError } from "./lib/query/unwrap"
import { accountQueries } from "./features/account/queries"

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
  interface HistoryState {
    /** The report list a report was opened from, so its page leads back there: a project's slug, or every report. */
    reportsFrom?: ReportsFrom
  }
}
