import { cleanAppName } from "@bugberry/shared"
import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { forbidden, notFound } from "../../lib/errors"
import { listConsentedApps, revokeConsentedApp } from "./repository"

/** The AI apps a person allowed through OAuth, and revoking them. Dashboard sessions only. */
export function oauthAppsModule(deps: AppDeps) {
  const { db } = deps
  const requireSession = (tokenKind: "full" | "mcp" | null) => {
    if (tokenKind !== null) throw forbidden("Manage connected apps from the BugBerry dashboard")
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/me/oauth-apps",
      async ({ user, tokenKind }) => {
        requireSession(tokenKind)
        const rows = await listConsentedApps(db, user.id)
        return rows.map((row) => ({ ...row, name: cleanAppName(row.name) }))
      },
      { auth: true },
    )
    .delete(
      "/me/oauth-apps/:clientId",
      async ({ user, tokenKind, params }) => {
        requireSession(tokenKind)
        // Consent and every token go together: the MCP route also checks the consent, so access ends at once.
        if (!(await revokeConsentedApp(db, user.id, params.clientId))) {
          throw notFound("oauth_app_not_found", "Connected app not found")
        }
        return { ok: true }
      },
      { auth: true },
    )
}
