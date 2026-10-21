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
import { EmptyState, ErrorState } from "./components/ui"
import { requireWorkspaceAdmin } from "./lib/admin-guard"
import { ApiError } from "./lib/api"
import { legacyAppPath } from "./lib/legacy-paths"
import { startSecondsFrom } from "./lib/urls"
import { validateLoginSearch } from "./lib/login"
import { queries } from "./lib/queries"
import { validateProjectReportSearch, validateReportSearch } from "./lib/report-search"
// The report lists load with the app; the report page (debugger, media), sharing, sign-in and the
// settings pages are split off so the first load stays small.
import { AllReportsPage } from "./pages/AllReportsPage"
import { LandingPage } from "./pages/LandingPage"
import { ProjectReportsPage } from "./pages/ProjectReportsPage"

export interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="p-6">
      <EmptyState title="Page not found" />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="p-6">
      <ErrorState error={error} />
    </div>
  ),
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: validateLoginSearch,
  component: lazyRouteComponent(() => import("./pages/LoginPage"), "LoginPage"),
})

/** Everything behind login. Without a session the person goes to /login and comes back afterwards. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: async ({ context, location }) => {
    try {
      return { me: await context.queryClient.ensureQueryData(queries.me()) }
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
  component: lazyRouteComponent(() => import("./pages/OAuthConsentPage"), "OAuthConsentPage"),
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
  component: lazyRouteComponent(() => import("./pages/settings/ProjectsSettingsPage"), "ProjectsSettingsPage"),
})

const integrationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/projects/$projectId/integrations",
  component: lazyRouteComponent(() => import("./pages/settings/IntegrationsPage"), "IntegrationsPage"),
})

/** Everyone in the workspace sees its members; admins also invite and manage them. */
const membersRoute = createRoute({ getParentRoute: () => authedRoute, path: "/app/settings/members", component: lazyRouteComponent(() => import("./pages/settings/MembersPage"), "MembersPage") })

/** Anyone signed in: connect AI apps to the MCP server and manage their personal tokens. */
const aiAgentsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/settings/ai",
  component: lazyRouteComponent(() => import("./pages/settings/AiAgentsPage"), "AiAgentsPage"),
})

/** Anyone signed in: their own name, photo and sign-in methods. */
const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/app/settings/account",
  component: lazyRouteComponent(() => import("./pages/settings/AccountSettingsPage"), "AccountSettingsPage"),
})

const workspaceSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/app/settings/workspace",
  component: lazyRouteComponent(() => import("./pages/settings/WorkspaceSettingsPage"), "WorkspaceSettingsPage"),
})

/** Public: the BugBerry landing page. */
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingPage })

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
  ...legacyRoutes,
  loginRoute,
  shareRoute,
  inviteRoute,
  joinRoute,
  privacyRoute,
  oauthConsentRoute,
  authedRoute.addChildren([
    homeRoute,
    projectRoute,
    reportRoute,
    membersRoute,
    accountRoute,
    aiAgentsRoute,
    adminRoute.addChildren([projectsSettingsRoute, integrationsRoute, workspaceSettingsRoute]),
  ]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: mayRestoreScroll,
    scrollToTopSelectors: [`#${APP_MAIN_ID}`],
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
