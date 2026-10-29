import { cors } from "@elysiajs/cors"
import { Elysia } from "elysia"
import type { AppDeps } from "./deps"
import { mcpModule } from "./mcp/route"
import { authModule } from "./modules/auth"
import { wellKnownModule } from "./modules/auth/well-known"
import { activityModule } from "./modules/activity"
import { aiModule } from "./modules/ai"
import { commentsModule } from "./modules/comments"
import { demoRequestsModule } from "./modules/demo-requests"
import { integrationsModule } from "./modules/integrations"
import { connectionsModule } from "./modules/connections"
import { localFilesModule } from "./modules/local-files"
import { accountModule } from "./modules/account"
import { meModule } from "./modules/me"
import { projectsModule } from "./modules/projects"
import { reportsModule } from "./modules/reports"
import { agentUploadsModule } from "./modules/reports/agent-uploads"
import { reportUploadsModule } from "./modules/reports/uploads"
import { shareModule } from "./modules/share"
import { oauthAppsModule } from "./modules/oauth-apps"
import { tokensModule } from "./modules/tokens"
import { trackersModule } from "./modules/trackers"
import { projectLogoModule } from "./modules/project-logo"
import { workspaceLogoModule } from "./modules/workspace-logo"
import { workspacesModule } from "./modules/workspaces"
import { invitationsModule } from "./modules/invitations"
import { joinModule } from "./modules/join"
import { notificationsModule } from "./modules/notifications"
import { errorHandler } from "./plugins/error-handler"

export type { AppDeps } from "./deps"

export function createApp(deps: AppDeps) {
  const { config } = deps
  const origins = [config.appUrl]
  if (config.extensionId) origins.push(`chrome-extension://${config.extensionId}`)

  const api = new Elysia({ prefix: "/api" })
    .use(cors({ origin: origins, credentials: true }))
    .use(errorHandler())
    .get("/health", () => ({ ok: true }))
    .use(authModule(deps))
    .use(meModule(deps))
    .use(accountModule(deps))
    .use(tokensModule(deps))
    .use(oauthAppsModule(deps))
    .use(workspacesModule(deps))
    .use(workspaceLogoModule(deps))
    .use(projectLogoModule(deps))
    .use(invitationsModule(deps))
    .use(joinModule(deps))
    .use(projectsModule(deps))
    .use(localFilesModule(deps))
    .use(reportUploadsModule(deps))
    .use(agentUploadsModule(deps))
    .use(reportsModule(deps))
    .use(shareModule(deps))
    .use(commentsModule(deps))
    .use(activityModule(deps))
    .use(notificationsModule(deps))
    .use(integrationsModule(deps))
    .use(connectionsModule(deps))
    .use(aiModule(deps))
    .use(trackersModule(deps))
    .use(mcpModule(deps))
    .use(demoRequestsModule(deps))

  // OAuth discovery must sit at the site root; everything else is under /api.
  return new Elysia().use(wellKnownModule(deps)).use(api)
}

export type App = ReturnType<typeof createApp>
