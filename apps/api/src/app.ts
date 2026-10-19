import { cors } from "@elysiajs/cors"
import type { Server } from "bun"
import { Elysia } from "elysia"
import type { Auth } from "./auth/better-auth"
import type { Config } from "./config"
import type { Db } from "./db/client"
import { AppError } from "./lib/errors"
import { mcpModule } from "./mcp/route"
import { wellKnownModule } from "./well-known"
import type { TrackerFactory } from "./lib/trackers/providers"
import { commentsModule } from "./modules/comments"
import { integrationsModule } from "./modules/integrations"
import { localFilesModule } from "./modules/local-files"
import { accountModule } from "./modules/account"
import { meModule } from "./modules/me"
import { projectsModule } from "./modules/projects"
import { reportsModule } from "./modules/reports"
import { reportUploadsModule } from "./modules/reports/uploads"
import { clientIp, shareModule } from "./modules/share"
import { oauthAppsModule } from "./modules/oauth-apps"
import { tokensModule } from "./modules/tokens"
import { trackersModule } from "./modules/trackers"
import { workspaceLogoModule } from "./modules/workspace-logo"
import { workspacesModule } from "./modules/workspaces"
import { invitationsModule } from "./modules/invitations"
import { joinModule } from "./modules/join"
import { notificationsModule } from "./modules/notifications"
import type { EmailSender } from "./email/sender"
import type { StorageDriver } from "./storage/types"

export interface AppDeps {
  config: Config
  db: Db
  storage: StorageDriver
  betterAuth: Auth
  /** Builds tracker clients; tests pass a fake, production uses real HTTP. */
  trackers?: TrackerFactory
  /** Sends invitation emails; tests pass a fake. Defaults to the configured driver. */
  email?: EmailSender | null
  /** Receives work started in the background (auto-send after finalize); tests use it to wait for it. */
  background?: (task: Promise<unknown>) => void
}

/**
 * Better Auth rate-limits by X-Forwarded-For only when it holds exactly one address; behind Caddy and
 * nginx it holds more, which would put every visitor in one shared bucket. Hands it the single address
 * our own hop counting trusts, or none when the connection address is unknown.
 */
function withClientIp(request: Request, server: Server<unknown> | null, proxyHops: number): Request {
  const headers = new Headers(request.headers)
  const ip = clientIp(request, server, proxyHops)
  if (ip === "unknown") headers.delete("x-forwarded-for")
  else headers.set("x-forwarded-for", ip)
  // Built from parts: Bun's new Request(request, { headers }) keeps the original headers when the
  // replacement Headers object is empty.
  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    signal: request.signal,
    // @ts-expect-error duplex is required by Bun/undici for a streamed body but missing from RequestInit
    duplex: "half",
  })
}

function errorResponse(status: number, body: { code: string; message: string; [field: string]: unknown }): Response {
  return Response.json(body, { status })
}

export function createApp(deps: AppDeps) {
  const { config, betterAuth } = deps
  const origins = [config.appUrl]
  if (config.extensionId) origins.push(`chrome-extension://${config.extensionId}`)

  const api = new Elysia({ prefix: "/api" })
    .use(cors({ origin: origins, credentials: true }))
    // Returns plain Responses: a typed `status()` here would leak into every route's Eden response type.
    .onError({ as: "global" }, ({ code, error }) => {
      if (error instanceof AppError) {
        return errorResponse(error.status, { ...error.extra, code: error.code, message: error.message })
      }
      if (code === "VALIDATION") {
        return errorResponse(422, {
          code: "validation",
          message: "Invalid request",
          details: error.all.map((issue) => ({ path: issue.path, message: issue.message })),
        })
      }
      if (code === "PARSE") return errorResponse(400, { code: "bad_request", message: "Malformed request body" })
      if (code === "NOT_FOUND") return errorResponse(404, { code: "not_found", message: "Route not found" })
      console.error(error)
      return errorResponse(500, { code: "internal", message: "Internal server error" })
    })
    .get("/health", () => ({ ok: true }))
    // Public: the login page shows only the methods that work. Never the ids, secrets or GitLab address.
    .get("/auth-methods", () => ({
      github: config.github !== null,
      gitlab: config.gitlab !== null,
      google: config.google !== null,
      emailOtp: config.email !== null,
    }))
    // Public: what the dashboard needs before anyone signs in.
    .get("/client-config", () => ({
      extensionInstallUrl: config.extensionInstallUrl,
      // The extension stops a recording before it would be refused for its size.
      maxUploadMb: Math.floor(config.maxUploadBytes / 1024 / 1024),
    }))
    // Method-specific routes: an `all` route loses to the dashboard's GET catch-all (scripts/e2e-dashboard.ts).
    .get("/auth/*", ({ request, server }) => betterAuth.handler(withClientIp(request, server, config.proxyHops)), {
      parse: "none",
    })
    .post("/auth/*", ({ request, server }) => betterAuth.handler(withClientIp(request, server, config.proxyHops)), {
      parse: "none",
    })
    .use(meModule(deps))
    .use(accountModule(deps))
    .use(tokensModule(deps))
    .use(oauthAppsModule(deps))
    .use(workspacesModule(deps))
    .use(workspaceLogoModule(deps))
    .use(invitationsModule(deps))
    .use(joinModule(deps))
    .use(projectsModule(deps))
    .use(localFilesModule(deps))
    .use(reportUploadsModule(deps))
    .use(reportsModule(deps))
    .use(shareModule(deps))
    .use(commentsModule(deps))
    .use(notificationsModule(deps))
    .use(integrationsModule(deps))
    .use(trackersModule(deps))
    .use(mcpModule(deps))

  // OAuth discovery must sit at the site root; everything else is under /api.
  return new Elysia().use(wellKnownModule(deps)).use(api)
}

export type App = ReturnType<typeof createApp>
