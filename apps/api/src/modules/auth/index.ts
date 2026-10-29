import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { withClientIp } from "./client-ip"

export function authModule({ config, betterAuth }: Pick<AppDeps, "config" | "betterAuth">) {
  return (
    new Elysia()
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
        // Self-hosted servers send the marketing pages to sign-in.
        publicSite: config.publicSite,
        // The longest recording under ACCOUNT_LIMITS: a signed-out extension can't read a workspace's limits.
        maxRecordingSeconds: config.accountLimits ? config.accountLimits.recordingMs / 1000 : null,
      }))
      // Method-specific routes: an `all` route loses to the dashboard's GET catch-all (scripts/e2e-dashboard.ts).
      .get("/auth/*", ({ request, server }) => betterAuth.handler(withClientIp(request, server, config.proxyHops)), {
        parse: "none",
      })
      .post("/auth/*", ({ request, server }) => betterAuth.handler(withClientIp(request, server, config.proxyHops)), {
        parse: "none",
      })
  )
}
