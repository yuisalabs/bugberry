import { genericOAuth } from "better-auth/plugins"
import type { OidcConfig } from "../../config"

/** Fixed, so the callback an admin registers at the IdP is always `{APP_URL}/api/auth/callback/oidc`. */
export const OIDC_PROVIDER_ID = "oidc"

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000

/** The Better Auth plugin for the server's one identity provider. */
export function oidcPlugin(oidc: OidcConfig, startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
  const entry: Parameters<typeof genericOAuth>[0]["config"][number] = {
    providerId: OIDC_PROVIDER_ID,
    name: oidc.name ?? "SSO",
    clientId: oidc.clientId,
    clientSecret: oidc.clientSecret,
    discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
    scopes: ["openid", "email", "profile"],
    pkce: true,
    // Signing out of BugBerry must not sign the person out of everything else at their company.
    disableProviderLogout: true,
    // An IdP without signing keys would have its id tokens read unchecked.
    requireIdTokenVerification: true,
    // Entra ID never sends email_verified, so only an explicit false is a refusal.
    mapProfileToUser: (profile) => ({ emailVerified: profile.email_verified !== false }),
  }
  const plugin = genericOAuth({ config: [entry] })
  const init = plugin.init
  return {
    ...plugin,
    // The plugin's first discovery has no timeout, and every auth call waits for init: an IdP that
    // accepts the connection and never answers would stall every signed-in request.
    init: (ctx: Parameters<typeof init>[0]) =>
      Promise.race([
        init(ctx),
        Bun.sleep(startupTimeoutMs).then(() => ({
          context: {
            socialProviders: ctx.socialProviders,
            // genericOAuth 1.7.10 retries discovery on each request for the providers listed here.
            genericOAuthPendingDiscovery: new Map([[entry.providerId, { config: entry }]]),
          },
        })),
      ]),
  }
}
